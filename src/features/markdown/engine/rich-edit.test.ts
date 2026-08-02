import { describe, expect, it } from 'vitest';

import {
  duplicateMarkdownBlock,
  markdownForInsertedBlock,
  markdownFromEditableBlock,
  moveMarkdownBlock,
  replaceMarkdownBlock,
  transformMarkdownBlock,
  updateMarkdownTableCell,
  updateMarkdownTableStructure,
} from '@/features/markdown/engine/rich-edit';
import type { MarkdownBlock } from '@/features/markdown/engine/render-markdown';

function block(index: number, from: number, to: number, raw: string): MarkdownBlock {
  return { index, from, to, raw, type: 'paragraph' };
}

describe('rich Markdown editing', () => {
  it('serializes visible formatting without leaking search highlights', () => {
    const element = document.createElement('div');
    element.dataset.blockType = 'paragraph';
    element.innerHTML = '<p>这是 <strong>重点</strong> 和 <mark data-workbench-search>查找结果</mark>。</p>';

    expect(markdownFromEditableBlock(element)).toBe('这是 **重点** 和 查找结果。');
  });

  it('replaces, duplicates, and reorders whole blocks without touching neighbors', () => {
    const markdown = '第一段\n\n第二段\n';
    const first = block(0, 0, 3, '第一段');
    const second = block(1, 5, 8, '第二段');

    expect(replaceMarkdownBlock(markdown, first, '新内容')).toBe('新内容\n\n第二段\n');
    expect(duplicateMarkdownBlock(markdown, first)).toBe('第一段\n\n第一段\n\n第二段\n');
    expect(moveMarkdownBlock(markdown, [first, second], 0, 1)).toBe('第二段\n\n第一段\n');
  });

  it('updates a rendered table cell back into valid Markdown', () => {
    const table = '| 名称 | 状态 |\n| --- | --- |\n| 工作台 | 进行中 |';
    const updated = updateMarkdownTableCell(table, 0, 1, '已完成');

    expect(updated).toContain('| 工作台 | 已完成 |');
    expect(updated).toContain('| ------ | ------ |');
  });

  it('adds, removes, and aligns table rows and columns', () => {
    const table = '| 名称 | 状态 |\n| --- | --- |\n| 工作台 | 进行中 |';
    const withRow = updateMarkdownTableStructure(table, 'row-below', 0, 1);
    expect(withRow.row).toBe(1);
    expect(withRow.value.split('\n')).toHaveLength(4);

    const withColumn = updateMarkdownTableStructure(withRow.value, 'column-right', 0, 0);
    expect(withColumn.column).toBe(1);
    expect(withColumn.value.split('\n')[0]?.replace(/\s+/g, ' ')).toBe('| 名称 | | 状态 |');

    const aligned = updateMarkdownTableStructure(withColumn.value, 'align-center', 0, 1);
    expect(aligned.value.split('\n')[1]).toContain(':---:');

    const withoutRow = updateMarkdownTableStructure(aligned.value, 'row-delete', 1, 1);
    expect(withoutRow.value.split('\n')).toHaveLength(3);
  });

  it('provides structured insertions and block conversions', () => {
    expect(markdownForInsertedBlock('table')).toContain('| 列 1 | 列 2 | 列 3 |');
    expect(markdownForInsertedBlock('mermaid')).toContain('flowchart TD');
    expect(transformMarkdownBlock('普通文字', 'heading-2')).toBe('## 普通文字');
    expect(transformMarkdownBlock('- 第一项\n- 第二项', 'numbered-list')).toBe('1. 第一项\n2. 第二项');
  });
});
