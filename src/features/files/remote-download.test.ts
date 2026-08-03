import { describe, expect, it } from 'vitest';

import {
  filenameFromContentDisposition,
  filenameFromUrl,
  isObjectStorageError,
  resolveDownloadUrl,
  safeDownloadFilename,
} from '@/features/files/remote-download';

describe('remote download naming', () => {
  it('prefers an RFC 5987 Chinese filename', () => {
    expect(filenameFromContentDisposition(
      "attachment; filename=notes.md; filename*=UTF-8''%E5%AD%A6%E4%B9%A0%E6%89%8B%E5%86%8C.md",
    )).toBe('学习手册.md');
  });

  it('decodes a Chinese URL pathname', () => {
    expect(filenameFromUrl('https://example.com/files/%E9%A1%B9%E7%9B%AE%E8%AF%B4%E6%98%8E.md?token=1'))
      .toBe('项目说明.md');
  });

  it('unwraps a supported object-storage URL parameter', () => {
    expect(resolveDownloadUrl('https://example.com/download?file_path=https%3A%2F%2Fcdn.example.com%2F%E6%96%87%E6%A1%A3.md'))
      .toBe('https://cdn.example.com/%E6%96%87%E6%A1%A3.md');
  });

  it('removes path and reserved characters without changing the extension', () => {
    expect(safeDownloadFilename('folder/项目:说明?.md')).toBe('项目_说明_.md');
  });

  it('detects an OSS XML error instead of saving it as Markdown', async () => {
    const blob = new Blob([
      '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>expired</Message></Error>',
    ], { type: 'application/xml' });

    await expect(isObjectStorageError(blob, 'application/xml', '学习手册.md')).resolves.toBe(true);
    await expect(isObjectStorageError(blob, 'application/xml', 'response.xml')).resolves.toBe(false);
  });

  it('keeps ordinary Markdown content unchanged', async () => {
    const markdown = '# 学习手册\n\n原始内容保持不变。\n';
    const blob = new Blob([markdown], { type: 'text/markdown' });

    await expect(isObjectStorageError(blob, blob.type, '学习手册.md')).resolves.toBe(false);
    await expect(blob.text()).resolves.toBe(markdown);
  });

  it('detects a bucket listing returned for a Markdown address', async () => {
    const blob = new Blob([
      '<?xml version="1.0"?><ListBucketResult><Name>example</Name></ListBucketResult>',
    ], { type: 'application/xml' });

    await expect(isObjectStorageError(blob, blob.type, '学习手册.md')).resolves.toBe(true);
  });
});
