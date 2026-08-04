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
  Undo2,
} from 'lucide-react';

import { useDestination } from '@/app/destination-context';
import { useSettings } from '@/app/settings-context';
import { getActiveStorageProfile, isStorageProfileConfigured } from '@/app/storage-status';
import { ChangeReviewPanel } from '@/features/markdown/components/ChangeReviewPanel';
import { DocumentRail } from '@/features/markdown/components/DocumentRail';
import { FindReplaceBar } from '@/features/markdown/components/FindReplaceBar';
import { ReadingSettingsPanel } from '@/features/markdown/components/ReadingSettingsPanel';
import { ShareDocumentDialog } from '@/features/markdown/components/ShareDocumentDialog';
import { formatShareText } from '@/features/files/share-text';
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
import type { ExportFormat } from '@/features/markdown/exporters/contract';
import { exportAppearanceFromSettings } from '@/features/markdown/exporters/export-appearance';
import { safeFileName } from '@/features/markdown/exporters/file-name';
import { MarkdownPreview, type MarkdownPreviewHandle } from '@/features/markdown/components/MarkdownPreview';
import { toggleTask } from '@/features/markdown/engine/toggle-task';
import { OpenDocumentDialog } from '@/features/markdown/components/OpenDocumentDialog';
import { loadMarkdownUrl } from '@/features/markdown/services/load-markdown-url';
import {
  defaultDocumentShareAccess,
  shareMarkdownDocument,
  type DocumentShareAccess,
} from '@/features/markdown/services/share-markdown-document';
import type { PageProps } from '@/features/shared/page-props';
import { downloadBlob } from '@/platform/files/download-blob';
import {
  markdownFilesFromDataTransfer,
  pickMarkdownDirectory,
  pickMarkdownFiles,
  pickMarkdownSaveFile,
  resolvePickedMarkdownFile,
  writeMarkdownFile,
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

type EditorMode = 'read' | 'edit' | 'source';

function isNarrowViewport(): boolean {
  return window.matchMedia('(max-width: 760px)').matches;
}

const EMPTY_RENDER: MarkdownRenderResult = {
  html: '',
  headings: [],
  blocks: [],
  wordCount: 0,
  readingMinutes: 1,
};

const EXPORT_LABELS: Record<ExportFormat, string> = {
  html: 'HTML',
  docx: 'Word',
  markdown: 'Markdown',
};

interface SessionDocument {
  content: string;
  baseline: string;
}

interface DocumentHistory {
  undo: string[];
  redo: string[];
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
  const { settings, loading: settingsLoading, update: updateSettings } = useSettings();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [active, setActive] = useState<LoadedDocument | null>(null);
  const [content, setContent] = useState('');
  const [baseline, setBaseline] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<EditorMode>('read');
  const [rendered, setRendered] = useState<MarkdownRenderResult>(EMPTY_RENDER);
  const [openDialog, setOpenDialog] = useState<'all' | 'url' | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFormat, setShareFormat] = useState<ExportFormat>(settings.defaultShareFormat);
  const [shareAccess, setShareAccess] = useState<DocumentShareAccess>('provider-managed');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [generatedShare, setGeneratedShare] = useState<{ url: string; text: string } | null>(null);
  const [railOpen, setRailOpen] = useState(() => !isNarrowViewport() && settings.markdownRailOpen);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewFocusVersion, setReviewFocusVersion] = useState(0);
  const [reviewShowMarks, setReviewShowMarks] = useState(settings.reviewShowMarks);
  const [reviewShowAll, setReviewShowAll] = useState(false);
  const [reviewInlineOpen, setReviewInlineOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ canGoTop: false, canGoBottom: false });
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [documentsBusy, setDocumentsBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string; kind: 'info' | 'success' | 'error' } | null>(null);
  const editorView = useRef<EditorView | null>(null);
  const markdownPreview = useRef<MarkdownPreviewHandle>(null);
  const contentRef = useRef('');
  const previewPane = useRef<HTMLDivElement>(null);
  const openMenu = useRef<HTMLDetailsElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const reviewControl = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const edgeScrollTimer = useRef<number | null>(null);
  const sessionDocuments = useRef(new Map<string, SessionDocument>());
  const sessionFiles = useRef(new Map<string, PickedMarkdownFile>());
  const documentHistory = useRef(new Map<string, DocumentHistory>());
  const selectedPreviewText = useRef('');
  const handledRoute = useRef('');
  const lastPersistedSnapshot = useRef('');
  const openSequence = useRef(0);

  const activeProfile = useMemo(
    () => getActiveStorageProfile(settings.storageProfiles, settings.activeStorageProfileId),
    [settings.activeStorageProfileId, settings.storageProfiles],
  );
  const storageReady = isStorageProfileConfigured(activeProfile);

  const notify = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, kind });
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 3_200);
  }, []);

  const toggleRail = () => {
    const next = !railOpen;
    setRailOpen(next);
    if (!isNarrowViewport() && settings.markdownRailOpen !== next) {
      void updateSettings({ markdownRailOpen: next });
    }
  };

  const rememberReviewShowMarks = (value: boolean) => {
    setReviewShowMarks(value);
    if (settings.reviewShowMarks !== value) void updateSettings({ reviewShowMarks: value });
  };

  const refreshDocuments = useCallback(async () => {
    setDocuments(await documentService.recent(2_000));
  }, []);

  const activateDocument = useCallback((loaded: LoadedDocument) => {
    setActive(loaded);
    const nextContent = loaded.content ?? '';
    const nextBaseline = loaded.baseline ?? '';
    setContent(nextContent);
    contentRef.current = nextContent;
    setBaseline(nextBaseline);
    setTitle(loaded.record.title);
    lastPersistedSnapshot.current = loaded.record.draftUpdatedAt
      ? `${loaded.record.id}\u0000${nextContent}\u0000${loaded.record.title}`
      : '';
    if (loaded.content !== null) {
      sessionDocuments.current.set(loaded.record.id, { content: nextContent, baseline: nextBaseline });
    }
    setMode('read');
    setFindOpen(false);
    setFindQuery('');
    setReviewOpen(false);
    setReviewIndex(0);
    setReviewShowAll(false);
    setReviewInlineOpen(false);
    setActiveHeadingId('');
    selectedPreviewText.current = '';
    setDestination(destinationCopy(loaded.record, Boolean(loaded.record.draftUpdatedAt)));
    setStatus(loaded.needsSource ? '需要重新选择原文件。' : '');
    if (isNarrowViewport()) setRailOpen(false);
  }, [setDestination]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const applyPreference = () => {
      setRailOpen(media.matches ? false : settings.markdownRailOpen);
    };
    if (!settingsLoading) applyPreference();
    media.addEventListener('change', applyPreference);
    return () => media.removeEventListener('change', applyPreference);
  }, [settings.markdownRailOpen, settingsLoading]);

  useEffect(() => {
    if (!settingsLoading) setReviewShowMarks(settings.reviewShowMarks);
  }, [settings.reviewShowMarks, settingsLoading]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (openMenu.current?.open && !openMenu.current.contains(target)) openMenu.current.removeAttribute('open');
      if (exportMenu.current?.open && !exportMenu.current.contains(target)) exportMenu.current.removeAttribute('open');
      if (reviewOpen && reviewControl.current && !reviewControl.current.contains(target)) setReviewOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      openMenu.current?.removeAttribute('open');
      exportMenu.current?.removeAttribute('open');
      if (reviewOpen) setReviewOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [reviewOpen]);

  const openRecord = useCallback(async (record: DocumentRecord) => {
    markdownPreview.current?.commitActiveEdit();
    const sequence = ++openSequence.current;
    const cached = sessionDocuments.current.get(record.id);
    if (cached) {
      activateDocument({ record, content: cached.content, baseline: cached.baseline, needsSource: false });
      return;
    }
    setStatus(`正在打开 ${record.title}…`);
    try {
      const picked = sessionFiles.current.get(record.id);
      if (picked) {
        const content = await (await resolvePickedMarkdownFile(picked)).text();
        if (sequence !== openSequence.current) return;
        activateDocument({ record, content, baseline: content, needsSource: false });
        return;
      }
      const loaded = await documentService.load(record.id);
      if (sequence === openSequence.current && loaded) activateDocument(loaded);
    } catch (error) {
      if (sequence !== openSequence.current) return;
      activateDocument({ record, content: null, baseline: null, needsSource: true });
      setStatus(error instanceof Error ? `${error.message} 请重新选择原文件。` : `无法读取 ${record.title}，请重新选择原文件。`);
    }
  }, [activateDocument]);

  const createDocument = useCallback(async () => {
    markdownPreview.current?.commitActiveEdit();
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

  const applyContent = useCallback((nextValue: string | ((current: string) => string), remember = true) => {
    const current = contentRef.current;
    const nextContent = typeof nextValue === 'function' ? nextValue(current) : nextValue;
    if (nextContent === current) return;
    if (active && remember) {
      const history = documentHistory.current.get(active.record.id) ?? { undo: [], redo: [] };
      history.undo.push(current);
      if (history.undo.length > 100) history.undo.shift();
      history.redo = [];
      documentHistory.current.set(active.record.id, history);
    }
    contentRef.current = nextContent;
    setContent(nextContent);
    if (active) sessionDocuments.current.set(active.record.id, { content: nextContent, baseline });
  }, [active, baseline]);

  const handleTaskToggle = useCallback((taskIndex: number, checked: boolean) => {
    applyContent((current) => toggleTask(current, taskIndex, checked));
  }, [applyContent]);

  const undoRichEdit = () => {
    if (!active) return;
    if (markdownPreview.current?.cancelActiveEdit()) return;
    const history = documentHistory.current.get(active.record.id);
    const previous = history?.undo.pop();
    if (!history || previous === undefined) return;
    history.redo.push(contentRef.current);
    applyContent(previous, false);
  };

  const redoRichEdit = () => {
    if (!active) return;
    markdownPreview.current?.commitActiveEdit();
    const history = documentHistory.current.get(active.record.id);
    const next = history?.redo.pop();
    if (!history || next === undefined) return;
    history.undo.push(contentRef.current);
    applyContent(next, false);
  };

  const undoCurrent = () => {
    if (mode === 'source' && editorView.current) undo(editorView.current);
    else undoRichEdit();
  };

  const redoCurrent = () => {
    if (mode === 'source' && editorView.current) redo(editorView.current);
    else redoRichEdit();
  };

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
      setReviewShowAll(false);
      setReviewInlineOpen(false);
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

  const importFiles = async (selectedFiles: PickedMarkdownFile[], replaceCurrentFiles = false) => {
    if (selectedFiles.length === 0) return;
    const uniqueFiles = [...new Map(selectedFiles.map((file) => [
      file.relativePath.replace(/\\/g, '/').toLocaleLowerCase(),
      file,
    ])).values()];
    setDocumentsBusy(true);
    setStatus(uniqueFiles.length === 1 ? '正在打开文件…' : `正在整理 ${uniqueFiles.length} 个文件…`);
    try {
      if (replaceCurrentFiles && active && !active.needsSource && hasChanges) {
        await documentService.updateDraft(active.record.id, contentRef.current, baseline, title);
      }
      const batch = replaceCurrentFiles
        ? await documentService.replaceImportedFiles(uniqueFiles)
        : { records: await documentService.registerFiles(uniqueFiles), removedIds: [], preservedIds: [] };
      const { records, removedIds, preservedIds } = batch;
      removedIds.forEach((id) => {
        sessionDocuments.current.delete(id);
        sessionFiles.current.delete(id);
        documentHistory.current.delete(id);
      });
      records.forEach((record, index) => {
        const picked = uniqueFiles[index];
        if (picked) sessionFiles.current.set(record.id, picked);
      });
      await refreshDocuments();
      const first = records[0];
      if (first) {
        await openRecord(first);
        navigate('markdown', new URLSearchParams({ document: first.id }));
      }
      const preservedCopy = preservedIds.length > 0 ? `；另保留 ${preservedIds.length} 份有未保存改动的文档` : '';
      setStatus(uniqueFiles.length >= 2_000
        ? '已打开前 2,000 个 Markdown 文件，其余文件未载入。'
        : replaceCurrentFiles
          ? `当前文件夹共 ${uniqueFiles.length} 个 Markdown 文件${preservedCopy}，文件会在点开时读取。`
          : `已打开 ${uniqueFiles.length} 个文件，其他文件会在点开时读取。`);
    } finally {
      setDocumentsBusy(false);
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
    markdownPreview.current?.commitActiveEdit();
    try {
      const picked = await pickMarkdownFiles();
      if (picked.length > 0) await importFiles(picked);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法打开所选文件。');
    }
  };

  const chooseDirectory = async () => {
    markdownPreview.current?.commitActiveEdit();
    openMenu.current?.removeAttribute('open');
    try {
      const picked = await pickMarkdownDirectory();
      if (picked.length > 0) await importFiles(picked, true);
      else setStatus('所选文件夹中没有 Markdown 文档。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法打开所选文件夹。');
    }
  };

  const importDrop = async (dataTransfer: DataTransfer) => {
    markdownPreview.current?.commitActiveEdit();
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
    const file = await resolvePickedMarkdownFile(picked);
    const loaded = await documentService.attachSource(active.record.id, file, picked.handle);
    if (loaded) activateDocument(loaded);
  };

  const saveCurrent = async () => {
    if (!active || active.needsSource) return;
    markdownPreview.current?.commitActiveEdit();
    const currentContent = contentRef.current;
    setStatus('正在保存…');
    let handle = active.record.fileHandle;
    let attachedNewHandle = false;
    try {
      if (!handle) {
        const selected = await pickMarkdownSaveFile(safeFileName(title, 'md'));
        if (selected === null) {
          setStatus('已取消保存，文件没有改动。');
          notify('已取消保存，原文件没有改动。');
          return;
        }
        if (selected === undefined) {
          const result = await (await getExporter('markdown')).export({ markdown: currentContent, title });
          downloadBlob(result.blob, result.fileName);
          await documentService.markDownloaded(active.record.id, currentContent);
          const record = await documentService.read(active.record.id);
          if (record) setActive({ record, content: currentContent, baseline: currentContent, needsSource: false });
          setBaseline(currentContent);
          sessionDocuments.current.set(active.record.id, { content: currentContent, baseline: currentContent });
          setDestination({ kind: 'downloaded-copy', label: title, detail: '浏览器不支持原地保存，已下载副本' });
          setStatus('当前浏览器不支持原地保存，已下载 Markdown 副本。');
          notify('浏览器不支持原地保存，已下载一个 Markdown 副本。', 'info');
          return;
        }
        handle = selected;
        attachedNewHandle = true;
      }

      const saved = await writeMarkdownFile(handle, currentContent);
      if (!saved) {
        setStatus('已取消保存，原文件没有改动。');
        notify('未获得写入权限，原文件没有改动。', 'info');
        return;
      }
      if (attachedNewHandle) await documentService.attachSavedFile(active.record.id, handle, title);
      await documentService.markSavedOriginal(active.record.id, title);
      const record = await documentService.read(active.record.id);
      if (record) {
        setActive({ record, content: currentContent, baseline: currentContent, needsSource: false });
        setDocuments((current) => current.map((item) => item.id === record.id ? record : item));
      }
      setBaseline(currentContent);
      sessionDocuments.current.set(active.record.id, { content: currentContent, baseline: currentContent });
      setDestination({ kind: 'original-file', label: handle.name || title, detail: '已写回原文件' });
      setStatus('已写回原文件。');
      notify(`已保存到原文件：${handle.name || title}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法写回原文件。';
      setStatus(`保存失败：${message}`);
      notify(`保存失败：${message}`, 'error');
    }
  };

  const exportCurrent = async (format: ExportFormat) => {
    if (!active || active.needsSource) return;
    markdownPreview.current?.commitActiveEdit();
    const currentContent = contentRef.current;
    setExporting(true);
    setStatus(`正在生成 ${format === 'docx' ? 'Word' : format.toUpperCase()}…`);
    try {
      const result = await (await getExporter(format)).export({
        markdown: currentContent,
        title,
        appearance: exportAppearanceFromSettings(settings),
      });
      downloadBlob(result.blob, result.fileName);
      setStatus(`已下载 ${result.fileName}。`);
      notify(`已导出 ${result.fileName}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出失败。';
      setStatus(message);
      notify(message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const chooseExportFormat = async (format: ExportFormat) => {
    exportMenu.current?.removeAttribute('open');
    if (settings.defaultExportFormat !== format) await updateSettings({ defaultExportFormat: format });
    await exportCurrent(format);
  };

  const copyHtml = async () => {
    markdownPreview.current?.commitActiveEdit();
    const currentContent = contentRef.current;
    try {
      const exported = await (await getExporter('html')).export({
        markdown: currentContent,
        title,
        appearance: exportAppearanceFromSettings(settings),
      });
      const html = await exported.blob.text();
      if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([currentContent], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      setStatus('正文 HTML 已复制。');
      notify('HTML 已复制，图表已包含在内。', 'success');
    } catch {
      setStatus('浏览器未允许写入剪贴板。');
      notify('浏览器未允许复制 HTML。', 'error');
    }
  };

  const printCurrent = async () => {
    if (!active || active.needsSource) return;
    markdownPreview.current?.commitActiveEdit();
    setMode('read');
    setStatus('正在准备打印内容…');
    notify('正在准备图表和分页…');
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));

    const pane = previewPane.current;
    const startedAt = Date.now();
    while (pane?.querySelector('pre:not([data-render-error]) > code.language-mermaid') && Date.now() - startedAt < 10_000) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }

    const details = [...(pane?.querySelectorAll<HTMLDetailsElement>('details') ?? [])];
    const detailStates = details.map((element) => element.open);
    details.forEach((element) => { element.open = true; });
    document.documentElement.classList.add('workbench-printing');
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.documentElement.classList.remove('workbench-printing');
      details.forEach((element, index) => { element.open = detailStates[index] ?? false; });
      setStatus('打印窗口已关闭。');
    };
    window.addEventListener('afterprint', restore, { once: true });
    setStatus('已准备好，可在打印窗口中选择“另存为 PDF”。');
    window.print();
    window.setTimeout(restore, 2_000);
  };

  const shareCurrent = () => {
    if (!active || active.needsSource) return;
    markdownPreview.current?.commitActiveEdit();
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast(null);
    setShareFormat(settings.defaultShareFormat);
    setShareAccess(defaultDocumentShareAccess(activeProfile));
    setShareError('');
    setGeneratedShare(null);
    setShareOpen(true);
  };

  const chooseShareFormat = (format: ExportFormat) => {
    setShareFormat(format);
    if (settings.defaultShareFormat !== format) void updateSettings({ defaultShareFormat: format });
  };

  const confirmShareCurrent = async () => {
    if (!active || active.needsSource || !activeProfile || !storageReady) return;
    const documentId = active.record.id;
    const currentContent = contentRef.current;
    setShareBusy(true);
    setShareError('');
    try {
      if (currentContent !== baseline || title !== active.record.title) {
        await documentService.updateDraft(documentId, currentContent, baseline, title);
      }
      const result = await shareMarkdownDocument({
        documentId,
        title,
        markdown: currentContent,
        format: shareFormat,
        appearance: exportAppearanceFromSettings(settings),
        access: shareAccess,
        profile: activeProfile,
      });
      const shareText = formatShareText(result.record, settings.shareCopyFormat);
      setGeneratedShare({ url: result.record.url, text: shareText });
      setActive((current) => current?.record.id === documentId ? {
        ...current,
        record: result.document,
      } : current);
      await refreshDocuments();
      setDestination({ kind: 'online-share', label: title, detail: '分享链接已生成' });
      try {
        await navigator.clipboard.writeText(shareText);
        setShareOpen(false);
        setGeneratedShare(null);
        setStatus('分享链接已生成并复制。');
        notify('分享链接已复制，可以直接发给别人。', 'success');
      } catch {
        setShareError('链接已经生成，但浏览器没有允许自动复制。请点击“复制分享内容”。');
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : '分享失败，请检查存储连接后重试。');
    } finally {
      setShareBusy(false);
    }
  };

  const copyGeneratedShare = async () => {
    if (!generatedShare) return;
    try {
      await navigator.clipboard.writeText(generatedShare.text);
      setShareOpen(false);
      setGeneratedShare(null);
      setShareError('');
      setStatus('分享链接已生成并复制。');
      notify('分享链接已复制，可以直接发给别人。', 'success');
    } catch {
      setShareError('浏览器没有允许复制，请在上方选中链接后复制。');
    }
  };

  const closeShareDialog = useCallback(() => {
    setShareOpen(false);
    setShareError('');
    setGeneratedShare(null);
  }, []);

  const openShareSettings = useCallback(() => {
    setShareOpen(false);
    setShareError('');
    setGeneratedShare(null);
    navigate('settings', new URLSearchParams({ section: 'storage' }));
  }, [navigate]);

  const removeDocument = async (record: DocumentRecord) => {
    if (!window.confirm(`从当前浏览器中移除“${record.title}”？原文件不会被删除。`)) return;
    await documentService.remove(record.id);
    sessionDocuments.current.delete(record.id);
    sessionFiles.current.delete(record.id);
    documentHistory.current.delete(record.id);
    if (active?.record.id === record.id) {
      setActive(null);
      setContent('');
      contentRef.current = '';
      setBaseline('');
      setRendered(EMPTY_RENDER);
      setDestination({ kind: 'browser-draft', label: 'Markdown 工作区', detail: '等待打开文档' });
      navigate('markdown');
    }
    await refreshDocuments();
  };

  const clearImportedDocuments = async () => {
    if (documentsBusy) {
      notify('文件夹仍在打开，请稍候再清空。');
      return;
    }
    if (!documents.some((record) => record.source !== 'new')) return;
    markdownPreview.current?.commitActiveEdit();
    if (!window.confirm('清空已打开的文件列表？\n\n这只会从 Workbench 中移除记录，不会删除电脑里的原文件。有未保存改动的文档会继续保留。')) return;
    setDocumentsBusy(true);
    setStatus('正在清理文件列表…');
    try {
      if (active && !active.needsSource && (contentRef.current !== baseline || title !== active.record.title)) {
        await documentService.updateDraft(active.record.id, contentRef.current, baseline, title);
      }
      const { removedIds, preservedIds } = await documentService.clearImportedDocuments();
      removedIds.forEach((id) => {
        sessionDocuments.current.delete(id);
        sessionFiles.current.delete(id);
        documentHistory.current.delete(id);
      });
      const activeStillExists = active ? await documentService.read(active.record.id) : undefined;
      if (active && !activeStillExists) {
        setActive(null);
        setContent('');
        contentRef.current = '';
        setBaseline('');
        setRendered(EMPTY_RENDER);
        setDestination({ kind: 'browser-draft', label: 'Markdown 工作区', detail: '等待打开文档' });
        navigate('markdown');
      }
      await refreshDocuments();
      const message = preservedIds.length > 0
        ? `已清空 ${removedIds.length} 个文件，保留 ${preservedIds.length} 份有未保存改动的文档。`
        : `已清空 ${removedIds.length} 个文件，电脑里的原文件没有删除。`;
      setStatus(message);
      notify(message, 'success');
    } finally {
      setDocumentsBusy(false);
    }
  };

  const currentPreviewSelection = useCallback(() => {
    const pane = previewPane.current;
    const selection = window.getSelection();
    if (!pane || !selection?.rangeCount || selection.isCollapsed) return '';
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    if (!pane.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode)) return '';
    return selection.toString().trim();
  }, []);

  const rememberPreviewSelection = useCallback(() => {
    const value = currentPreviewSelection();
    if (value) selectedPreviewText.current = value;
  }, [currentPreviewSelection]);

  const openFindPanel = useCallback((withReplace = false) => {
    if (!active) return;
    const previewSelection = currentPreviewSelection();
    if (previewSelection) selectedPreviewText.current = previewSelection;
    markdownPreview.current?.commitActiveEdit();
    const view = mode === 'source' && editorView.current?.dom.isConnected ? editorView.current : null;
    let selected = previewSelection || currentPreviewSelection() || selectedPreviewText.current;
    if (view) {
      const selection = view.state.selection.main;
      if (selection.from !== selection.to) selected = view.state.sliceDoc(selection.from, selection.to);
    }
    if (selected) setFindQuery(selected);
    setFindIndex(0);
    setFindOpen(true);
    setReplaceOpen(withReplace);
  }, [active, currentPreviewSelection, mode]);

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
    if (!findOpen || mode !== 'source') return;
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
    const next = replaceTextMatch(contentRef.current, match, replacement);
    if (next === contentRef.current) {
      notify('查找内容和替换内容相同，没有修改。');
      return;
    }
    applyContent(next);
    setStatus('已替换 1 处。');
    notify('已替换 1 处，可用撤销恢复。', 'success');
  };

  const replaceEveryMatch = () => {
    if (findMatches.length === 0) return;
    const count = findMatches.length;
    const next = replaceAllTextMatches(contentRef.current, findMatches, replacement);
    if (next === contentRef.current) {
      notify('查找内容和替换内容相同，没有修改。');
      return;
    }
    applyContent(next);
    setFindIndex(0);
    setStatus(`已替换 ${count} 处。`);
    notify(`已替换 ${count} 处，可用撤销恢复。`, 'success');
  };

  const selectReviewChange = useCallback((index: number) => {
    const change = reviewChanges[index];
    if (!change) return;
    setReviewIndex(index);
    setReviewInlineOpen(true);
    setReviewFocusVersion((current) => current + 1);
    if (mode === 'source') setMode('read');
  }, [mode, reviewChanges]);

  const stepReview = useCallback((direction: -1 | 1) => {
    if (reviewChanges.length === 0) return;
    selectReviewChange((reviewIndex + direction + reviewChanges.length) % reviewChanges.length);
  }, [reviewChanges.length, reviewIndex, selectReviewChange]);

  const revertChange = useCallback((change: ReviewChange) => {
    applyContent(revertReviewChange(contentRef.current, change));
    setStatus('已撤回这处改动。');
  }, [applyContent]);

  const revertAllChanges = () => {
    if (reviewChanges.length === 0) return;
    if (!window.confirm(`撤回全部 ${reviewChanges.length} 处未保存改动？`)) return;
    applyContent(baseline);
    setReviewIndex(0);
    setStatus('已恢复到上次保存的内容。');
  };

  const scrollElement = useCallback((): HTMLElement | null => {
    if (mode === 'source') {
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

  useEffect(() => {
    const pane = previewPane.current;
    if (!pane || mode === 'source' || rendered.headings.length === 0) {
      setActiveHeadingId('');
      return;
    }
    const update = () => {
      const paneTop = pane.getBoundingClientRect().top + 56;
      let current = rendered.headings[0]?.id ?? '';
      for (const heading of rendered.headings) {
        const element = pane.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`);
        if (element && element.getBoundingClientRect().top <= paneTop) current = heading.id;
      }
      setActiveHeadingId(current);
    };
    const frame = window.requestAnimationFrame(update);
    pane.addEventListener('scroll', update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      pane.removeEventListener('scroll', update);
    };
  }, [mode, rendered.headings, rendered.html]);

  const scrollToHeading = useCallback((heading: MarkdownRenderResult['headings'][number]) => {
    previewPane.current?.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveHeadingId(heading.id);
    if (isNarrowViewport()) setRailOpen(false);
  }, []);

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
  const previewReview = useMemo(() => active && !active.needsSource && reviewChanges.length > 0 ? {
    changes: reviewChanges,
    current: reviewIndex,
    focusVersion: reviewFocusVersion,
    showMarks: reviewShowMarks,
    showAll: reviewShowAll,
    showCurrent: reviewInlineOpen,
    onSelect: selectReviewChange,
    onStep: stepReview,
    onRevert: revertChange,
    onCollapseInline: () => {
      setReviewShowAll(false);
      setReviewInlineOpen(false);
    },
  } : undefined, [
    active,
    reviewChanges,
    reviewFocusVersion,
    reviewIndex,
    reviewInlineOpen,
    reviewShowAll,
    reviewShowMarks,
    revertChange,
    selectReviewChange,
    stepReview,
  ]);

  return (
    <div
      className={`markdown-workspace ${railOpen ? '' : 'markdown-workspace--rail-closed'}`}
      onMouseDownCapture={(event) => {
        const target = event.target as Element;
        if (target.closest('button')?.getAttribute('aria-label') === '撤销') return;
        if (!previewPane.current?.contains(target)) {
          rememberPreviewSelection();
          markdownPreview.current?.commitActiveEdit();
        }
      }}
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
      <header className="markdown-toolbar" onMouseDownCapture={rememberPreviewSelection}>
        <div className="markdown-toolbar__group markdown-toolbar__documents">
          <IconButton icon={railOpen ? PanelLeftClose : PanelLeftOpen} label={railOpen ? '收起文件和目录' : '展开文件和目录'} onClick={toggleRail} />
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
          <button aria-pressed={mode === 'read'} className={mode === 'read' ? 'is-active' : ''} onClick={() => { markdownPreview.current?.commitActiveEdit(); setMode('read'); }} title="阅读" type="button"><Eye aria-hidden="true" size={15} /><span>阅读</span></button>
          <button aria-pressed={mode !== 'read'} className={mode !== 'read' ? 'is-active' : ''} onClick={() => setMode('edit')} title="直接在正文中编辑" type="button"><PencilLine aria-hidden="true" size={15} /><span>编辑</span></button>
        </div>

        <div className="markdown-toolbar__group markdown-toolbar__edit-actions">
          <IconButton
            className="history-action"
            disabled={!active || mode === 'read'}
            icon={Undo2}
            label="撤销"
            onClick={(event) => { if (event.detail === 0) undoCurrent(); }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              undoCurrent();
            }}
          />
          <IconButton
            className="history-action"
            disabled={!active || mode === 'read'}
            icon={Redo2}
            label="重做"
            onClick={(event) => { if (event.detail === 0) redoCurrent(); }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              redoCurrent();
            }}
          />
          {mode !== 'read' ? <IconButton active={mode === 'source'} disabled={!active} icon={Code2} label={mode === 'source' ? '返回正文编辑' : '编辑 Markdown 源文件（高级）'} onClick={() => { markdownPreview.current?.commitActiveEdit(); setMode((current) => current === 'source' ? 'edit' : 'source'); }} /> : null}
          <IconButton active={findOpen} disabled={!active} icon={Search} label="查找和替换" onClick={() => openFindPanel(false)} />
          <div className="change-review-control" ref={reviewControl}>
            <Button className={reviewOpen ? 'review-toggle review-toggle--active' : 'review-toggle'} disabled={!active || active.needsSource} icon={FileDiff} onClick={() => {
              markdownPreview.current?.commitActiveEdit();
              setReviewOpen((value) => {
                if (!value && reviewChanges.length > 0) {
                  setReviewShowAll(false);
                  setReviewInlineOpen(true);
                  setReviewFocusVersion((current) => current + 1);
                }
                return !value;
              });
            }} size="small">{reviewChanges.length > 0 ? `改动 ${reviewChanges.length}` : '改动'}</Button>
            {active && !active.needsSource && reviewOpen ? (
              <ChangeReviewPanel
                changes={reviewChanges}
                current={reviewIndex}
                destinationLabel={destinationCopy(active.record, hasChanges).detail}
                onClose={() => setReviewOpen(false)}
                onRevert={revertChange}
                onRevertAll={revertAllChanges}
                onSave={() => void saveCurrent()}
                onSelect={selectReviewChange}
                onShowMarksChange={rememberReviewShowMarks}
                onStep={stepReview}
                onViewAll={() => { setReviewShowAll(true); setReviewInlineOpen(true); setReviewFocusVersion((current) => current + 1); }}
                onViewCurrent={() => { setReviewShowAll(false); setReviewInlineOpen(true); setReviewFocusVersion((current) => current + 1); }}
                showAll={reviewShowAll}
                showCurrent={reviewInlineOpen}
                showMarks={reviewShowMarks}
              />
            ) : null}
          </div>
        </div>

        <div className="markdown-toolbar__group markdown-toolbar__output-actions">
          <IconButton className="output-action--optional" disabled={!active?.content && !content} icon={Copy} label="复制 HTML" onClick={() => void copyHtml()} />
          <IconButton className="output-action--optional" disabled={!active || active.needsSource} icon={Printer} label="打印或另存 PDF" onClick={() => void printCurrent()} />
          <ReadingSettingsPanel />
          <div className="export-control">
            <Button className="export-control__primary" disabled={exporting || !active || active.needsSource} icon={Download} onClick={() => void exportCurrent(settings.defaultExportFormat)} size="small">导出 {EXPORT_LABELS[settings.defaultExportFormat]}</Button>
            <details className="export-menu" ref={exportMenu}>
              <summary aria-label="选择导出格式" title="选择导出格式"><ChevronDown aria-hidden="true" size={15} /></summary>
              <div className="export-menu__panel">
                <button aria-current={settings.defaultExportFormat === 'html' ? 'true' : undefined} disabled={exporting || !active} onClick={() => void chooseExportFormat('html')} type="button"><strong>HTML 网页</strong><small>可独立打开的本地网页</small></button>
                <button aria-current={settings.defaultExportFormat === 'docx' ? 'true' : undefined} disabled={exporting || !active} onClick={() => void chooseExportFormat('docx')} type="button"><strong>Word 文档</strong><small>可继续编辑的 DOCX</small></button>
                <button aria-current={settings.defaultExportFormat === 'markdown' ? 'true' : undefined} disabled={exporting || !active} onClick={() => void chooseExportFormat('markdown')} type="button"><strong>Markdown</strong><small>保留原始文本</small></button>
              </div>
            </details>
          </div>
          <Button disabled={!active || active.needsSource} icon={Save} onClick={() => void saveCurrent()} size="small">保存</Button>
          <Button disabled={!active || active.needsSource} icon={Share2} onClick={shareCurrent} size="small" variant="primary">分享</Button>
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
        {railOpen ? <button aria-label="关闭侧栏" className="document-rail-scrim" onClick={() => setRailOpen(false)} type="button" /> : null}
        <DocumentRail
          activeHeadingId={activeHeadingId}
          activeId={active?.record.id}
          busy={documentsBusy}
          documents={documents}
          headings={active && !active.needsSource && mode !== 'source' ? rendered.headings : []}
          onClear={() => void clearImportedDocuments()}
          onHeading={scrollToHeading}
          onOpen={(document) => void openRecord(document)}
          onRemove={(document) => void removeDocument(document)}
        />

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
            {mode === 'source' ? (
              <div className="editor-pane">
                <CodeMirror
                  basicSetup={{ foldGutter: true, highlightActiveLine: true, highlightActiveLineGutter: true, autocompletion: true }}
                  extensions={extensions}
                  height="100%"
                  onChange={(value) => applyContent(value, false)}
                  onCreateEditor={(view) => {
                    editorView.current = view;
                  }}
                  placeholder="从这里开始写作…"
                  value={content}
                />
              </div>
            ) : null}
            {mode !== 'source' ? (
              <div
                className="preview-pane"
                onMouseDown={() => { selectedPreviewText.current = ''; }}
                onMouseUp={rememberPreviewSelection}
                ref={previewPane}
              >
                <MarkdownPreview
                  blocks={rendered.blocks}
                  editable={mode === 'edit'}
                  html={rendered.html}
                  markdown={content}
                  onMarkdownChange={applyContent}
                  onNotify={notify}
                  onTaskToggle={handleTaskToggle}
                  ref={markdownPreview}
                  review={previewReview}
                  search={findOpen ? { query: findQuery, matchCase, current: findIndex } : undefined}
                />
              </div>
            ) : null}
          </section>
        )}

        {active && !active.needsSource && (reviewChanges.length > 0 || scrollEdges.canGoTop || scrollEdges.canGoBottom) ? (
          <nav aria-label="文档快速导航" className="workspace-float-controls">
            {reviewChanges.length > 0 ? (
              <div className="workspace-float-controls__group workspace-float-controls__changes">
                <IconButton icon={ChevronUp} label="上一处改动" onClick={() => stepReview(-1)} />
                <button aria-label="打开改动审阅" className="workspace-change-count" onClick={() => { setReviewOpen(true); selectReviewChange(reviewIndex); }} title="打开改动审阅" type="button"><FileDiff aria-hidden="true" size={15} /><span>{reviewIndex + 1}/{reviewChanges.length}</span></button>
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

      {toast ? <div className={`workspace-toast workspace-toast--${toast.kind}`} key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.message}</div> : null}

      <ShareDocumentDialog
        access={shareAccess}
        busy={shareBusy}
        error={shareError}
        format={shareFormat}
        generatedUrl={generatedShare?.url ?? ''}
        onAccessChange={setShareAccess}
        onClose={closeShareDialog}
        onConfirm={() => void confirmShareCurrent()}
        onCopyGenerated={() => void copyGeneratedShare()}
        onFormatChange={chooseShareFormat}
        onOpenSettings={openShareSettings}
        open={shareOpen}
        profile={activeProfile}
        storageReady={storageReady}
        title={title}
      />

      <OpenDocumentDialog onClose={() => setOpenDialog(null)} onFiles={importFiles} onUrl={importUrl} open={openDialog !== null} sourceMode={openDialog ?? 'all'} />
    </div>
  );
}
