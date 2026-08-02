import { describe, expect, it } from 'vitest';

import {
  duplicateMarkdownBlock,
  markdownFromEditableBlock,
  moveMarkdownBlock,
  replaceMarkdownBlock,
  updateMarkdownTableCell,
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
});
