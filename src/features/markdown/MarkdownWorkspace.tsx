import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Eye,
  FileDiff,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe2,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Printer,
  Redo2,
  Save,
  Search,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';

import { useDestination } from '@/app/destination-context';
import { ChangeReviewPanel } from '@/features/markdown/components/ChangeReviewPanel';
import { FindReplaceBar } from '@/features/markdown/components/FindReplaceBar';
import { renderMarkdown, type MarkdownRenderResult } from '@/features/markdown/engine/render-markdown';
import {
  findTextMatches,
  replaceAllTextMatches,
  replaceTextMatch,
} from '@/features/markdown/engine/find-replace';
import {
  revertReviewChange,
  reviewMarkdownChanges,
  type ReviewChange,
} from '@/features/markdown/engine/review-changes';
import { getExporter } from '@/features/markdown/exporters/registry';
import { MarkdownPreview } from '@/features/markdown/components/MarkdownPreview';
import { toggleTask } from '@/features/markdown/engine/toggle-task';
import { OpenDocumentDialog } from '@/features/markdown/components/OpenDocumentDialog';
import { loadMarkdownUrl } from '@/features/markdown/services/load-markdown-url';
import { documentHandoff } from '@/features/markdown/services/document-handoff';
import type { PageProps } from '@/features/shared/page-props';
import { downloadBlob } from '@/platform/files/download-blob';
import {
  markdownFilesFromDataTransfer,
  pickMarkdownDirectory,
  pickMarkdownFiles,
  type PickedMarkdownFile,
} from '@/platform/files/file-picker';
import type { DocumentRecord } from '@/shared/persistence/database';
import {
  documentService,
  type LoadedDocument,
} from '@/shared/persistence/document-service';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';

import './markdown-workspace.css';

type EditorMode = 'preview' | 'split' | 'source';

function isNarrowViewport(): boolean {
  return window.matchMedia('(max-width: 760px)').matches;
}

const EMPTY_RENDER: MarkdownRenderResult = {
  html: '',
  headings: [],
  wordCount: 0,
  readingMinutes: 1,
};

interface SessionDocument {
  content: string;
  baseline: string;
}

function destinationCopy(record: DocumentRecord, hasUnsavedChanges: boolean) {
  if (hasUnsavedChanges || record.draftUpdatedAt) {
    return { kind: 'browser-draft' as const, label: record.title, detail: '恢复草稿已保存在此浏览器' };
  }
  if (record.lastDestination === 'downloaded-copy') {
    return { kind: 'downloaded-copy' as const, label: record.title, detail: '已下载一个本地副本' };
  }
  if (record.lastDestination === 'online-share') {
    return { kind: 'online-share' as const, label: record.title, detail: '已生成在线分享记录' };
  }
  return { kind: 'original-file' as const, label: record.title, detail: record.source === 'file' ? '当前内容来自原文件' : '当前内容尚未修改' };
}

export function MarkdownWorkspace({ route, navigate }: PageProps) {
  const { setDestination } = useDestination();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [active, setActive] = useState<LoadedDocument | null>(null);
  const [content, setContent] = useState('');
  const [baseline, setBaseline] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<EditorMode>('preview');
  const [rendered, setRendered] = useState<MarkdownRenderResult>(EMPTY_RENDER);
  const [openDialog, setOpenDialog] = useState<'all' | 'url' | null>(null);
  const [railOpen, setRailOpen] = useState(() => !isNarrowViewport());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ canGoTop: false, canGoBottom: false });
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const editorView = useRef<EditorView | null>(null);
  const previewPane = useRef<HTMLDivElement>(null);
  const openMenu = useRef<HTMLDetailsElement>(null);
  const dragDepth = useRef(0);
  const edgeScrollTimer = useRef<number | null>(null);
  const pendingEditorSelection = useRef<{ from: number; to: number } | null>(null);
  const sessionDocuments = useRef(new Map<string, SessionDocument>());
  const handledRoute = useRef('');
  const lastPersistedSnapshot = useRef('');

  const refreshDocuments = useCallback(async () => {
    setDocuments(await documentService.recent(60));
  }, []);

  const activateDocument = useCallback((loaded: LoadedDocument) => {
    setActive(loaded);
    const nextContent = loaded.content ?? '';
    const nextBaseline = loaded.baseline ?? '';
    setContent(nextContent);
    setBaseline(nextBaseline);
    setTitle(loaded.record.title);
    lastPersistedSnapshot.current = loaded.record.draftUpdatedAt
      ? `${loaded.record.id}\u0000${nextContent}\u0000${loaded.record.title}`
      : '';
    if (loaded.content !== null) {
      sessionDocuments.current.set(loaded.record.id, { content: nextContent, baseline: nextBaseline });
    }
    setMode('preview');
    setFindOpen(false);
    setFindQuery('');
    setReviewOpen(false);
    setReviewIndex(0);
    setDestination(destinationCopy(loaded.record, Boolean(loaded.record.draftUpdatedAt)));
    setStatus(loaded.needsSource ? '需要重新选择原文件。' : '');
    if (isNarrowViewport()) setRailOpen(false);
  }, [setDestination]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) setRailOpen(false);
    };
    media.addEventListener('change', handleViewportChange);
    return () => media.removeEventListener('change', handleViewportChange);
  }, []);

  const openRecord = useCallback(async (record: DocumentRecord) => {
    const cached = sessionDocuments.current.get(record.id);
    if (cached) {
      activateDocument({ record, content: cached.content, baseline: cached.baseline, needsSource: false });
      return;
    }
    const loaded = await documentService.load(record.id);
    if (loaded) activateDocument(loaded);
  }, [activateDocument]);

  const createDocument = useCallback(async () => {
    const record = await documentService.create();
    const loaded: LoadedDocument = {
      record,
      content: record.draftContent ?? '',
      baseline: record.baselineContent ?? '',
      needsSource: false,
    };
    activateDocument(loaded);
    await refreshDocuments();
    navigate('markdown', new URLSearchParams({ document: record.id }));
  }, [activateDocument, navigate, refreshDocuments]);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    const documentId = route.params.get('document');
    const intent = route.params.get('intent');
    const key = `${documentId ?? ''}:${intent ?? ''}`;
    if (handledRoute.current === key) return;
    handledRoute.current = key;
    if (documentId) {
      void documentService.read(documentId).then((record) => { if (record) void openRecord(record); });
    } else if (intent === 'new') {
      void createDocument();
    } else if (intent === 'open') {
      setOpenDialog('all');
    }
  }, [createDocument, openRecord, route.params]);

  useEffect(() => {
    let activeRender = true;
    const timer = window.setTimeout(() => {
      void renderMarkdown(content).then((result) => { if (activeRender) setRendered(result); });
    }, 140);
    return () => {
      activeRender = false;
      window.clearTimeout(timer);
    };
  }, [content]);

  const hasChanges = Boolean(active && !active.needsSource && (content !== baseline || title !== active.record.title));
  const reviewChanges = useMemo(() => reviewMarkdownChanges(baseline, content), [baseline, content]);
  const findMatches = useMemo(() => findTextMatches(content, findQuery, matchCase), [content, findQuery, matchCase]);

  const applyContent = useCallback((nextContent: string) => {
    setContent(nextContent);
    if (active) sessionDocuments.current.set(active.record.id, { content: nextContent, baseline });
  }, [active, baseline]);

  const handleTaskToggle = useCallback((taskIndex: number, checked: boolean) => {
    setContent((current) => {
      const next = toggleTask(current, taskIndex, checked);
      if (active) sessionDocuments.current.set(active.record.id, { content: next, baseline });
      return next;
    });
  }, [active, baseline]);

  useEffect(() => {
    if (findMatches.length === 0) {
      setFindIndex(0);
      return;
    }
    setFindIndex((current) => Math.min(current, findMatches.length - 1));
  }, [findMatches.length]);

  useEffect(() => {
    if (reviewChanges.length === 0) {
      setReviewIndex(0);
      return;
    }
    setReviewIndex((current) => Math.min(current, reviewChanges.length - 1));
  }, [reviewChanges.length]);

  useEffect(() => {
    if (!active || active.needsSource || !hasChanges) return;
    const snapshot = `${active.record.id}\u0000${content}\u0000${title}`;
    if (lastPersistedSnapshot.current === snapshot) return;
    setDestination({ kind: 'browser-draft', label: title || active.record.title, detail: '正在保存恢复草稿' });
    const documentId = active.record.id;
    const timer = window.setTimeout(() => {
      void documentService.updateDraft(documentId, content, baseline, title).then((record) => {
        if (!record) return;
        setActive((current) => current?.record.id === documentId ? { ...current, record } : current);
        setDocuments((current) => current.map((item) => item.id === documentId ? record : item).sort((a, b) => b.updatedAt - a.updatedAt));
        sessionDocuments.current.set(documentId, { content, baseline });
        lastPersistedSnapshot.current = snapshot;
        setDestination({ kind: 'browser-draft', label: record.title, detail: '恢复草稿已保存在此浏览器' });
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [active, baseline, content, hasChanges, setDestination, title]);

  const importFiles = async (pickedFiles: PickedMarkdownFile[]) => {
    const loaded = await Promise.all(
      pickedFiles.map((picked) => documentService.importFile(picked.file, picked.handle, picked.relativePath)),
    );
    for (const item of loaded) {
      if (item.content !== null) sessionDocuments.current.set(item.record.id, { content: item.content, baseline: item.baseline ?? item.content });
    }
    await refreshDocuments();
    const first = loaded[0];
    if (first) {
      activateDocument(first);
      navigate('markdown', new URLSearchParams({ document: first.record.id }));
    }
  };

  const importUrl = async (value: string) => {
    const remote = await loadMarkdownUrl(value);
    const loaded = await documentService.importUrl(remote.url, remote.content);
    sessionDocuments.current.set(loaded.record.id, { content: remote.content, baseline: remote.content });
    activateDocument(loaded);
    await refreshDocuments();
    navigate('markdown', new URLSearchParams({ document: loaded.record.id }));
  };

  const chooseFiles = async () => {
    try {
      const picked = await pickMarkdownFiles();
      if (picked.length > 0) await importFiles(picked);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法打开所选文件。');
    }
  };

  const chooseDirectory = async () => {
    openMenu.current?.removeAttribute('open');
    try {
      const picked = await pickMarkdownDirectory();
      if (picked.length > 0) await importFiles(picked);
      else setStatus('所选文件夹中没有 Markdown 文档。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法打开所选文件夹。');
    }
  };

  const importDrop = async (dataTransfer: DataTransfer) => {
    setDragActive(false);
    try {
      const picked = await markdownFilesFromDataTransfer(dataTransfer);
      if (picked.length > 0) await importFiles(picked);
      else setStatus('没有找到可打开的 Markdown 文档。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法读取拖入的内容。');
    }
  };

  const relinkSource = async () => {
    if (!active) return;
    if (active.record.source === 'url' && active.record.sourceUrl) {
      setStatus('正在重新读取网址…');
      try {
        const remote = await loadMarkdownUrl(active.record.sourceUrl);
        activateDocument({ ...active, content: remote.content, baseline: remote.content, needsSource: false });
        setStatus('网址内容已重新读取。');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '无法重新读取网址。');
      }
      return;
    }
    const picked = (await pickMarkdownFiles())[0];
    if (!picked) return;
    const loaded = await documentService.attachSource(active.record.id, picked.file, picked.handle);
    if (loaded) activateDocument(loaded);
  };

  const saveCurrent = async () => {
    if (!active || active.needsSource) return;
    setStatus('正在保存…');
    const handle = active.record.fileHandle;
    if (handle) {
      try {
        const permissionHandle = handle as FileSystemFileHandle & {
          requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
        };
        if (permissionHandle.requestPermission) {
          const permission = await permissionHandle.requestPermission({ mode: 'readwrite' });
          if (permission !== 'granted') throw new Error('没有获得原文件写入权限。');
        }
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        await documentService.markSavedOriginal(active.record.id);
        const record = await documentService.read(active.record.id);
        if (record) setActive({ record, content, baseline: content, needsSource: false });
        setBaseline(content);
        sessionDocuments.current.set(active.record.id, { content, baseline: content });
        setDestination({ kind: 'original-file', label: title, detail: '已写回原文件' });
        setStatus('已写回原文件。');
        return;
      } catch (error) {
        setStatus(error instanceof Error ? `${error.message} 已改为下载副本。` : '无法写回原文件，已改为下载副本。');
      }
    }
    const result = await (await getExporter('markdown')).export({ markdown: content, title });
    downloadBlob(result.blob, result.fileName);
    await documentService.markDownloaded(active.record.id, content);
    const record = await documentService.read(active.record.id);
    if (record) setActive({ record, content, baseline: content, needsSource: false });
    setBaseline(content);
    sessionDocuments.current.set(active.record.id, { content, baseline: content });
    setDestination({ kind: 'downloaded-copy', label: title, detail: '已下载一个本地副本' });
    setStatus('已下载 Markdown 副本。');
  };

  const exportCurrent = async (format: 'markdown' | 'html' | 'docx') => {
    if (!active || active.needsSource) return;
    setExporting(true);
    setStatus(`正在生成 ${format === 'docx' ? 'Word' : format.toUpperCase()}…`);
    try {
      const result = await (await getExporter(format)).export({ markdown: content, title });
      downloadBlob(result.blob, result.fileName);
      setStatus(`已下载 ${result.fileName}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  };

  const copyHtml = async () => {
    const result = await renderMarkdown(content);
    try {
      if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([result.html], { type: 'text/html' }),
          'text/plain': new Blob([content], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(result.html);
      }
      setStatus('正文 HTML 已复制。');
    } catch {
      setStatus('浏览器未允许写入剪贴板。');
    }
  };

  const shareCurrent = async () => {
    if (!active || active.needsSource) return;
    if (hasChanges) await documentService.updateDraft(active.record.id, content, baseline, title);
    documentHandoff.put({ documentId: active.record.id, title, content });
    navigate('files', new URLSearchParams({ intent: 'share', document: active.record.id }));
  };

  const removeDocument = async (record: DocumentRecord) => {
    if (!window.confirm(`从当前浏览器中移除“${record.title}”？原文件不会被删除。`)) return;
    await documentService.remove(record.id);
    sessionDocuments.current.delete(record.id);
    if (active?.record.id === record.id) {
      setActive(null);
      setContent('');
      setBaseline('');
      setRendered(EMPTY_RENDER);
      setDestination({ kind: 'browser-draft', label: 'Markdown 工作区', detail: '等待打开文档' });
      navigate('markdown');
    }
    await refreshDocuments();
  };

  const openFindPanel = useCallback((withReplace = false) => {
    if (!active) return;
    const view = editorView.current?.dom.isConnected ? editorView.current : null;
    if (view) {
      const selection = view.state.selection.main;
      if (selection.from !== selection.to) setFindQuery(view.state.sliceDoc(selection.from, selection.to));
    }
    setFindIndex(0);
    setFindOpen(true);
    setReplaceOpen(withReplace);
  }, [active]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key !== 'f' && key !== 'h') return;
      event.preventDefault();
      event.stopPropagation();
      openFindPanel(key === 'h');
    };
    window.addEventListener('keydown', handleFindShortcut, true);
    return () => window.removeEventListener('keydown', handleFindShortcut, true);
  }, [openFindPanel]);

  const stepFind = (direction: -1 | 1) => {
    if (findMatches.length === 0) return;
    setFindIndex((current) => (current + direction + findMatches.length) % findMatches.length);
  };

  useEffect(() => {
    if (!findOpen || mode === 'preview') return;
    const match = findMatches[findIndex];
    if (!match) return;
    window.requestAnimationFrame(() => {
      const view = editorView.current;
      if (!view) return;
      view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
    });
  }, [findIndex, findMatches, findOpen, mode]);

  const replaceCurrentMatch = () => {
    const match = findMatches[findIndex];
    if (!match) return;
    applyContent(replaceTextMatch(content, match, replacement));
    setStatus('已替换 1 处。');
  };

  const replaceEveryMatch = () => {
    if (findMatches.length === 0) return;
    const count = findMatches.length;
    applyContent(replaceAllTextMatches(content, findMatches, replacement));
    setFindIndex(0);
    setStatus(`已替换 ${count} 处。`);
  };

  const selectReviewChange = (index: number) => {
    const change = reviewChanges[index];
    if (!change) return;
    setReviewIndex(index);
    pendingEditorSelection.current = { from: change.currentFrom, to: change.currentTo };
    if (mode === 'preview') setMode('split');
    window.setTimeout(() => {
      const view = editorView.current;
      const selection = pendingEditorSelection.current;
      if (!view || !selection) return;
      view.dispatch({ selection: { anchor: selection.from, head: selection.to }, scrollIntoView: true });
      view.focus();
      pendingEditorSelection.current = null;
    }, 0);
  };

  const stepReview = (direction: -1 | 1) => {
    if (reviewChanges.length === 0) return;
    selectReviewChange((reviewIndex + direction + reviewChanges.length) % reviewChanges.length);
  };

  const revertChange = (change: ReviewChange) => {
    applyContent(revertReviewChange(content, change));
    setStatus('已撤回这处改动。');
  };

  const revertAllChanges = () => {
    if (reviewChanges.length === 0) return;
    if (!window.confirm(`撤回全部 ${reviewChanges.length} 处未保存改动？`)) return;
    applyContent(baseline);
    setReviewIndex(0);
    setStatus('已恢复到上次保存的内容。');
  };

  const scrollElement = useCallback((): HTMLElement | null => {
    if (mode !== 'preview') {
      const editorScroll = editorView.current?.scrollDOM;
      return editorScroll?.isConnected ? editorScroll : null;
    }
    return previewPane.current;
  }, [mode]);

  useEffect(() => {
    let element: HTMLElement | null = null;
    const update = () => {
      if (!element) return;
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      setScrollEdges({ canGoTop: element.scrollTop > 8, canGoBottom: element.scrollTop < maximum - 8 });
    };
    let mutationObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const frame = window.requestAnimationFrame(() => {
      element = scrollElement();
      if (!element) return;
      element.addEventListener('scroll', update, { passive: true });
      mutationObserver = new MutationObserver(update);
      mutationObserver.observe(element, { childList: true, subtree: true });
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(element);
      update();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      element?.removeEventListener('scroll', update);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [active?.record.id, content, mode, rendered.html, scrollElement]);

  const scrollToEdge = (edge: 'top' | 'bottom') => {
    const element = scrollElement();
    if (!element) return;
    if (edgeScrollTimer.current !== null) window.clearTimeout(edgeScrollTimer.current);
    const target = () => edge === 'top' ? 0 : Math.max(0, element.scrollHeight - element.clientHeight);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ top: target(), behavior: reduceMotion ? 'auto' : 'smooth' });
    if (reduceMotion) return;
    edgeScrollTimer.current = window.setTimeout(() => {
      edgeScrollTimer.current = null;
      const latestTarget = target();
      if (Math.abs(element.scrollTop - latestTarget) > 2) {
        element.scrollTo({ top: latestTarget, behavior: 'auto' });
      }
    }, 700);
  };

  useEffect(() => () => {
    if (edgeScrollTimer.current !== null) window.clearTimeout(edgeScrollTimer.current);
  }, [active?.record.id, mode]);

  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping], []);

  return (
    <div
      className={`markdown-workspace ${railOpen ? '' : 'markdown-workspace--rail-closed'} ${reviewOpen ? 'markdown-workspace--review-open' : ''}`}
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        dragDepth.current = 0;
        void importDrop(event.dataTransfer);
      }}
    >
      <header className="markdown-toolbar">
        <div className="markdown-toolbar__group markdown-toolbar__documents">
          <IconButton icon={railOpen ? PanelLeftClose : PanelLeftOpen} label={railOpen ? '收起文档列表' : '展开文档列表'} onClick={() => setRailOpen((value) => !value)} />
          <div className="open-file-control">
            <Button className="open-file-control__primary" icon={FileText} onClick={() => void chooseFiles()} size="small">打开文件</Button>
            <details className="open-file-menu" ref={openMenu}>
              <summary aria-label="其他打开方式" title="其他打开方式"><ChevronDown aria-hidden="true" size={16} /></summary>
              <div className="open-file-menu__panel">
                <button onClick={() => void chooseDirectory()} type="button">
                  <FolderOpen aria-hidden="true" size={17} />
                  <span><strong>打开文件夹</strong><small>读取其中的 Markdown 文档</small></span>
                </button>
                <button onClick={() => { openMenu.current?.removeAttribute('open'); setOpenDialog('url'); }} type="button">
                  <Globe2 aria-hidden="true" size={17} />
                  <span><strong>从网址打开</strong><small>支持直链、GitHub 和 Gist</small></span>
                </button>
              </div>
            </details>
          </div>
          <IconButton icon={FilePlus2} label="新建文档" onClick={() => void createDocument()} />
        </div>

        <label className="document-title-field">
          <span className="sr-only">文档名称</span>
          <input disabled={!active} onChange={(event) => setTitle(event.target.value)} value={active ? title : '未打开文档'} />
        </label>

        <div className="workspace-mode-switch" aria-label="工作区模式" role="group">
          <button aria-pressed={mode === 'preview'} className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')} title="阅读模式" type="button"><Eye aria-hidden="true" size={15} /><span>阅读</span></button>
          <button aria-pressed={mode === 'split'} className={mode === 'split' ? 'is-active' : ''} onClick={() => setMode('split')} title="编辑模式" type="button"><PencilLine aria-hidden="true" size={15} /><span>编辑</span></button>
          <button aria-pressed={mode === 'source'} className={mode === 'source' ? 'is-active' : ''} onClick={() => setMode('source')} title="源码模式" type="button"><Code2 aria-hidden="true" size={15} /><span>源码</span></button>
        </div>

        <div className="markdown-toolbar__group markdown-toolbar__edit-actions">
          <IconButton className="history-action" disabled={!active || mode === 'preview'} icon={Undo2} label="撤销" onClick={() => { if (editorView.current) undo(editorView.current); }} />
          <IconButton className="history-action" disabled={!active || mode === 'preview'} icon={Redo2} label="重做" onClick={() => { if (editorView.current) redo(editorView.current); }} />
          <IconButton active={findOpen} disabled={!active} icon={Search} label="查找和替换" onClick={() => openFindPanel(false)} />
          <Button className={reviewOpen ? 'review-toggle review-toggle--active' : 'review-toggle'} disabled={!active || active.needsSource} icon={FileDiff} onClick={() => setReviewOpen((value) => !value)} size="small">{reviewChanges.length > 0 ? `改动 ${reviewChanges.length}` : '改动'}</Button>
        </div>

        <div className="markdown-toolbar__group markdown-toolbar__output-actions">
          <IconButton className="output-action--optional" disabled={!active?.content && !content} icon={Copy} label="复制 HTML" onClick={() => void copyHtml()} />
          <IconButton className="output-action--optional" disabled={!active || active.needsSource} icon={Printer} label="打印或另存 PDF" onClick={() => { setMode('preview'); window.setTimeout(() => window.print(), 80); }} />
          <details className="export-menu">
            <summary aria-label="导出文档"><Download aria-hidden="true" size={17} /><span>导出</span></summary>
            <div className="export-menu__panel">
              <button disabled={exporting || !active} onClick={() => void exportCurrent('html')} type="button"><strong>HTML 网页</strong><small>可独立打开的本地网页</small></button>
              <button disabled={exporting || !active} onClick={() => void exportCurrent('docx')} type="button"><strong>Word 文档</strong><small>可继续编辑的 DOCX</small></button>
              <button disabled={exporting || !active} onClick={() => void exportCurrent('markdown')} type="button"><strong>Markdown</strong><small>保留原始文本</small></button>
            </div>
          </details>
          <Button disabled={!active || active.needsSource} icon={Save} onClick={() => void saveCurrent()} size="small">保存</Button>
          <Button disabled={!active || active.needsSource} icon={Share2} onClick={() => void shareCurrent()} size="small" variant="primary">分享</Button>
        </div>

        <FindReplaceBar
          current={findIndex}
          matchCase={matchCase}
          onClose={() => setFindOpen(false)}
          onMatchCaseChange={setMatchCase}
          onQueryChange={(value) => { setFindQuery(value); setFindIndex(0); }}
          onReplaceAll={replaceEveryMatch}
          onReplaceOne={replaceCurrentMatch}
          onReplaceOpenChange={setReplaceOpen}
          onReplacementChange={setReplacement}
          onStep={stepFind}
          open={findOpen}
          query={findQuery}
          replaceOpen={replaceOpen}
          replacement={replacement}
          total={findMatches.length}
        />
      </header>

      <div className="markdown-workspace__body">
        {railOpen ? <button aria-label="关闭文档列表" className="document-rail-scrim" onClick={() => setRailOpen(false)} type="button" /> : null}
        <aside className="document-rail">
          <div className="document-rail__heading"><strong>文档</strong><span>{documents.length}</span></div>
          <div className="document-list">
            {documents.map((document) => (
              <div className={`document-row ${active?.record.id === document.id ? 'document-row--active' : ''}`} key={document.id}>
                <button onClick={() => void openRecord(document)} type="button">
                  <FileText aria-hidden="true" size={16} />
                  <span><strong>{document.title}</strong><small>{document.sourceLabel}</small></span>
                  {document.draftUpdatedAt ? <i title="有恢复草稿" /> : null}
                </button>
                <IconButton icon={Trash2} label={`移除 ${document.title}`} onClick={() => void removeDocument(document)} />
              </div>
            ))}
          </div>
          {documents.length === 0 ? <p className="document-rail__empty">打开的文档会列在这里。</p> : null}
        </aside>

        {!active ? (
          <section className="workspace-welcome">
            <div className="workspace-welcome__mark"><FileText aria-hidden="true" size={28} /></div>
            <h1>打开一份 Markdown</h1>
            <p>内容默认在本机处理；未连接存储也可以阅读、编辑和导出。</p>
            <div><Button icon={FileText} onClick={() => void chooseFiles()} variant="primary">打开文件</Button><Button icon={FolderOpen} onClick={() => void chooseDirectory()}>打开文件夹</Button><Button icon={FilePlus2} onClick={() => void createDocument()} variant="quiet">新建文档</Button></div>
          </section>
        ) : active.needsSource ? (
          <section className="workspace-welcome">
            <div className="workspace-welcome__mark"><FolderOpen aria-hidden="true" size={28} /></div>
            <h1>需要重新选择原文件</h1>
            <p>Workbench 没有复制未修改的原文件；恢复草稿存在时会优先显示草稿。</p>
            <Button icon={FolderOpen} onClick={() => void relinkSource()} variant="primary">重新选择</Button>
          </section>
        ) : (
          <section className={`workspace-stage workspace-stage--${mode}`}>
            {mode !== 'preview' ? (
              <div className="editor-pane">
                <CodeMirror
                  basicSetup={{ foldGutter: true, highlightActiveLine: true, highlightActiveLineGutter: true, autocompletion: true }}
                  extensions={extensions}
                  height="100%"
                  onChange={applyContent}
                  onCreateEditor={(view) => {
                    editorView.current = view;
                    const selection = pendingEditorSelection.current;
                    if (!selection) return;
                    window.requestAnimationFrame(() => {
                      view.dispatch({ selection: { anchor: selection.from, head: selection.to }, scrollIntoView: true });
                      view.focus();
                      pendingEditorSelection.current = null;
                    });
                  }}
                  placeholder="从这里开始写作…"
                  value={content}
                />
              </div>
            ) : null}
            {mode !== 'source' ? (
              <div className="preview-pane" ref={previewPane}><MarkdownPreview html={rendered.html} onTaskToggle={handleTaskToggle} search={findOpen ? { query: findQuery, matchCase, current: findIndex } : undefined} /></div>
            ) : null}
          </section>
        )}

        {active && !active.needsSource && !reviewOpen && mode !== 'source' && rendered.headings.length > 0 ? (
          <aside className="markdown-outline">
            <strong>大纲</strong>
            <nav>{rendered.headings.map((heading) => <button className={`outline-level-${heading.level}`} key={heading.id} onClick={() => previewPane.current?.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} type="button">{heading.text}</button>)}</nav>
          </aside>
        ) : null}

        {active && !active.needsSource && reviewOpen ? (
          <ChangeReviewPanel changes={reviewChanges} current={reviewIndex} onClose={() => setReviewOpen(false)} onRevert={revertChange} onRevertAll={revertAllChanges} onSelect={selectReviewChange} onStep={stepReview} />
        ) : null}

        {active && !active.needsSource && (reviewChanges.length > 0 || scrollEdges.canGoTop || scrollEdges.canGoBottom) ? (
          <nav aria-label="文档快速导航" className="workspace-float-controls">
            {!reviewOpen && reviewChanges.length > 0 ? (
              <div className="workspace-float-controls__group workspace-float-controls__changes">
                <IconButton icon={ChevronUp} label="上一处改动" onClick={() => stepReview(-1)} />
                <button aria-label="打开改动审阅" className="workspace-change-count" onClick={() => setReviewOpen(true)} title="打开改动审阅" type="button"><FileDiff aria-hidden="true" size={15} /><span>{reviewIndex + 1}/{reviewChanges.length}</span></button>
                <IconButton icon={ChevronDown} label="下一处改动" onClick={() => stepReview(1)} />
              </div>
            ) : null}
            {scrollEdges.canGoTop || scrollEdges.canGoBottom ? (
              <div className="workspace-float-controls__group">
                {scrollEdges.canGoTop ? <IconButton icon={ArrowUpToLine} label="回到顶部" onClick={() => scrollToEdge('top')} /> : null}
                {scrollEdges.canGoBottom ? <IconButton icon={ArrowDownToLine} label="回到底部" onClick={() => scrollToEdge('bottom')} /> : null}
              </div>
            ) : null}
          </nav>
        ) : null}
      </div>

      <footer className="workspace-statusbar">
        <span>{active ? active.record.sourceLabel : '未打开文档'}</span>
        <span>{status || (hasChanges ? '有未保存改动' : active ? '没有未保存改动' : '')}</span>
        <span>{rendered.wordCount.toLocaleString('zh-CN')} 字 · 约 {rendered.readingMinutes} 分钟</span>
      </footer>

      {dragActive ? <div aria-hidden="true" className="workspace-drop-overlay"><FileText size={34} /><strong>松开即可打开</strong><span>支持 Markdown 文件或文件夹</span></div> : null}

      <OpenDocumentDialog onClose={() => setOpenDialog(null)} onFiles={importFiles} onUrl={importUrl} open={openDialog !== null} sourceMode={openDialog ?? 'all'} />
    </div>
  );
}
