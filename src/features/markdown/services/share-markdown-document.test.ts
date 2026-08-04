import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportAppearance } from '@/features/markdown/exporters/contract';
import { shareMarkdownDocument } from '@/features/markdown/services/share-markdown-document';
import { db, type DocumentRecord } from '@/shared/persistence/database';
import type { GatewayProfile } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  exportDocument: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@/features/markdown/exporters/registry', () => ({
  getExporter: vi.fn(async () => ({ export: mocks.exportDocument })),
}));

vi.mock('@/connectors/storage/storage-service', () => ({
  storageService: { upload: mocks.upload },
}));

const profile: GatewayProfile = {
  id: 'gateway-profile',
  provider: 'gateway',
  name: 'API 方式',
  apiUrl: 'https://example.com/upload',
  bucket: 'documents',
  userCode: 'user',
  cdn: false,
  publicRead: false,
  headers: [],
};

const appearance: ExportAppearance = {
  theme: 'light',
  accentColor: 'indigo',
  readingFont: 'serif',
  readingFontSize: 18,
  readingWidth: 860,
};

const documentRecord: DocumentRecord = {
  id: 'current-document',
  title: '当前文档',
  source: 'new',
  sourceLabel: '当前文档.md',
  sourceUrl: null,
  draftContent: '# 当前文档',
  baselineContent: '',
  createdAt: 1,
  updatedAt: 1,
  draftUpdatedAt: 1,
  lastDestination: 'browser-draft',
  lastSavedAt: null,
};

beforeEach(async () => {
  await db.documents.clear();
  await db.shares.clear();
  await db.fileCategories.clear();
  await db.documents.put(documentRecord);
  mocks.exportDocument.mockReset();
  mocks.upload.mockReset();
  mocks.exportDocument.mockResolvedValue({
    blob: new Blob(['<!doctype html><title>当前文档</title>'], { type: 'text/html' }),
    fileName: '当前文档.html',
    mimeType: 'text/html;charset=utf-8',
  });
  mocks.upload.mockResolvedValue({
    objectKey: null,
    url: 'https://example.com/%E5%BD%93%E5%89%8D%E6%96%87%E6%A1%A3.html',
    size: 42,
    access: 'unknown',
    expiresAt: null,
  });
});

afterEach(async () => {
  await db.documents.clear();
  await db.shares.clear();
  await db.fileCategories.clear();
});

describe('shareMarkdownDocument', () => {
  it('uploads the selected format and records it in the file library without changing the draft', async () => {
    const result = await shareMarkdownDocument({
      documentId: documentRecord.id,
      title: documentRecord.title,
      markdown: '# 当前文档',
      format: 'html',
      appearance,
      access: 'provider-managed',
      profile,
    });

    expect(mocks.exportDocument).toHaveBeenCalledWith({
      markdown: '# 当前文档',
      title: '当前文档',
      appearance,
    });
    expect(mocks.upload).toHaveBeenCalledWith(profile, expect.objectContaining({
      fileName: '当前文档.html',
      contentType: 'text/html;charset=utf-8',
      access: 'provider-managed',
    }));
    expect(result.record).toMatchObject({
      displayName: '当前文档.html',
      category: 'Markdown 分享',
      url: 'https://example.com/%E5%BD%93%E5%89%8D%E6%96%87%E6%A1%A3.html',
    });
    expect(await db.shares.get(result.record.id)).toEqual(result.record);
    expect(await db.fileCategories.get('Markdown 分享')).toBeDefined();
    expect(result.document).toMatchObject({
      draftContent: '# 当前文档',
      baselineContent: '',
      lastDestination: 'online-share',
    });
  });
});
