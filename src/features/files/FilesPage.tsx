import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Folder,
  FolderPlus,
  FolderUp,
  Link2,
  Pencil,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { browser } from 'wxt/browser';

import { useDestination } from '@/app/destination-context';
import { useSettings } from '@/app/settings-context';
import { getActiveStorageProfile, isStorageProfileConfigured } from '@/app/storage-status';
import type { UploadResult } from '@/connectors/storage/contract';
import { storageService } from '@/connectors/storage/storage-service';
import {
  basename,
  FILE_KIND_LABELS,
  FILE_KINDS,
  fileKindForName,
  normalizeCategoryName,
  topFolder,
  UNCATEGORIZED,
  type FileKind,
} from '@/features/files/file-library';
import { downloadRemoteFile } from '@/features/files/remote-download';
import { formatShareRecords, formatShareText } from '@/features/files/share-text';
import type { ExportFormat } from '@/features/markdown/exporters/contract';
import { exportAppearanceFromSettings } from '@/features/markdown/exporters/export-appearance';
import { getExporter } from '@/features/markdown/exporters/registry';
import { documentHandoff } from '@/features/markdown/services/document-handoff';
import type { PageProps } from '@/features/shared/page-props';
import { db, type ShareRecord } from '@/shared/persistence/database';
import { documentService } from '@/shared/persistence/document-service';
import type { StorageProfile } from '@/shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { StatusPill } from '@/shared/ui/StatusPill';

import './files-page.css';

type UploadStatus = 'queued' | 'uploading' | 'success' | 'failed' | 'cancelled';

interface UploadCandidate {
  file: File;
  relativePath: string;
}

interface UploadTask {
  id: string;
  file: File;
  fileName: string;
  relativePath: string;
  category: string;
  status: UploadStatus;
  progress: number;
  error: string;
  result?: UploadResult;
  record?: ShareRecord;
  autoCopyOnSuccess: boolean;
  controller: AbortController;
}

interface PendingDocumentShare {
  documentId: string;
  title: string;
  content: string;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, failure?: () => void) => void;
  createReader?: () => { readEntries: (success: (entries: FileSystemEntryLike[]) => void, failure?: () => void) => void };
}

const INITIAL_VISIBLE_FILES = 120;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
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

function candidatesFromFileList(files: FileList | File[]): UploadCandidate[] {
  return [...files].map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
}

async function readDirectoryEntries(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const entries: FileSystemEntryLike[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}

async function traverseEntry(entry: FileSystemEntryLike, prefix: string, output: UploadCandidate[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => entry.file?.(resolve, () => resolve(null)));
    if (file) output.push({ file, relativePath: `${prefix}${entry.name}` });
    return;
  }
  if (!entry.isDirectory) return;
  const children = await readDirectoryEntries(entry);
  for (const child of children) await traverseEntry(child, `${prefix}${entry.name}/`, output);
}

async function candidatesFromDrop(dataTransfer: DataTransfer): Promise<UploadCandidate[]> {
  // DataTransfer contents can disappear after the drop event returns, so keep a
  // synchronous fallback before traversing directory entries asynchronously.
  const plainCandidates = candidatesFromFileList(dataTransfer.files);
  const entries: FileSystemEntryLike[] = [];
  for (const item of dataTransfer.items) {
    const entry = (item as unknown as { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return plainCandidates;
  const candidates: UploadCandidate[] = [];
  for (const entry of entries) await traverseEntry(entry, '', candidates);
  return candidates.length > 0 ? candidates : plainCandidates;
}

function LibraryDialog({
  labelledBy,
  onClose,
  children,
  className = '',
}: {
  labelledBy: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="library-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby={labelledBy} aria-modal="true" className={`library-dialog ${className}`} role="dialog">
        {children}
      </section>
    </div>
  );
}

export function FilesPage({ route, navigate }: PageProps) {
  const { settings, update } = useSettings();
  const { resetDestination, setDestination } = useDestination();
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [history, setHistory] = useState<ShareRecord[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [uploadCategory, setUploadCategory] = useState(UNCATEGORIZED);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | FileKind>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_FILES);
  const [dragging, setDragging] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingDocumentShare | null>(null);
  const [shareFormat, setShareFormat] = useState<ExportFormat>(settings.defaultShareFormat);
  const [shareAccess, setShareAccess] = useState<'private' | 'public' | 'provider-managed'>('provider-managed');
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadName, setDownloadName] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [renameRecord, setRenameRecord] = useState<ShareRecord | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [toast, setToast] = useState<{ id: number; message: string; kind: 'info' | 'success' | 'error' } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pageTop = useRef<HTMLDivElement>(null);
  const pageEnd = useRef<HTMLDivElement>(null);
  const pendingQueue = useRef<UploadTask[]>([]);
  const activeUploads = useRef(0);
  const profileRef = useRef<StorageProfile | undefined>(undefined);
  const settingsRef = useRef(settings);
  const handledIntent = useRef('');
  const toastTimer = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const knownCategories = useRef(new Set<string>());
  const pendingTaskPatches = useRef(new Map<string, Partial<UploadTask>>());
  const taskUpdateFrame = useRef<number | null>(null);

  const activeProfile = useMemo(
    () => getActiveStorageProfile(settings.storageProfiles, settings.activeStorageProfileId),
    [settings.activeStorageProfileId, settings.storageProfiles],
  );
  const storageReady = isStorageProfileConfigured(activeProfile);

  useEffect(() => {
    profileRef.current = activeProfile;
  }, [activeProfile]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const notify = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, kind });
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 3_200);
  }, []);

  const refreshLibrary = useCallback(async () => {
    const [records, savedCategories] = await Promise.all([
      db.shares.orderBy('createdAt').reverse().toArray(),
      db.fileCategories.orderBy('createdAt').toArray(),
    ]);
    const categoryNames = new Set(savedCategories.map((category) => category.name));
    for (const record of records) if (record.category && record.category !== UNCATEGORIZED) categoryNames.add(record.category);
    knownCategories.current = categoryNames;
    setHistory(records);
    setCategories([...categoryNames]);
  }, []);

  useEffect(() => {
    resetDestination();
    void refreshLibrary();
  }, [refreshLibrary, resetDestination]);

  useEffect(() => {
    setShareAccess(defaultAccess(activeProfile));
  }, [activeProfile]);

  useEffect(() => {
    setShareFormat(settings.defaultShareFormat);
  }, [settings.defaultShareFormat]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    if (taskUpdateFrame.current !== null) window.cancelAnimationFrame(taskUpdateFrame.current);
  }, []);

  useEffect(() => {
    if (!categoryManagerOpen && !renameRecord) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setCategoryManagerOpen(false);
      setRenameRecord(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [categoryManagerOpen, renameRecord]);

  useEffect(() => {
    setSelectedIds((current) => {
      const valid = new Set(history.map((record) => record.id));
      const next = new Set([...current].filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [history]);

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

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    pendingTaskPatches.current.set(id, { ...pendingTaskPatches.current.get(id), ...patch });
    if (taskUpdateFrame.current !== null) return;
    taskUpdateFrame.current = window.requestAnimationFrame(() => {
      taskUpdateFrame.current = null;
      const patches = pendingTaskPatches.current;
      pendingTaskPatches.current = new Map();
      setTasks((current) => current.map((task) => {
        const next = patches.get(task.id);
        return next ? { ...task, ...next } : task;
      }));
    });
  }, []);

  const rememberCategory = useCallback(async (name: string) => {
    if (name === UNCATEGORIZED || knownCategories.current.has(name)) return;
    knownCategories.current.add(name);
    const now = Date.now();
    try {
      await db.fileCategories.put({ name, createdAt: now, updatedAt: now });
      setCategories((current) => current.includes(name) ? current : [...current, name]);
    } catch (error) {
      knownCategories.current.delete(name);
      throw error;
    }
  }, []);

  const createShareRecord = useCallback(async (
    profile: StorageProfile,
    fileName: string,
    relativePath: string,
    contentType: string,
    category: string,
    result: UploadResult,
  ): Promise<ShareRecord> => {
    const record: ShareRecord = {
      id: nanoid(),
      fileName,
      displayName: basename(fileName),
      relativePath,
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
    await rememberCategory(category);
    await db.shares.add(record);
    setHistory((current) => [record, ...current]);
    return record;
  }, [rememberCategory]);

  const freshRecord = useCallback(async (record: ShareRecord): Promise<ShareRecord> => {
    const expiresSoon = record.access === 'signed' && (!record.expiresAt || record.expiresAt < Date.now() + 2 * 60_000);
    if (!expiresSoon || !record.objectKey) return record;
    const profile = settingsRef.current.storageProfiles.find((item) => item.id === record.storageProfileId);
    if (!profile || !isStorageProfileConfigured(profile)) {
      throw new Error('这个限时链接已经失效，请先重新连接原来的存储。');
    }
    const link = await storageService.link(profile, record.objectKey, record.access);
    const updated = { ...record, ...link };
    await db.shares.update(record.id, link);
    setHistory((current) => current.map((item) => item.id === record.id ? updated : item));
    return updated;
  }, []);

  const copyAutoShare = async (record: ShareRecord) => {
    const current = await freshRecord(record);
    await navigator.clipboard.writeText(formatShareText(current, settingsRef.current.shareCopyFormat));
  };

  const copyLink = async (record: ShareRecord) => {
    try {
      const current = await freshRecord(record);
      await navigator.clipboard.writeText(current.url);
      notify(`已复制“${current.displayName}”的链接。`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '浏览器未允许复制链接。', 'error');
    }
  };

  const openRecord = async (record: ShareRecord) => {
    try {
      const current = await freshRecord(record);
      await browser.tabs.create({ url: current.url });
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法打开这个文件。', 'error');
    }
  };

  const shareRecord = async (record: ShareRecord) => {
    try {
      const current = await freshRecord(record);
      await navigator.clipboard.writeText(formatShareText(current, settingsRef.current.shareCopyFormat));
      notify(`已复制“${current.displayName}”的分享文字。`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法分享这个文件。', 'error');
    }
  };

  const downloadRecord = async (record: ShareRecord, quiet = false) => {
    const current = await freshRecord(record);
    const result = await downloadRemoteFile({
      url: current.url,
      preferredFileName: current.fileName,
      fallbackToOpen: !quiet,
    });
    if (!quiet) notify(result.delivery === 'opened'
      ? '这个地址不允许直接保存，已在新标签打开。'
      : `已开始下载“${result.fileName}”。`, 'success');
  };

  async function uploadTask(task: UploadTask) {
    const profile = profileRef.current;
    if (!profile || !isStorageProfileConfigured(profile)) {
      task.status = 'failed';
      updateTask(task.id, { status: 'failed', error: '请先连接存储。' });
      return;
    }
    task.status = 'uploading';
    updateTask(task.id, { status: 'uploading', progress: 0, error: '' });
    try {
      const result = await storageService.upload(profile, {
        blob: task.file,
        fileName: task.fileName,
        contentType: task.file.type || 'application/octet-stream',
        access: defaultAccess(profile),
        signal: task.controller.signal,
        onProgress: (progress) => {
          if (progress < 1 && progress - task.progress < 0.08) return;
          task.progress = progress;
          updateTask(task.id, { progress });
        },
      });
      const record = await createShareRecord(
        profile,
        task.fileName,
        task.relativePath,
        task.file.type || 'application/octet-stream',
        task.category,
        result,
      );
      task.result = result;
      task.record = record;
      task.status = 'success';
      updateTask(task.id, { status: 'success', progress: 1, result, record });
      if (task.autoCopyOnSuccess) {
        setDestination({ kind: 'online-share', label: record.displayName, detail: accessLabel(record) });
      }
      if (task.autoCopyOnSuccess && settingsRef.current.autoCopyShareLink) {
        try {
          await copyAutoShare(record);
        } catch {
          notify('上传成功，但浏览器没有允许自动复制链接。', 'error');
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        task.status = 'cancelled';
        updateTask(task.id, { status: 'cancelled', error: '上传已取消。' });
      } else {
        task.status = 'failed';
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

  const addFiles = async (candidates: UploadCandidate[]) => {
    const validCandidates = candidates.filter(({ file }) => file.size > 0 || file.name.length > 0);
    if (validCandidates.length === 0) return;
    if (!storageReady) {
      navigate('settings', new URLSearchParams({ section: 'storage' }));
      return;
    }
    const folderCategories = [...new Set(validCandidates.map(({ relativePath }) => topFolder(relativePath)).filter((name): name is string => Boolean(name)))];
    await Promise.all(folderCategories.map(rememberCategory));
    const next = validCandidates.map(({ file, relativePath }): UploadTask => ({
      id: nanoid(),
      file,
      fileName: file.name,
      relativePath,
      category: topFolder(relativePath) ?? uploadCategory,
      status: 'queued',
      progress: 0,
      error: '',
      autoCopyOnSuccess: validCandidates.length === 1,
      controller: new AbortController(),
    }));
    pendingQueue.current.push(...next);
    setTasks((current) => [...next, ...current]);
    if (folderCategories.length > 0) notify(`已按文件夹自动归类，共 ${validCandidates.length} 个文件。`);
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
      const exported = await (await getExporter(shareFormat)).export({
        markdown: pendingShare.content,
        title: pendingShare.title,
        appearance: exportAppearanceFromSettings(settings),
      });
      const result = await storageService.upload(activeProfile, {
        blob: exported.blob,
        fileName: exported.fileName,
        contentType: exported.mimeType,
        access: shareAccess,
      });
      const record = await createShareRecord(
        activeProfile,
        exported.fileName,
        exported.fileName,
        exported.mimeType,
        'Markdown 分享',
        result,
      );
      await documentService.markShared(pendingShare.documentId);
      setDestination({ kind: 'online-share', label: pendingShare.title, detail: accessLabel(record) });
      try {
        await copyAutoShare(record);
        setShareMessage(`${accessLabel(record)}已生成，分享信息已复制。`);
      } catch {
        setShareMessage(`${accessLabel(record)}已生成，但浏览器没有允许自动复制。可在文件库中复制链接。`);
      }
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : '在线分享失败，本地文档没有受到影响。');
    } finally {
      setSharing(false);
    }
  };

  const chooseShareFormat = (format: ExportFormat) => {
    setShareFormat(format);
    if (settings.defaultShareFormat !== format) void update({ defaultShareFormat: format });
  };

  const addCategory = async () => {
    const name = normalizeCategoryName(newCategoryName);
    if (!name) return;
    if (name === UNCATEGORIZED || categories.some((category) => category.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      notify('已经有同名分类。', 'error');
      return;
    }
    await rememberCategory(name);
    setNewCategoryName('');
    setUploadCategory(name);
    notify(`已创建分类“${name}”。`, 'success');
  };

  const saveCategoryRename = async () => {
    if (!editingCategory) return;
    const name = normalizeCategoryName(editingCategoryName);
    if (!name || name === editingCategory) {
      setEditingCategory(null);
      return;
    }
    if (name === UNCATEGORIZED || categories.some((category) => category !== editingCategory && category.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      notify('已经有同名分类。', 'error');
      return;
    }
    const now = Date.now();
    await db.transaction('rw', db.fileCategories, db.shares, async () => {
      await db.fileCategories.add({ name, createdAt: now, updatedAt: now });
      await db.shares.where('category').equals(editingCategory).modify({ category: name });
      await db.fileCategories.delete(editingCategory);
    });
    setCategories((current) => current.map((category) => category === editingCategory ? name : category));
    knownCategories.current.delete(editingCategory);
    knownCategories.current.add(name);
    setHistory((current) => current.map((record) => record.category === editingCategory ? { ...record, category: name } : record));
    setUploadCategory((current) => current === editingCategory ? name : current);
    setCategoryFilter((current) => current === editingCategory ? name : current);
    setEditingCategory(null);
    notify(`已重命名为“${name}”。`, 'success');
  };

  const deleteCategory = async (name: string) => {
    const count = history.filter((record) => record.category === name).length;
    const detail = count > 0 ? `，其中 ${count} 个文件会移到“未分类”` : '';
    if (!window.confirm(`删除分类“${name}”${detail}？文件和云端内容都不会被删除。`)) return;
    await db.transaction('rw', db.fileCategories, db.shares, async () => {
      await db.shares.where('category').equals(name).modify({ category: UNCATEGORIZED });
      await db.fileCategories.delete(name);
    });
    setCategories((current) => current.filter((category) => category !== name));
    knownCategories.current.delete(name);
    setHistory((current) => current.map((record) => record.category === name ? { ...record, category: UNCATEGORIZED } : record));
    setUploadCategory((current) => current === name ? UNCATEGORIZED : current);
    setCategoryFilter((current) => current === name ? 'all' : current);
    notify(`已删除分类“${name}”。`, 'success');
  };

  const moveRecords = async (ids: string[], category: string) => {
    const idSet = new Set(ids);
    await db.shares.where('id').anyOf(ids).modify({ category });
    setHistory((current) => current.map((record) => idSet.has(record.id) ? { ...record, category } : record));
    setSelectedIds(new Set());
    notify(`已将 ${ids.length} 个文件移到“${category}”。`, 'success');
  };

  const saveRecordRename = async () => {
    if (!renameRecord) return;
    const value = basename(renameValue).trim().slice(0, 180);
    if (!value) return;
    await db.shares.update(renameRecord.id, { displayName: value });
    setHistory((current) => current.map((record) => record.id === renameRecord.id ? { ...record, displayName: value } : record));
    setRenameRecord(null);
    notify('文件名称已更新。云端文件名保持不变。', 'success');
  };

  const removeRecords = async (records: ShareRecord[]) => {
    if (records.length === 0) return;
    if (!window.confirm(`从文件库移除 ${records.length} 个文件？云端文件不会被删除。`)) return;
    const ids = records.map((record) => record.id);
    const idSet = new Set(ids);
    await db.shares.bulkDelete(ids);
    setHistory((current) => current.filter((record) => !idSet.has(record.id)));
    setSelectedIds(new Set());
    notify('已从文件库移除。', 'success');
  };

  const clearLibrary = async () => {
    if (history.length === 0) return;
    if (!window.confirm(`清空文件库中的 ${history.length} 条记录？这不会删除对象存储中的文件。`)) return;
    await db.shares.clear();
    setHistory([]);
    setSelectedIds(new Set());
    notify('文件库已清空，云端文件没有受到影响。', 'success');
  };

  const runDirectDownload = async () => {
    if (!downloadUrl.trim()) {
      notify('请先粘贴文件地址。', 'error');
      return;
    }
    setDownloadBusy(true);
    try {
      const result = await downloadRemoteFile({
        url: downloadUrl,
        preferredFileName: downloadName.trim() || undefined,
      });
      notify(result.delivery === 'opened'
        ? '这个地址不允许直接保存，已在新标签打开。'
        : `已开始下载“${result.fileName}”。`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '下载失败，请检查地址。', 'error');
    } finally {
      setDownloadBusy(false);
    }
  };

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of history) counts.set(record.category || UNCATEGORIZED, (counts.get(record.category || UNCATEGORIZED) ?? 0) + 1);
    return counts;
  }, [history]);

  const searchScope = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return history.filter((record) => !keyword
      || record.displayName.toLocaleLowerCase().includes(keyword)
      || record.relativePath?.toLocaleLowerCase().includes(keyword)
      || record.category.toLocaleLowerCase().includes(keyword));
  }, [history, search]);

  const categoryScope = useMemo(
    () => categoryFilter === 'all' ? searchScope : searchScope.filter((record) => (record.category || UNCATEGORIZED) === categoryFilter),
    [categoryFilter, searchScope],
  );

  const kindCounts = useMemo(() => {
    const counts = new Map<FileKind, number>();
    for (const record of categoryScope) {
      const kind = fileKindForName(record.displayName);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
  }, [categoryScope]);

  const filteredHistory = useMemo(
    () => typeFilter === 'all' ? categoryScope : categoryScope.filter((record) => fileKindForName(record.displayName) === typeFilter),
    [categoryScope, typeFilter],
  );
  const visibleHistory = filteredHistory.slice(0, visibleLimit);
  const selectedRecords = history.filter((record) => selectedIds.has(record.id));
  const allFilteredSelected = filteredHistory.length > 0 && filteredHistory.every((record) => selectedIds.has(record.id));

  const resetListing = () => {
    setVisibleLimit(INITIAL_VISIBLE_FILES);
    setSelectedIds(new Set());
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const record of filteredHistory) next.delete(record.id);
        return next;
      });
      return;
    }
    setSelectedIds((current) => new Set([...current, ...filteredHistory.map((record) => record.id)]));
  };

  const batchCopyLinks = async () => {
    setBatchBusy(true);
    try {
      const records = await Promise.all(selectedRecords.map(freshRecord));
      await navigator.clipboard.writeText(records.map((record) => record.url).join('\n'));
      notify(`已复制 ${records.length} 个链接。`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法复制所选链接。', 'error');
    } finally {
      setBatchBusy(false);
    }
  };

  const batchShare = async () => {
    setBatchBusy(true);
    try {
      const records = await Promise.all(selectedRecords.map(freshRecord));
      const text = formatShareRecords(records, settingsRef.current.shareCopyFormat);
      await navigator.clipboard.writeText(text);
      notify(`已复制 ${records.length} 个文件的分享文字。`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法分享所选文件。', 'error');
    } finally {
      setBatchBusy(false);
    }
  };

  const batchDownload = async () => {
    setBatchBusy(true);
    let completed = 0;
    try {
      for (const record of selectedRecords) {
        await downloadRecord(record, true);
        completed += 1;
      }
      notify(`已开始下载 ${completed} 个文件。`, 'success');
    } catch (error) {
      notify(`${completed} 个文件已开始下载；${error instanceof Error ? error.message : '其余文件下载失败。'}`, 'error');
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div
      className="files-page page-frame"
      onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void candidatesFromDrop(event.dataTransfer)
          .then(async (candidates) => {
            if (candidates.length === 0) {
              notify('没有读取到可上传的文件。', 'error');
              return;
            }
            await addFiles(candidates);
          })
          .catch(() => notify('读取文件夹失败，请改用“选择文件夹”。', 'error'));
      }}
      onPaste={(event) => {
        const files = candidatesFromFileList(event.clipboardData.files);
        if (files.length > 0) void addFiles(files);
      }}
      ref={pageTop}
    >
      <header className="page-intro files-intro">
        <div><p className="page-kicker">文件与分享</p><h1>文件库</h1><p>上传、查找、分类、分享和下载文件。</p></div>
        <StatusPill tone={storageReady ? 'success' : 'warning'}>{storageReady ? `已连接 ${activeProfile?.name}` : '存储尚未连接'}</StatusPill>
      </header>

      {pendingShare ? (
        <section className="document-share-panel">
          <div className="document-share-panel__heading"><div><p className="page-kicker">在线分享</p><h2>{pendingShare.title}</h2><p>选择分享格式后生成链接，原文档不会改变。</p></div><IconButton icon={X} label="关闭分享" onClick={() => setPendingShare(null)} /></div>
          <div className="document-share-options">
            <div><span>分享格式</span><div className="segmented-control"><button aria-pressed={shareFormat === 'html'} onClick={() => chooseShareFormat('html')} type="button">HTML</button><button aria-pressed={shareFormat === 'docx'} onClick={() => chooseShareFormat('docx')} type="button">Word</button><button aria-pressed={shareFormat === 'markdown'} onClick={() => chooseShareFormat('markdown')} type="button">Markdown</button></div></div>
            {activeProfile?.provider === 'aliyun-oss' ? <div><span>访问方式</span><div className="segmented-control"><button aria-pressed={shareAccess === 'private'} onClick={() => setShareAccess('private')} type="button">限时链接</button><button aria-pressed={shareAccess === 'public'} onClick={() => setShareAccess('public')} type="button">公开链接</button></div></div> : <div><span>访问方式</span><p>访问范围由当前存储服务决定。</p></div>}
          </div>
          {!storageReady ? <div className="inline-warning"><span>在线分享需要先连接存储。</span><Button icon={Settings2} onClick={() => navigate('settings', new URLSearchParams({ section: 'storage' }))} size="small">连接存储</Button></div> : null}
          {shareMessage ? <p className="share-message" role="status">{shareMessage}</p> : null}
          <div className="document-share-panel__actions"><Button disabled={sharing || !storageReady} icon={CloudUpload} onClick={() => void shareDocument()} variant="primary">{sharing ? '正在分享' : '生成并复制链接'}</Button></div>
        </section>
      ) : null}

      <section
        className={`upload-zone ${dragging ? 'upload-zone--dragging' : ''}`}
        onClick={() => { if (storageReady) fileInput.current?.click(); else navigate('settings', new URLSearchParams({ section: 'storage' })); }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key !== 'Enter' && event.key !== ' ') return; if (storageReady) fileInput.current?.click(); else navigate('settings', new URLSearchParams({ section: 'storage' })); }}
      >
        <span className="upload-zone__icon"><CloudUpload aria-hidden="true" size={26} /></span>
        <span><strong>{storageReady ? '拖入、选择或粘贴文件' : '连接存储后即可上传'}</strong><small>{storageReady ? '文件夹会递归上传，并按顶层文件夹自动分类。' : '已保存的文件库记录仍可查看和管理。'}</small></span>
        <div className="upload-zone__actions"><Button icon={Upload} onClick={(event) => { event.stopPropagation(); if (storageReady) fileInput.current?.click(); else navigate('settings', new URLSearchParams({ section: 'storage' })); }} size="small" variant="primary">选择文件</Button><Button disabled={!storageReady} icon={FolderUp} onClick={(event) => { event.stopPropagation(); folderInput.current?.click(); }} size="small">选择文件夹</Button></div>
        <input className="sr-only" multiple onChange={(event) => { if (event.target.files) void addFiles(candidatesFromFileList(event.target.files)); event.target.value = ''; }} ref={fileInput} type="file" />
        <input className="sr-only" multiple onChange={(event) => { if (event.target.files) void addFiles(candidatesFromFileList(event.target.files)); event.target.value = ''; }} ref={folderInput} type="file" {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />
      </section>

      <div className="upload-category-bar">
        <label><span>零散文件归类到</span><select onChange={(event) => setUploadCategory(event.target.value)} value={uploadCategory}><option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <Button icon={Tags} onClick={() => setCategoryManagerOpen(true)} size="small">管理分类</Button>
      </div>

      {tasks.length > 0 ? (
        <section className="upload-queue">
          <div className="section-heading"><div><h2>上传进度</h2><p>{tasks.filter((task) => task.status === 'queued' || task.status === 'uploading').length} 个等待或正在上传</p></div><Button onClick={() => setTasks((current) => current.filter((task) => task.status === 'queued' || task.status === 'uploading'))} size="small" variant="quiet">清理已完成</Button></div>
          <div className="upload-task-list">
            {tasks.map((task) => (
              <div className="upload-task" key={task.id}>
                <span className={`upload-task__state upload-task__state--${task.status}`}>{task.status === 'success' ? <Check size={16} /> : task.status === 'failed' ? <X size={16} /> : <FileArchive size={16} />}</span>
                <span className="upload-task__copy"><input aria-label="上传文件名" disabled={task.status !== 'queued'} onChange={(event) => { task.fileName = event.target.value; updateTask(task.id, { fileName: event.target.value }); }} value={task.fileName} /><small>{formatBytes(task.file.size)} · {task.error || ({ queued: '等待上传', uploading: `上传中 ${Math.round(task.progress * 100)}%`, success: '上传成功', failed: '上传失败', cancelled: '已取消' }[task.status])}</small></span>
                <span className="upload-task__progress"><i style={{ width: `${Math.round(task.progress * 100)}%` }} /></span>
                {task.status === 'failed' || task.status === 'cancelled' ? <IconButton icon={RotateCcw} label="重试" onClick={() => retryTask(task)} /> : task.status === 'success' && task.record ? <div className="upload-task__actions"><IconButton icon={ExternalLink} label="打开上传文件" onClick={() => void openRecord(task.record as ShareRecord)} /><IconButton icon={Download} label="下载上传文件" onClick={() => void downloadRecord(task.record as ShareRecord).catch((error) => notify(error instanceof Error ? error.message : '下载失败。', 'error'))} /><IconButton icon={Share2} label="复制分享文字" onClick={() => void shareRecord(task.record as ShareRecord)} /></div> : <IconButton icon={X} label="取消上传" onClick={() => cancelTask(task)} />}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details className="link-download-panel">
        <summary>
          <span><strong>通过链接下载</strong><small>有文件地址时再展开使用</small></span>
          <ChevronDown aria-hidden="true" size={18} />
        </summary>
        <div className="link-download-content">
          <p>粘贴对象存储地址，自动保留原文件名和中文名称。</p>
          <div className="link-download-form">
            <label className="link-download-url"><Link2 aria-hidden="true" size={17} /><input aria-label="文件下载地址" onChange={(event) => setDownloadUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runDirectDownload(); }} placeholder="粘贴文件地址" value={downloadUrl} /></label>
            <input aria-label="保存文件名（可选）" className="link-download-name" onChange={(event) => setDownloadName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runDirectDownload(); }} placeholder="保存名称（可选）" value={downloadName} />
            <Button disabled={downloadBusy} icon={Download} onClick={() => void runDirectDownload()} variant="primary">{downloadBusy ? '正在下载' : '下载文件'}</Button>
          </div>
        </div>
      </details>

      <section className="file-library">
        <div className="section-heading file-library__heading">
          <div><h2>全部文件 <span>{history.length}</span></h2><p>重命名、分类和移除只改变当前文件库，不会改动云端文件。</p></div>
          <div><Button icon={Tags} onClick={() => setCategoryManagerOpen(true)} size="small">管理分类</Button><Button disabled={history.length === 0} icon={Trash2} onClick={() => void clearLibrary()} size="small" variant="danger">全部清空</Button></div>
        </div>

        <div className="file-library__controls">
          <div className="file-library__toolbar">
            <label className="library-search"><Search aria-hidden="true" size={16} /><input onChange={(event) => { setSearch(event.target.value); setTypeFilter('all'); resetListing(); }} placeholder="搜索文件名、路径或分类" value={search} /></label>
            <div className="library-toolbar-meta">
              <span>{filteredHistory.length === history.length ? `${history.length} 个文件` : `找到 ${filteredHistory.length} 个文件`}</span>
              {history.length > 12 || tasks.length > 12 ? <nav aria-label="长列表快速跳转"><IconButton icon={ChevronsUp} label="回到顶部" onClick={() => pageTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /><IconButton icon={ChevronsDown} label="回到底部" onClick={() => pageEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })} /></nav> : null}
            </div>
          </div>
          <div aria-label="按分类筛选" className="filter-strip">
            <span className="filter-strip__label"><Folder aria-hidden="true" size={14} />分类</span>
            <button aria-pressed={categoryFilter === 'all'} onClick={() => { setCategoryFilter('all'); setTypeFilter('all'); resetListing(); }} type="button">全部 <small>{history.length}</small></button>
            <button aria-pressed={categoryFilter === UNCATEGORIZED} onClick={() => { setCategoryFilter(UNCATEGORIZED); setTypeFilter('all'); resetListing(); }} type="button">{UNCATEGORIZED} <small>{categoryCounts.get(UNCATEGORIZED) ?? 0}</small></button>
            {categories.map((category) => <button aria-pressed={categoryFilter === category} key={category} onClick={() => { setCategoryFilter(category); setTypeFilter('all'); resetListing(); }} type="button">{category} <small>{categoryCounts.get(category) ?? 0}</small></button>)}
            <IconButton className="filter-strip__add" icon={FolderPlus} label="新增分类" onClick={() => setCategoryManagerOpen(true)} />
          </div>
          <div aria-label="按文件类型筛选" className="filter-strip filter-strip--types">
            <span className="filter-strip__label"><FileText aria-hidden="true" size={14} />类型</span>
            <button aria-pressed={typeFilter === 'all'} onClick={() => { setTypeFilter('all'); resetListing(); }} type="button">全部 <small>{categoryScope.length}</small></button>
            {FILE_KINDS.map((kind) => kindCounts.has(kind.id) ? <button aria-pressed={typeFilter === kind.id} className={`file-kind file-kind--${kind.id}`} key={kind.id} onClick={() => { setTypeFilter(kind.id); resetListing(); }} type="button"><i />{kind.label} <small>{kindCounts.get(kind.id)}</small></button> : null)}
            {kindCounts.has('other') ? <button aria-pressed={typeFilter === 'other'} className="file-kind file-kind--other" onClick={() => { setTypeFilter('other'); resetListing(); }} type="button"><i />其他 <small>{kindCounts.get('other')}</small></button> : null}
          </div>
          {selectedRecords.length > 0 ? (
            <div className="batch-toolbar">
              <strong>已选 {selectedRecords.length} 个</strong>
              <span />
              <label className="batch-move"><Folder aria-hidden="true" size={15} /><select aria-label="移动所选文件到分类" defaultValue="" disabled={batchBusy} onChange={(event) => { if (event.target.value) void moveRecords(selectedRecords.map((record) => record.id), event.target.value); }}><option disabled value="">移动到分类…</option><option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              <IconButton disabled={batchBusy} icon={Share2} label="分享所选文件" onClick={() => void batchShare()} />
              <IconButton disabled={batchBusy} icon={Download} label="下载所选文件" onClick={() => void batchDownload()} />
              <IconButton disabled={batchBusy} icon={Copy} label="复制所选链接" onClick={() => void batchCopyLinks()} />
              <IconButton disabled={batchBusy} icon={Trash2} label="从文件库移除所选文件" onClick={() => void removeRecords(selectedRecords)} />
              <IconButton disabled={batchBusy} icon={X} label="取消选择" onClick={() => setSelectedIds(new Set())} />
            </div>
          ) : null}
        </div>

        {filteredHistory.length === 0 ? <div className="empty-state"><Link2 aria-hidden="true" size={24} /><div><strong>{history.length === 0 ? '文件库还是空的' : '没有匹配的文件'}</strong><p>{history.length === 0 ? '上传成功后，文件会自动出现在这里。' : '换个关键词或筛选条件试试。'}</p></div></div> : (
          <div className="share-record-list">
            <div className="share-record-list__header">
              <label><input checked={allFilteredSelected} onChange={toggleSelectAll} type="checkbox" /><span>全选当前结果</span></label>
              <span>名称</span><span>分类</span><span>类型</span><span>上传时间</span><span>操作</span>
            </div>
            {visibleHistory.map((record) => {
              const kind = fileKindForName(record.displayName);
              return (
                <div className={`share-record ${selectedIds.has(record.id) ? 'share-record--selected' : ''}`} key={record.id}>
                  <input aria-label={`选择 ${record.displayName}`} checked={selectedIds.has(record.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(record.id)) next.delete(record.id); else next.add(record.id); return next; })} type="checkbox" />
                  <span className={`share-record__icon share-record__icon--${kind}`}><FileText aria-hidden="true" size={17} /></span>
                  <span className="share-record__main"><strong title={record.displayName}>{record.displayName}</strong><small title={record.relativePath}>{formatBytes(record.size)}{record.relativePath && record.relativePath !== record.displayName ? ` · ${record.relativePath}` : ''}</small></span>
                  <select aria-label={`移动 ${record.displayName} 到分类`} className="record-category-select" onChange={(event) => void moveRecords([record.id], event.target.value)} value={record.category || UNCATEGORIZED}><option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
                  <span className={`record-kind record-kind--${kind}`}><i />{FILE_KIND_LABELS[kind]}</span>
                  <time>{formatDate(record.createdAt)}</time>
                  <div className="share-record__actions">
                    <button className="record-text-action" onClick={() => void openRecord(record)} type="button"><ExternalLink aria-hidden="true" size={13} />打开</button>
                    <button className="record-text-action" onClick={() => void downloadRecord(record).catch((error) => notify(error instanceof Error ? error.message : '下载失败。', 'error'))} type="button"><Download aria-hidden="true" size={13} />下载</button>
                    <button className="record-text-action" onClick={() => void shareRecord(record)} type="button"><Share2 aria-hidden="true" size={13} />分享</button>
                    <IconButton icon={Copy} label="复制链接" onClick={() => void copyLink(record)} />
                    <IconButton icon={Pencil} label="重命名" onClick={() => { setRenameRecord(record); setRenameValue(record.displayName); }} />
                    <IconButton icon={Trash2} label="从文件库移除" onClick={() => void removeRecords([record])} />
                  </div>
                </div>
              );
            })}
            {visibleHistory.length < filteredHistory.length ? <div className="load-more-row"><Button onClick={() => setVisibleLimit((current) => current + INITIAL_VISIBLE_FILES)}>再显示 {Math.min(INITIAL_VISIBLE_FILES, filteredHistory.length - visibleHistory.length)} 个</Button><span>共 {filteredHistory.length} 个文件</span></div> : null}
          </div>
        )}
      </section>

      <div ref={pageEnd} />

      {categoryManagerOpen ? (
        <LibraryDialog labelledBy="category-manager-title" onClose={() => setCategoryManagerOpen(false)}>
          <header><div><p className="page-kicker">文件分类</p><h2 id="category-manager-title">管理分类</h2></div><IconButton icon={X} label="关闭" onClick={() => setCategoryManagerOpen(false)} /></header>
          <form className="category-add-form" onSubmit={(event) => { event.preventDefault(); void addCategory(); }}><input autoFocus onChange={(event) => setNewCategoryName(event.target.value)} placeholder="输入新分类名称" value={newCategoryName} /><Button disabled={!newCategoryName.trim()} icon={FolderPlus} type="submit" variant="primary">新增分类</Button></form>
          <div className="category-manager-list">
            <div className="category-manager-row category-manager-row--locked"><Folder aria-hidden="true" size={17} /><span><strong>{UNCATEGORIZED}</strong><small>{categoryCounts.get(UNCATEGORIZED) ?? 0} 个文件 · 系统分类</small></span></div>
            {categories.map((category) => <div className="category-manager-row" key={category}><Folder aria-hidden="true" size={17} />{editingCategory === category ? <form onSubmit={(event) => { event.preventDefault(); void saveCategoryRename(); }}><input autoFocus onChange={(event) => setEditingCategoryName(event.target.value)} value={editingCategoryName} /><Button size="small" type="submit" variant="primary">保存</Button><IconButton icon={X} label="取消重命名" onClick={() => setEditingCategory(null)} type="button" /></form> : <><span><strong>{category}</strong><small>{categoryCounts.get(category) ?? 0} 个文件</small></span><IconButton icon={Pencil} label={`重命名 ${category}`} onClick={() => { setEditingCategory(category); setEditingCategoryName(category); }} /><IconButton icon={Trash2} label={`删除 ${category}`} onClick={() => void deleteCategory(category)} /></>}</div>)}
          </div>
          <footer>删除分类时，里面的文件会移到“未分类”，文件本身不会被删除。</footer>
        </LibraryDialog>
      ) : null}

      {renameRecord ? (
        <LibraryDialog labelledBy="rename-file-title" onClose={() => setRenameRecord(null)}>
          <header><div><p className="page-kicker">文件名称</p><h2 id="rename-file-title">重命名</h2></div><IconButton icon={X} label="关闭" onClick={() => setRenameRecord(null)} /></header>
          <form className="simple-dialog-form" onSubmit={(event) => { event.preventDefault(); void saveRecordRename(); }}><label><span>在文件库中显示为</span><input autoFocus onChange={(event) => setRenameValue(event.target.value)} value={renameValue} /></label><div><Button onClick={() => setRenameRecord(null)} type="button">取消</Button><Button disabled={!renameValue.trim()} type="submit" variant="primary">保存名称</Button></div></form>
          <footer>这里只改文件库中的显示名称，云端文件名和分享链接不会变化。</footer>
        </LibraryDialog>
      ) : null}

      {toast ? <div className={`files-toast files-toast--${toast.kind}`} key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.message}</div> : null}
    </div>
  );
}
