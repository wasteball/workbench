import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/shared/persistence/database';
import { documentService } from '@/shared/persistence/document-service';

describe('documentService', () => {
  beforeEach(async () => {
    await db.documents.clear();
  });

  it('stores metadata but not the content of an unmodified local file', async () => {
    const original = '# Private file\n\nOriginal content';
    const loaded = await documentService.importFile(new File([original], 'private.md', { type: 'text/markdown' }));
    const stored = await db.documents.get(loaded.record.id);

    expect(loaded.content).toBe(original);
    expect(stored?.draftContent).toBeNull();
    expect(stored?.baselineContent).toBeNull();
    expect(stored?.draftUpdatedAt).toBeNull();
  });

  it('stores a recovery draft and the original baseline after the first edit', async () => {
    const original = '# Original';
    const loaded = await documentService.importFile(new File([original], 'document.md'));
    await documentService.updateDraft(loaded.record.id, '# Changed', original);
    const stored = await db.documents.get(loaded.record.id);

    expect(stored?.draftContent).toBe('# Changed');
    expect(stored?.baselineContent).toBe(original);
    expect(stored?.lastDestination).toBe('browser-draft');
  });
});
