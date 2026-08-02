import Dexie, { type EntityTable } from 'dexie';

import type { FileDestination } from '@/shared/types';

export interface DocumentRecord {
  id: string;
  title: string;
  source: 'new' | 'file' | 'url';
  sourceLabel: string;
  sourceUrl: string | null;
  draftContent: string | null;
  baselineContent: string | null;
  fileHandle?: FileSystemFileHandle;
  createdAt: number;
  updatedAt: number;
  draftUpdatedAt: number | null;
  lastDestination: FileDestination;
  lastSavedAt: number | null;
}

export interface ShareRecord {
  id: string;
  fileName: string;
  displayName: string;
  size: number;
  contentType: string;
  url: string;
  objectKey: string | null;
  access: 'public' | 'signed' | 'authenticated' | 'unknown';
  expiresAt: number | null;
  category: string;
  storageProfileId: string;
  storageProvider: 'gateway' | 'aliyun-oss';
  createdAt: number;
}

class WorkbenchDatabase extends Dexie {
  documents!: EntityTable<DocumentRecord, 'id'>;
  shares!: EntityTable<ShareRecord, 'id'>;

  constructor() {
    super('workbench-v1');
    this.version(1).stores({
      documents: 'id, updatedAt, source, draftUpdatedAt',
      shares: 'id, createdAt, storageProfileId, storageProvider',
    });
    this.version(2)
      .stores({
        documents: 'id, updatedAt, source, draftUpdatedAt, lastDestination',
        shares: 'id, createdAt, storageProfileId, storageProvider',
      })
      .upgrade(async (transaction) => {
        await transaction.table('documents').toCollection().modify((record: Record<string, unknown>) => {
          const source = record.source;
          const draftUpdatedAt = typeof record.draftUpdatedAt === 'number' ? record.draftUpdatedAt : null;
          const content = typeof record.content === 'string' ? record.content : '';
          const baseline = typeof record.baseline === 'string' ? record.baseline : '';
          record.sourceUrl = null;
          record.draftContent = source === 'file' && draftUpdatedAt === null ? null : content;
          record.baselineContent = draftUpdatedAt === null ? null : baseline;
          record.lastDestination = draftUpdatedAt === null && source === 'file' ? 'original-file' : 'browser-draft';
          record.lastSavedAt = null;
          delete record.content;
          delete record.baseline;
        });
      });
    this.version(3)
      .stores({
        documents: 'id, updatedAt, source, draftUpdatedAt, lastDestination',
        shares: 'id, createdAt, storageProfileId, storageProvider, category, fileName',
      })
      .upgrade(async (transaction) => {
        await transaction.table('shares').toCollection().modify((record: Record<string, unknown>) => {
          record.displayName = typeof record.fileName === 'string' ? record.fileName : '未命名文件';
          record.contentType = 'application/octet-stream';
          record.objectKey = null;
          record.category = '未分类';
        });
      });
  }
}

export const db = new WorkbenchDatabase();
