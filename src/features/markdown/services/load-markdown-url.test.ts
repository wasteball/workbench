import { describe, expect, it } from 'vitest';

import { normalizeMarkdownUrl } from '@/features/markdown/services/load-markdown-url';

describe('normalizeMarkdownUrl', () => {
  it('converts GitHub file pages to raw content URLs', () => {
    expect(normalizeMarkdownUrl('https://github.com/example/repo/blob/main/docs/readme.md')).toBe('https://raw.githubusercontent.com/example/repo/main/docs/readme.md');
  });

  it('rejects non-web protocols', () => {
    expect(() => normalizeMarkdownUrl('file:///tmp/readme.md')).toThrow('只支持 http 或 https 地址。');
  });
});
