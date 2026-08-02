import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { openSearchPanel } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
  Code2,
  Columns2,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Redo2,
  Save,
  Search,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';

import { useDestination } from '@/app/destination-context';
import { renderMarkdown, type MarkdownRenderResult } from '@/features/markdown/engine/render-markdown';
import { getExporter } from '@/features/markdown/exporters/registry';
import { MarkdownPreview } from '@/features/markdown/components/MarkdownPreview';
import { toggleTask } from '@/features/markdown/engine/toggle-task';
import { OpenDocumentDialog } from '@/features/markdown/components/OpenDocumentDialog';
import { loadMarkdownUrl } from '@/features/markdown/services/load-markdown-url';
import { documentHandoff } from '@/features/markdown/services/document-handoff';
import type { PageProps } from '@/features/shared/page-props';
import { downloadBlob } from '@/platform/files/download-blob';
import { pickMarkdownFiles, type PickedMarkdownFile } from '@/platform/files/file-picker';
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
  const [mode, setMode] = useState<EditorMode>('split');
  const [rendered, setRendered] = useState<MarkdownRenderResult>(EMPTY_RENDER);
  const [openDialog, setOpenDialog] = useState(false);
  const [railOpen, setRailOpen] = useState(() => !isNarrowViewport());
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const editorView = useRef<EditorView | null>(null);
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
      setOpenDialog(true);
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

  const handleTaskToggle = useCallback((taskIndex: number, checked: boolean) => {
    setContent((current) => toggleTask(current, taskIndex, checked));
  }, []);

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

  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping], []);

  return (
    <div className={`markdown-workspace ${railOpen ? '' : 'markdown-workspace--rail-closed'}`}>
      <header className="markdown-toolbar">
        <div className="markdown-toolbar__group markdown-toolbar__documents">
          <IconButton icon={railOpen ? PanelLeftClose : PanelLeftOpen} label={railOpen ? '收起文档列表' : '展开文档列表'} onClick={() => setRailOpen((value) => !value)} />
          <Button icon={FolderOpen} onClick={() => setOpenDialog(true)} size="small">打开</Button>
          <IconButton icon={FilePlus2} label="新建文档" onClick={() => void createDocument()} />
        </div>

        <label className="document-title-field">
          <span className="sr-only">文档名称</span>
          <input disabled={!active} onChange={(event) => setTitle(event.target.value)} value={active ? title : '未打开文档'} />
        </label>

        <div className="markdown-toolbar__group markdown-toolbar__modes" aria-label="工作区模式">
          <IconButton active={mode === 'preview'} icon={Eye} label="阅读" onClick={() => setMode('preview')} />
          <IconButton active={mode === 'split'} icon={Columns2} label="分屏" onClick={() => setMode('split')} />
          <IconButton active={mode === 'source'} icon={Code2} label="源码" onClick={() => setMode('source')} />
        </div>

        <div className="markdown-toolbar__group markdown-toolbar__edit-actions">
          <IconButton disabled={!active || mode === 'preview'} icon={Undo2} label="撤销" onClick={() => { if (editorView.current) undo(editorView.current); }} />
          <IconButton disabled={!active || mode === 'preview'} icon={Redo2} label="重做" onClick={() => { if (editorView.current) redo(editorView.current); }} />
          <IconButton disabled={!active || mode === 'preview'} icon={Search} label="查找和替换" onClick={() => { if (editorView.current) openSearchPanel(editorView.current); }} />
        </div>

        <div className="markdown-toolbar__group markdown-toolbar__output-actions">
          <IconButton disabled={!active?.content && !content} icon={Copy} label="复制 HTML" onClick={() => void copyHtml()} />
          <IconButton disabled={!active || active.needsSource} icon={Printer} label="打印或另存 PDF" onClick={() => { setMode('preview'); window.setTimeout(() => window.print(), 80); }} />
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
            <div><Button icon={FolderOpen} onClick={() => setOpenDialog(true)} variant="primary">打开文档</Button><Button icon={FilePlus2} onClick={() => void createDocument()}>新建文档</Button></div>
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
                  onChange={(value) => {
                    setContent(value);
                    if (active) sessionDocuments.current.set(active.record.id, { content: value, baseline });
                  }}
                  onCreateEditor={(view) => { editorView.current = view; }}
                  placeholder="从这里开始写作…"
                  value={content}
                />
              </div>
            ) : null}
            {mode !== 'source' ? (
              <div className="preview-pane"><MarkdownPreview html={rendered.html} onTaskToggle={handleTaskToggle} /></div>
            ) : null}
          </section>
        )}

        {active && !active.needsSource && mode !== 'source' && rendered.headings.length > 0 ? (
          <aside className="markdown-outline">
            <strong>大纲</strong>
            <nav>{rendered.headings.map((heading) => <button className={`outline-level-${heading.level}`} key={heading.id} onClick={() => document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} type="button">{heading.text}</button>)}</nav>
          </aside>
        ) : null}
      </div>

      <footer className="workspace-statusbar">
        <span>{active ? active.record.sourceLabel : '未打开文档'}</span>
        <span>{status || (hasChanges ? '有未保存改动' : active ? '没有未保存改动' : '')}</span>
        <span>{rendered.wordCount.toLocaleString('zh-CN')} 字 · 约 {rendered.readingMinutes} 分钟</span>
      </footer>

      <OpenDocumentDialog onClose={() => setOpenDialog(false)} onFiles={importFiles} onUrl={importUrl} open={openDialog} />
    </div>
  );
}
