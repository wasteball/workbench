import { describe, expect, it } from 'vitest';

import { formatShareText } from '@/features/files/share-text';

const record = { displayName: 'report.docx', url: 'https://example.com/report.docx' };

describe('formatShareText', () => {
  it('formats every supported copy style', () => {
    expect(formatShareText(record, 'name-and-link')).toBe('report.docx\nhttps://example.com/report.docx');
    expect(formatShareText(record, 'markdown')).toBe('[report.docx](https://example.com/report.docx)');
    expect(formatShareText(record, 'single-line')).toBe('report.docx - https://example.com/report.docx');
    expect(formatShareText(record, 'link-only')).toBe('https://example.com/report.docx');
  });
});
