import { describe, expect, it } from 'vitest';

import {
  parseMarkdownTable,
  scanMarkdownTables,
  serializeMarkdownTable,
} from '@/features/markdown/engine/markdown-table';

describe('Markdown table model', () => {
  it('parses, scans, and serializes a GFM table', () => {
    const markdown = '开头\n\n| 阶段 | 时长 |\n| --- | ---: |\n| 入门 | 1 周 |\n\n结尾\n';
    const [table] = scanMarkdownTables(markdown);

    expect(table).toMatchObject({
      from: 4,
      startLine: 3,
      head: ['阶段', '时长'],
      align: ['', 'right'],
      rows: [['入门', '1 周']],
    });
    expect(parseMarkdownTable(table!.raw)).toEqual({
      head: ['阶段', '时长'],
      align: ['', 'right'],
      rows: [['入门', '1 周']],
    });
    expect(serializeMarkdownTable(parseMarkdownTable(table!.raw)!)).toContain('| 入门 | 1 周 |');
  });

  it('does not treat pipe-shaped source inside a code fence as a table', () => {
    const markdown = '```mermaid\nflowchart TD\n  A[阶段 | 时长]\n  | --- | --- |\n```\n';
    expect(scanMarkdownTables(markdown)).toEqual([]);
  });
});
