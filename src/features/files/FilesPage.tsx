import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clipboard,
  Cloud,
  CloudUpload,
  Download,
  ExternalLink,
  FileArchive,
  FolderUp,
  Link2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { browser } from 'wxt/browser';

import { useDestination } from '@/app/destination-context';
import { useSettings } from '@/app/settings-context';
import { getActiveStorageProfile, isStorageProfileConfigured } from '@/app/storage-status';
import type { RemoteFile, UploadResult } from '@/connectors/storage/contract';
import { storageService } from '@/connectors/storage/storage-service';
import { formatShareText } from '@/features/files/share-text';
import { documentHandoff } from '@/features/markdown/services/document-handoff';
import { getExporter } from '@/features/markdown/exporters/registry';
import type { ExportFormat } from '@/features/markdown/exporters/contract';
import type { PageProps } from '@/features/shared/page-props';
import { db, type ShareRecord } from '@/shared/persistence/database';
import { documentService } from '@/shared/persistence/document-service';
import type { StorageProfile } from '@/shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { StatusPill } from '@/shared/ui/StatusPill';

import './files-page.css';

type UploadStatus = 'queued' | 'uploading' | 'success' | 'failed' | 'cancelled';

interface UploadTask {
  id: string;
  file: File;
  fileName: string;
  category: string;
  status: UploadStatus;
  progress: number;
  error: string;
  result?: UploadResult;
  controller: AbortController;
}

interface PendingDocumentShare {
  documentId: string;
  title: string;
  content: string;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value);
}

function accessLabel(record: Pick<ShareRecord, 'access' | 'expiresAt'>): string {
  if (record.access === 'public') return '公开链接';
  if (record.access === 'signed') return record.expiresAt ? `限时链接 · ${formatDate(record.expiresAt)}` : '限时链接';
  if (record.access === 'authenticated') return '需要登录';
  return '访问权限由服务决定';
}

function defaultAccess(profile: StorageProfile | undefined): 'private' | 'public' | 'provider-managed' {
  if (!profile || profile.provider === 'gateway') return 'provider-managed';
  return profile.defaultAccess;
}

export function FilesPage({ route, navigate }: PageProps) {
  const { settings } = useSettings();
  const { resetDestination, setDestination } = useDestination();
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [history, setHistory] = useState<ShareRecord[]>([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'history' | 'cloud'>('history');
  const [cloudFiles, setCloudFiles] = useState<RemoteFile[]>([]);
  const [cloudStatus, setCloudStatus] = useState('');
  const [cloudLoading, setCloudLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingDocumentShare | null>(null);
  const [shareFormat, setShareFormat] = useState<ExportFormat>(settings.defaultShareFormat);
  const [shareAccess, setShareAccess] = useState<'private' | 'public' | 'provider-managed'>('provider-managed');
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pendingQueue = useRef<UploadTask[]>([]);
  const activeUploads = useRef(0);
  const profileRef = useRef<StorageProfile | undefined>(undefined);
  const settingsRef = useRef(settings);
  const handledIntent = useRef('');

  const activeProfile = useMemo(
    () => getActiveStorageProfile(settings.storageProfiles, settings.activeStorageProfileId),
    [settings.activeStorageProfileId, settings.storageProfiles],
  );
  const storageReady = isStorageProfileConfigured(activeProfile);
  profileRef.current = activeProfile;
  settingsRef.current = settings;

  const refreshHistory = useCallback(async () => {
    setHistory(await db.shares.orderBy('createdAt').reverse().toArray());
  }, []);

  useEffect(() => {
    resetDestination();
    void refreshHistory();
  }, [refreshHistory, resetDestination]);

  useEffect(() => {
    setShareAccess(defaultAccess(activeProfile));
  }, [activeProfile]);

  useEffect(() => {
    const intent = route.params.get('intent');
    const documentId = route.params.get('document');
    const key = `${intent ?? ''}:${documentId ?? ''}`;
    if (handledIntent.current === key) return;
    handledIntent.current = key;
    if (intent === 'upload') {
      if (storageReady) fileInput.current?.click();
      else navigate('settings', new URLSearchParams({ section: 'storage' }));
    }
    if (intent === 'share' && documentId) {
      const handoff = documentHandoff.take(documentId);
      if (handoff) {
        setPendingShare(handoff);
        return;
      }
      void documentService.load(documentId).then((loaded) => {
        if (loaded?.content !== null && loaded?.content !== undefined) {
          setPendingShare({ documentId, title: loaded.record.title, content: loaded.content });
        } else {
          setShareMessage('当前文档没有恢复草稿，请回到 Markdown 工作区重新选择原文件。');
        }
      });
    }
  }, [navigate, route.params, storageReady]);

  const updateTask = (id: string, patch: Partial<UploadTask>) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  };

  const createShareRecord = async (
    profile: StorageProfile,
    fileName: string,
    contentType: string,
    category: string,
    result: UploadResult,
  ): Promise<ShareRecord> => {
    const record: ShareRecord = {
      id: nanoid(),
      fileName,
      displayName: fileName,
      size: result.size,
      contentType,
      url: result.url,
      objectKey: result.objectKey,
      access: result.access,
      expiresAt: result.expiresAt,
      category,
      storageProfileId: profile.id,
      storageProvider: profile.provider,
      createdAt: Date.now(),
    };
    await db.shares.add(record);
    return record;
  };

  const copyRecord = async (record: ShareRecord) => {
    try {
      await navigator.clipboard.writeText(formatShareText(record, settingsRef.current.shareCopyFormat));
      setShareMessage(`已复制“${record.displayName}”的分享信息。`);
    } catch {
      setShareMessage('浏览器未允许写入剪贴板。');
    }
  };

  async function uploadTask(task: UploadTask) {
    const profile = profileRef.current;
    if (!profile || !isStorageProfileConfigured(profile)) {
      updateTask(task.id, { status: 'failed', error: '请先连接存储。' });
      return;
    }
    updateTask(task.id, { status: 'uploading', progress: 0, error: '' });
    try {
      const result = await storageService.upload(profile, {
        blob: task.file,
        fileName: task.fileName,
        contentType: task.file.type || 'application/octet-stream',
        access: defaultAccess(profile),
        signal: task.controller.signal,
        onProgress: (progress) => updateTask(task.id, { progress }),
      });
      const record = await createShareRecord(profile, task.fileName, task.file.type || 'application/octet-stream', task.category, result);
      task.result = result;
      updateTask(task.id, { status: 'success', progress: 1, result });
      setDestination({ kind: 'online-share', label: task.fileName, detail: accessLabel(record) });
      await refreshHistory();
      if (settingsRef.current.autoCopyShareLink) await copyRecord(record);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        updateTask(task.id, { status: 'cancelled', error: '上传已取消。' });
      } else {
        updateTask(task.id, { status: 'failed', error: error instanceof Error ? error.message : '上传失败。' });
      }
    }
  }

  function pumpQueue() {
    const limit = settingsRef.current.uploadConcurrency;
    while (activeUploads.current < limit && pendingQueue.current.length > 0) {
      const task = pendingQueue.current.shift();
      if (!task || task.status !== 'queued') continue;
      activeUploads.current += 1;
      void uploadTask(task).finally(() => {
        activeUploads.current -= 1;
        pumpQueue();
      });
    }
  }

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!storageReady) {
      navigate('settings', new URLSearchParams({ section: 'storage' }));
      return;
    }
    const next = files.map((file): UploadTask => {
      const relativeName = file.webkitRelativePath || file.name;
      return {
        id: nanoid(),
        file,
        fileName: relativeName,
        category: file.webkitRelativePath.split('/')[0] || '未分类',
        status: 'queued',
        progress: 0,
        error: '',
        controller: new AbortController(),
      };
    });
    pendingQueue.current.push(...next);
    setTasks((current) => [...next, ...current]);
    pumpQueue();
  };

  const cancelTask = (task: UploadTask) => {
    if (task.status === 'uploading') task.controller.abort();
    if (task.status === 'queued') {
      task.status = 'cancelled';
      pendingQueue.current = pendingQueue.current.filter((item) => item.id !== task.id);
      updateTask(task.id, { status: 'cancelled', error: '上传已取消。' });
    }
  };

  const retryTask = (task: UploadTask) => {
    task.status = 'queued';
    task.controller = new AbortController();
    task.progress = 0;
    task.error = '';
    pendingQueue.current.push(task);
    updateTask(task.id, { status: 'queued', progress: 0, error: '', controller: task.controller });
    pumpQueue();
  };

  const shareDocument = async () => {
    if (!pendingShare || !activeProfile || !storageReady) return;
    setSharing(true);
    setShareMessage('正在生成文件并上传…');
    try {
      const exported = await (await getExporter(shareFormat)).export({ markdown: pendingShare.content, title: pendingShare.title });
      const result = await storageService.upload(activeProfile, {
        blob: exported.blob,
        fileName: exported.fileName,
        contentType: exported.mimeType,
        access: shareAccess,
      });
      const record = await createShareRecord(activeProfile, exported.fileName, exported.mimeType, 'Markdown 分享', result);
      await documentService.markShared(pendingShare.documentId);
      setDestination({ kind: 'online-share', label: pendingShare.title, detail: accessLabel(record) });
      await refreshHistory();
      await copyRecord(record);
      setShareMessage(`${accessLabel(record)}已生成，分享信息已复制。`);
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : '在线分享失败，本地文档没有受到影响。');
    } finally {
      setSharing(false);
    }
  };

  const loadCloudFiles = async () => {
    if (!activeProfile || !storageReady) {
      setCloudStatus('请先连接存储。');
      return;
    }
    setCloudLoading(true);
    setCloudStatus('正在读取云端文件…');
    try {
      const files = await storageService.list(activeProfile);
      setCloudFiles(files);
      setCloudStatus(files.length > 0 ? `已读取 ${files.length} 个对象。` : '当前前缀下没有文件。');
    } catch (error) {
      setCloudStatus(error instanceof Error ? error.message : '无法读取云端文件。');
    } finally {
      setCloudLoading(false);
    }
  };

  const removeHistory = async (record: ShareRecord) => {
    if (!window.confirm(`只删除当前浏览器中的“${record.displayName}”记录？云端文件不会被删除。`)) return;
    await db.shares.delete(record.id);
    await refreshHistory();
  };

  const filteredHistory = history.filter((record) => {
    const keyword = search.trim().toLocaleLowerCase();
    return !keyword || record.displayName.toLocaleLowerCase().includes(keyword) || record.category.toLocaleLowerCase().includes(keyword);
  });

  return (
    <div
      className="files-page page-frame"
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}
      onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length > 0) addFiles(files); }}
    >
      <header className="page-intro files-intro">
        <div><p className="page-kicker">文件与分享</p><h1>上传、记录与分享</h1><p>本地记录和云端对象分开管理，删除记录不会误删远端文件。</p></div>
        <StatusPill tone={storageReady ? 'success' : 'warning'}>{storageReady ? `使用 ${activeProfile?.name}` : '存储尚未配置'}</StatusPill>
      </header>

      {pendingShare ? (
        <section className="document-share-panel">
          <div className="document-share-panel__heading"><div><p className="page-kicker">在线分享</p><h2>{pendingShare.title}</h2><p>将当前内容生成一个新文件后上传，不会创建在线编辑页。</p></div><IconButton icon={X} label="关闭分享" onClick={() => setPendingShare(null)} /></div>
          <div className="document-share-options">
            <div><span>分享格式</span><div className="segmented-control"><button aria-pressed={shareFormat === 'html'} onClick={() => setShareFormat('html')} type="button">HTML</button><button aria-pressed={shareFormat === 'docx'} onClick={() => setShareFormat('docx')} type="button">Word</button><button aria-pressed={shareFormat === 'markdown'} onClick={() => setShareFormat('markdown')} type="button">Markdown</button></div></div>
            {activeProfile?.provider === 'aliyun-oss' ? <div><span>访问方式</span><div className="segmented-control"><button aria-pressed={shareAccess === 'private'} onClick={() => setShareAccess('private')} type="button">私有限时链接</button><button aria-pressed={shareAccess === 'public'} onClick={() => setShareAccess('public')} type="button">公开链接</button></div></div> : <div><span>访问方式</span><p>访问权限由上传网关决定。</p></div>}
          </div>
          {!storageReady ? <div className="inline-warning"><span>在线分享需要先连接存储。</span><Button icon={Settings2} onClick={() => navigate('settings', new URLSearchParams({ section: 'storage' }))} size="small">连接存储</Button></div> : null}
          {shareMessage ? <p className="share-message" role="status">{shareMessage}</p> : null}
          <div className="document-share-panel__actions"><Button disabled={sharing || !storageReady} icon={CloudUpload} onClick={() => void shareDocument()} variant="primary">{sharing ? '正在分享' : '生成并复制链接'}</Button></div>
        </section>
      ) : null}

      <section className={`upload-zone ${dragging ? 'upload-zone--dragging' : ''}`} onClick={() => { if (storageReady) fileInput.current?.click(); else navigate('settings', new URLSearchParams({ section: 'storage' })); }} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key !== 'Enter' && event.key !== ' ') return; if (storageReady) fileInput.current?.click(); else navigate('settings', new URLSearchParams({ section: 'storage' })); }}>
        <span className="upload-zone__icon"><CloudUpload aria-hidden="true" size={26} /></span>
        <span><strong>{storageReady ? '拖入、选择或粘贴文件' : '连接存储后即可上传'}</strong><small>{storageReady ? '选择后立即进入上传队列；等待中的文件可以重命名或取消。' : '本地 Markdown 编辑、导出和分享记录仍可使用。'}</small></span>
        <div className="upload-zone__actions"><Button icon={Upload} onClick={(event) => { event.stopPropagation(); if (storageReady) fileInput.current?.click(); else navigate('settings', new URLSearchParams({ section: 'storage' })); }} size="small" variant="primary">选择文件</Button><Button disabled={!storageReady} icon={FolderUp} onClick={(event) => { event.stopPropagation(); folderInput.current?.click(); }} size="small">选择文件夹</Button></div>
        <input className="sr-only" multiple onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = ''; }} ref={fileInput} type="file" />
        <input className="sr-only" multiple onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = ''; }} ref={folderInput} type="file" {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />
      </section>

      {tasks.length > 0 ? (
        <section className="upload-queue">
          <div className="section-heading"><div><h2>上传队列</h2><p>同时上传 {settings.uploadConcurrency} 个文件。</p></div><Button onClick={() => setTasks((current) => current.filter((task) => task.status === 'queued' || task.status === 'uploading'))} size="small" variant="quiet">清理已完成</Button></div>
          <div className="upload-task-list">
            {tasks.map((task) => (
              <div className="upload-task" key={task.id}>
                <span className={`upload-task__state upload-task__state--${task.status}`}>{task.status === 'success' ? <Check size={16} /> : task.status === 'failed' ? <X size={16} /> : <FileArchive size={16} />}</span>
                <span className="upload-task__copy"><input aria-label="上传文件名" disabled={task.status !== 'queued'} onChange={(event) => { task.fileName = event.target.value; updateTask(task.id, { fileName: event.target.value }); }} value={task.fileName} /><small>{formatBytes(task.file.size)} · {task.error || ({ queued: '等待上传', uploading: `上传中 ${Math.round(task.progress * 100)}%`, success: '上传成功', failed: '上传失败', cancelled: '已取消' }[task.status])}</small></span>
                <span className="upload-task__progress"><i style={{ width: `${Math.round(task.progress * 100)}%` }} /></span>
                {task.status === 'failed' || task.status === 'cancelled' ? <IconButton icon={RotateCcw} label="重试" onClick={() => retryTask(task)} /> : task.status === 'success' && task.result ? <IconButton icon={Clipboard} label="复制链接" onClick={() => void navigator.clipboard.writeText(task.result?.url ?? '')} /> : <IconButton icon={X} label="取消上传" onClick={() => cancelTask(task)} />}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="file-library">
        <div className="file-library__toolbar">
          <div className="segmented-control"><button aria-pressed={view === 'history'} onClick={() => setView('history')} type="button">分享记录</button><button aria-pressed={view === 'cloud'} onClick={() => { setView('cloud'); if (cloudFiles.length === 0) void loadCloudFiles(); }} type="button">云端文件</button></div>
          {view === 'history' ? <label className="library-search"><Search aria-hidden="true" size={16} /><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或分类" value={search} /></label> : <Button disabled={cloudLoading} icon={RefreshCw} onClick={() => void loadCloudFiles()} size="small">刷新</Button>}
        </div>

        {view === 'history' ? (
          filteredHistory.length === 0 ? <div className="empty-state"><Link2 aria-hidden="true" size={24} /><div><strong>{history.length === 0 ? '还没有分享记录' : '没有匹配的记录'}</strong><p>{history.length === 0 ? '上传或分享成功后，链接会保存在当前浏览器中。' : '换个关键词试试。'}</p></div></div> :
          <div className="share-record-list">
            {filteredHistory.map((record) => (
              <div className="share-record" key={record.id}>
                <span className="share-record__icon"><Link2 aria-hidden="true" size={17} /></span>
                <span className="share-record__main"><strong>{record.displayName}</strong><small>{record.category} · {formatBytes(record.size)} · {record.storageProvider === 'gateway' ? '上传网关' : '阿里云 OSS'}</small></span>
                <StatusPill tone={record.access === 'public' ? 'success' : record.access === 'signed' ? 'primary' : 'warning'}>{accessLabel(record)}</StatusPill>
                <time>{formatDate(record.createdAt)}</time>
                <div className="share-record__actions"><IconButton icon={Clipboard} label="复制分享信息" onClick={() => void copyRecord(record)} /><IconButton icon={ExternalLink} label="打开链接" onClick={() => void browser.tabs.create({ url: record.url })} /><IconButton icon={Download} label="下载文件" onClick={() => void browser.downloads.download({ url: record.url, filename: record.displayName })} /><IconButton icon={Trash2} label="只删除本地记录" onClick={() => void removeHistory(record)} /></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="cloud-file-view">
            {cloudStatus ? <p className="cloud-status" role="status">{cloudStatus}</p> : null}
            {cloudFiles.map((file) => <div className="cloud-file-row" key={file.objectKey}><Cloud aria-hidden="true" size={17} /><span><strong>{file.name}</strong><small>{file.objectKey}</small></span><span>{formatBytes(file.size)}</span>{file.url ? <IconButton icon={ExternalLink} label="打开公开链接" onClick={() => void browser.tabs.create({ url: file.url ?? '' })} /> : <span />}</div>)}
          </div>
        )}
      </section>
    </div>
  );
}
