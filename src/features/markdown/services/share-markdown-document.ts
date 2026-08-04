import { nanoid } from 'nanoid';

import { storageService } from '@/connectors/storage/storage-service';
import type { ExportAppearance, ExportFormat } from '@/features/markdown/exporters/contract';
import { getExporter } from '@/features/markdown/exporters/registry';
import { db, type DocumentRecord, type ShareRecord } from '@/shared/persistence/database';
import type { StorageProfile } from '@/shared/types';

export type DocumentShareAccess = 'private' | 'public' | 'provider-managed';

export interface ShareMarkdownDocumentInput {
  documentId: string;
  title: string;
  markdown: string;
  format: ExportFormat;
  appearance: ExportAppearance;
  access: DocumentShareAccess;
  profile: StorageProfile;
}

export interface ShareMarkdownDocumentResult {
  record: ShareRecord;
  document: DocumentRecord;
}

const MARKDOWN_SHARE_CATEGORY = 'Markdown 分享';

export function defaultDocumentShareAccess(profile: StorageProfile | undefined): DocumentShareAccess {
  if (!profile || profile.provider === 'gateway') return 'provider-managed';
  return profile.defaultAccess;
}

export async function shareMarkdownDocument({
  documentId,
  title,
  markdown,
  format,
  appearance,
  access,
  profile,
}: ShareMarkdownDocumentInput): Promise<ShareMarkdownDocumentResult> {
  const exported = await (await getExporter(format)).export({ markdown, title, appearance });
  const upload = await storageService.upload(profile, {
    blob: exported.blob,
    fileName: exported.fileName,
    contentType: exported.mimeType,
    access,
  });
  const now = Date.now();
  const record: ShareRecord = {
    id: nanoid(),
    fileName: exported.fileName,
    displayName: exported.fileName,
    relativePath: exported.fileName,
    size: upload.size,
    contentType: exported.mimeType,
    url: upload.url,
    objectKey: upload.objectKey,
    access: upload.access,
    expiresAt: upload.expiresAt,
    category: MARKDOWN_SHARE_CATEGORY,
    storageProfileId: profile.id,
    storageProvider: profile.provider,
    createdAt: now,
  };

  await db.transaction('rw', db.documents, db.shares, db.fileCategories, async () => {
    const category = await db.fileCategories.get(MARKDOWN_SHARE_CATEGORY);
    await db.fileCategories.put({
      name: MARKDOWN_SHARE_CATEGORY,
      createdAt: category?.createdAt ?? now,
      updatedAt: now,
    });
    await db.shares.add(record);
    const updated = await db.documents.update(documentId, {
      updatedAt: now,
      lastSavedAt: now,
      lastDestination: 'online-share',
    });
    if (updated !== 1) throw new Error('当前文档记录已失效，请重新打开后再分享。');
  });

  const document = await db.documents.get(documentId);
  if (!document) throw new Error('当前文档记录已失效，请重新打开后再分享。');
  return { record, document };
}
