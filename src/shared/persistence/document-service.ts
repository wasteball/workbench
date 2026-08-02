import { nanoid } from 'nanoid';

import { db, type DocumentRecord } from '@/shared/persistence/database';

const UNTITLED_MARKDOWN = '# 未命名文档\n\n从这里开始写作。\n';

export interface LoadedDocument {
  record: DocumentRecord;
  content: string | null;
  baseline: string | null;
  needsSource: boolean;
}

export interface FileRegistration {
  name: string;
  relativePath: string;
  handle?: FileSystemFileHandle;
}

export interface DocumentBatchResult {
  records: DocumentRecord[];
  removedIds: string[];
  preservedIds: string[];
}

function normalizedSourceLabel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase();
}

function fileRecord(file: FileRegistration, now: number, index: number, existing?: DocumentRecord): DocumentRecord {
  return {
    ...(existing ?? {}),
    id: existing?.id ?? nanoid(),
    title: file.name.replace(/\.(md|markdown|txt)$/i, '') || file.name,
    source: 'file',
    sourceLabel: file.relativePath,
    sourceUrl: null,
    draftContent: existing?.draftContent ?? null,
    baselineContent: existing?.baselineContent ?? null,
    ...(file.handle ? { fileHandle: file.handle } : existing?.fileHandle ? { fileHandle: existing.fileHandle } : {}),
    createdAt: existing?.createdAt ?? now - index,
    updatedAt: existing?.draftUpdatedAt ? existing.updatedAt : now - index,
    draftUpdatedAt: existing?.draftUpdatedAt ?? null,
    lastDestination: existing?.lastDestination ?? 'original-file',
    lastSavedAt: existing?.lastSavedAt ?? null,
  };
}

export function titleFromMarkdown(content: string, fallback = '未命名文档'): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading?.slice(0, 120) || fallback;
}

async function readHandle(handle: FileSystemFileHandle): Promise<string | null> {
  try {
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}

export const documentService = {
  async create(content = UNTITLED_MARKDOWN, title = '未命名文档'): Promise<DocumentRecord> {
    const now = Date.now();
    const record: DocumentRecord = {
      id: nanoid(),
      title,
      source: 'new',
      sourceLabel: '此浏览器中的草稿',
      sourceUrl: null,
      draftContent: content,
      baselineContent: '',
      createdAt: now,
      updatedAt: now,
      draftUpdatedAt: now,
      lastDestination: 'browser-draft',
      lastSavedAt: null,
    };
    await db.documents.add(record);
    return record;
  },

  async importFile(file: File, fileHandle?: FileSystemFileHandle, sourceLabel = file.name): Promise<LoadedDocument> {
    const content = await file.text();
    const title = file.name.replace(/\.(md|markdown|txt)$/i, '') || file.name;
    const now = Date.now();
    const record: DocumentRecord = {
      id: nanoid(),
      title,
      source: 'file',
      sourceLabel,
      sourceUrl: null,
      draftContent: null,
      baselineContent: null,
      ...(fileHandle ? { fileHandle } : {}),
      createdAt: now,
      updatedAt: now,
      draftUpdatedAt: null,
      lastDestination: 'original-file',
      lastSavedAt: null,
    };
    await db.documents.put(record);
    return { record, content, baseline: content, needsSource: false };
  },

  async registerFiles(files: readonly FileRegistration[]): Promise<DocumentRecord[]> {
    const now = Date.now();
    const existingFiles = await db.documents.where('source').equals('file').toArray();
    const bySource = new Map(existingFiles.map((record) => [normalizedSourceLabel(record.sourceLabel), record]));
    const records = files.map((file, index) => {
      const key = normalizedSourceLabel(file.relativePath);
      const record = fileRecord(file, now, index, bySource.get(key));
      bySource.set(key, record);
      return record;
    });
    if (records.length > 0) await db.documents.bulkPut(records);
    return records;
  },

  async replaceImportedFiles(files: readonly FileRegistration[]): Promise<DocumentBatchResult> {
    const imported = (await db.documents.toArray()).filter((record) => record.source !== 'new');
    const removable = imported.filter((record) => record.draftUpdatedAt === null);
    const preserved = imported.filter((record) => record.draftUpdatedAt !== null);
    const removedIds = removable.map((record) => record.id);
    if (removedIds.length > 0) await db.documents.bulkDelete(removedIds);
    const records = await this.registerFiles(files);
    return { records, removedIds, preservedIds: preserved.map((record) => record.id) };
  },

  async clearImportedDocuments(): Promise<Omit<DocumentBatchResult, 'records'>> {
    const imported = (await db.documents.toArray()).filter((record) => record.source !== 'new');
    const removable = imported.filter((record) => record.draftUpdatedAt === null);
    const preserved = imported.filter((record) => record.draftUpdatedAt !== null);
    const removedIds = removable.map((record) => record.id);
    if (removedIds.length > 0) await db.documents.bulkDelete(removedIds);
    return { removedIds, preservedIds: preserved.map((record) => record.id) };
  },

  async importUrl(url: string, content: string): Promise<LoadedDocument> {
    const fallback = new URL(url).pathname.split('/').pop()?.replace(/\.(md|markdown|txt)$/i, '') || '远程文档';
    const now = Date.now();
    const record: DocumentRecord = {
      id: nanoid(),
      title: titleFromMarkdown(content, fallback),
      source: 'url',
      sourceLabel: url,
      sourceUrl: url,
      draftContent: null,
      baselineContent: null,
      createdAt: now,
      updatedAt: now,
      draftUpdatedAt: null,
      lastDestination: 'original-file',
      lastSavedAt: null,
    };
    await db.documents.put(record);
    return { record, content, baseline: content, needsSource: false };
  },

  async read(id: string): Promise<DocumentRecord | undefined> {
    return db.documents.get(id);
  },

  async load(id: string): Promise<LoadedDocument | undefined> {
    const record = await db.documents.get(id);
    if (!record) return undefined;
    if (record.draftContent !== null) {
      return {
        record,
        content: record.draftContent,
        baseline: record.baselineContent ?? '',
        needsSource: false,
      };
    }
    if (record.fileHandle) {
      const content = await readHandle(record.fileHandle);
      if (content !== null) return { record, content, baseline: content, needsSource: false };
    }
    return { record, content: null, baseline: null, needsSource: true };
  },

  async recent(limit = 8): Promise<DocumentRecord[]> {
    return db.documents.orderBy('updatedAt').reverse().limit(limit).toArray();
  },

  async updateDraft(id: string, content: string, baseline: string, title?: string): Promise<DocumentRecord | undefined> {
    const record = await db.documents.get(id);
    if (!record) return undefined;
    const now = Date.now();
    const nextTitle = title?.trim() || titleFromMarkdown(content, record.title);
    await db.documents.update(id, {
      draftContent: content,
      baselineContent: record.baselineContent ?? baseline,
      title: nextTitle,
      updatedAt: now,
      draftUpdatedAt: now,
      lastDestination: 'browser-draft',
    });
    return db.documents.get(id);
  },

  async attachSource(id: string, file: File, fileHandle?: FileSystemFileHandle): Promise<LoadedDocument | undefined> {
    const record = await db.documents.get(id);
    if (!record) return undefined;
    const content = await file.text();
    await db.documents.update(id, {
      source: 'file',
      sourceLabel: file.name,
      sourceUrl: null,
      ...(fileHandle ? { fileHandle } : {}),
      updatedAt: Date.now(),
      lastDestination: 'original-file',
    });
    const updated = await db.documents.get(id);
    return updated ? { record: updated, content, baseline: content, needsSource: false } : undefined;
  },

  async attachSavedFile(id: string, fileHandle: FileSystemFileHandle, title?: string): Promise<DocumentRecord | undefined> {
    const record = await db.documents.get(id);
    if (!record) return undefined;
    await db.documents.update(id, {
      source: 'file',
      sourceLabel: fileHandle.name,
      sourceUrl: null,
      fileHandle,
      title: title?.trim() || record.title,
      updatedAt: Date.now(),
      lastDestination: 'original-file',
    });
    return db.documents.get(id);
  },

  async markSavedOriginal(id: string, title?: string): Promise<void> {
    await db.documents.update(id, {
      draftContent: null,
      baselineContent: null,
      draftUpdatedAt: null,
      ...(title?.trim() ? { title: title.trim() } : {}),
      updatedAt: Date.now(),
      lastSavedAt: Date.now(),
      lastDestination: 'original-file',
    });
  },

  async markDownloaded(id: string, content: string): Promise<void> {
    const record = await db.documents.get(id);
    if (!record) return;
    const keepBrowserDocument = record.source === 'new';
    await db.documents.update(id, {
      draftContent: keepBrowserDocument ? content : null,
      baselineContent: keepBrowserDocument ? content : null,
      draftUpdatedAt: null,
      updatedAt: Date.now(),
      lastSavedAt: Date.now(),
      lastDestination: 'downloaded-copy',
    });
  },

  async markShared(id: string): Promise<void> {
    await db.documents.update(id, {
      updatedAt: Date.now(),
      lastSavedAt: Date.now(),
      lastDestination: 'online-share',
    });
  },

  async remove(id: string): Promise<void> {
    await db.documents.delete(id);
  },
};
