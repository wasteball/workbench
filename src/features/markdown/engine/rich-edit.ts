import type { MarkdownBlock } from '@/features/markdown/engine/render-markdown';
import { parseMarkdownTable, serializeMarkdownTable } from '@/features/markdown/engine/markdown-table';

const HELPER_SELECTOR = '.rich-selection-toolbar, .markdown-block-tools, .block-source-editor, .inline-review-card, .code-copy-button';

function escapeInline(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/([\\`*_[\]~])/g, '\\$1');
}

function wrapNonEmpty(value: string, marker: string): string {
  if (!value.trim()) return value;
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return `${leading}${marker}${value.slice(leading.length, value.length - trailing.length)}${marker}${trailing}`;
}

function inlineMarkdown(node: Node): string {
  let output = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      output += escapeInline(child.nodeValue ?? '');
      continue;
    }
    if (!(child instanceof HTMLElement) || child.matches(HELPER_SELECTOR)) continue;
    if (child.classList.contains('code-copy-button')) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      output += '  \n';
    } else if (tag === 'strong' || tag === 'b') {
      output += wrapNonEmpty(inlineMarkdown(child), '**');
    } else if (tag === 'em' || tag === 'i') {
      output += wrapNonEmpty(inlineMarkdown(child), '*');
    } else if (tag === 'del' || tag === 's' || tag === 'strike') {
      output += wrapNonEmpty(inlineMarkdown(child), '~~');
    } else if (tag === 'mark' && child.hasAttribute('data-workbench-search')) {
      output += inlineMarkdown(child);
    } else if (tag === 'mark') {
      output += wrapNonEmpty(inlineMarkdown(child), '==');
    } else if (tag === 'code') {
      const value = child.textContent ?? '';
      const fence = value.includes('`') ? '``' : '`';
      output += `${fence}${value}${fence}`;
    } else if (tag === 'a') {
      const label = inlineMarkdown(child);
      const href = child.getAttribute('href') ?? '';
      output += label ? `[${label}](${href})` : '';
    } else if (tag === 'img') {
      output += `![${child.getAttribute('alt') ?? ''}](${child.getAttribute('src') ?? ''})`;
    } else if (tag === 'input') {
      // Task markers are serialized by the list item.
    } else if (tag === 'p' || tag === 'div') {
      const value = inlineMarkdown(child).trim();
      if (value) output += `${output.trimEnd() ? '\n\n' : ''}${value}`;
    } else {
      output += inlineMarkdown(child);
    }
  }
  return output;
}

function listMarkdown(list: HTMLOListElement | HTMLUListElement, indent = ''): string {
  const ordered = list instanceof HTMLOListElement;
  const start = ordered ? Number(list.getAttribute('start') || 1) : 1;
  const lines: string[] = [];
  let itemIndex = 0;
  for (const item of [...list.children]) {
    if (!(item instanceof HTMLLIElement)) continue;
    const marker = ordered ? `${start + itemIndex}. ` : '- ';
    const task = item.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
    const clone = item.cloneNode(true) as HTMLLIElement;
    clone.querySelectorAll(':scope > ul, :scope > ol, input[type="checkbox"]').forEach((element) => element.remove());
    const continuation = ' '.repeat(marker.length);
    const value = inlineMarkdown(clone).trim().replace(/\n/g, `\n${indent}${continuation}`);
    lines.push(`${indent}${marker}${task ? `[${task.checked ? 'x' : ' '}] ` : ''}${value}`);
    for (const nested of [...item.children]) {
      if (nested instanceof HTMLUListElement || nested instanceof HTMLOListElement) {
        lines.push(listMarkdown(nested, `${indent}${continuation}`));
      }
    }
    itemIndex += 1;
  }
  return lines.join('\n');
}

function nodeMarkdown(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineMarkdown(element).trim()}`;
  if (element instanceof HTMLUListElement || element instanceof HTMLOListElement) return listMarkdown(element);
  if (tag === 'blockquote') {
    return [...element.children]
      .map((child) => child instanceof HTMLElement ? nodeMarkdown(child) : '')
      .filter(Boolean)
      .join('\n\n')
      .split('\n')
      .map((line) => `> ${line}`.trimEnd())
      .join('\n');
  }
  if (tag === 'hr') return '---';
  return inlineMarkdown(element).trim().replace(/^(\s*)(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```)/, '$1\\$2');
}

export function markdownFromEditableBlock(block: HTMLElement): string {
  const parts: string[] = [];
  for (const child of [...block.children]) {
    if (!(child instanceof HTMLElement) || child.matches(HELPER_SELECTOR)) continue;
    const markdown = nodeMarkdown(child);
    if (markdown.trim()) parts.push(markdown);
  }
  if (parts.length > 0) return parts.join('\n\n');
  return inlineMarkdown(block).trim();
}

export function canEditBlockRichly(block: HTMLElement): boolean {
  const type = block.dataset.blockType;
  if (!['paragraph', 'heading', 'list', 'blockquote'].includes(type ?? '')) return false;
  return !block.querySelector('pre, table, img, .katex, .mermaid-figure, input[type="checkbox"]');
}

export function sourceLabelForBlock(block: MarkdownBlock): string {
  if (/^```\s*mermaid\b/i.test(block.raw)) return '流程图源码（Mermaid）';
  if (block.type === 'code') return '代码块';
  if (block.type === 'table') return '表格源码';
  if (/^\s*\$\$/m.test(block.raw)) return '数学公式';
  if (/^\s*!\[/m.test(block.raw)) return '图片';
  return 'Markdown 源码';
}

export function replaceMarkdownBlock(markdown: string, block: Pick<MarkdownBlock, 'from' | 'to'>, replacement: string): string {
  if (replacement.trim()) {
    return `${markdown.slice(0, block.from)}${replacement.trimEnd()}${markdown.slice(block.to)}`;
  }
  const before = markdown.slice(0, block.from).replace(/[ \t]+$/g, '');
  const after = markdown.slice(block.to).replace(/^(?:[ \t]*\r?\n){0,2}/, '');
  if (!before.trim()) return after;
  if (!after.trim()) return before.replace(/\s+$/g, '') + (markdown.endsWith('\n') ? '\n' : '');
  return `${before.replace(/\n{2,}$/g, '')}\n\n${after}`;
}

export function insertMarkdownAfterBlock(markdown: string, block: Pick<MarkdownBlock, 'to'>, value = ''): string {
  const prefix = markdown.slice(0, block.to).replace(/[ \t]+$/g, '');
  const suffix = markdown.slice(block.to).replace(/^\s*/, '');
  const inserted = value.trimEnd();
  return `${prefix}\n\n${inserted}${inserted ? '\n\n' : ''}${suffix}`;
}

export function duplicateMarkdownBlock(markdown: string, block: MarkdownBlock): string {
  return insertMarkdownAfterBlock(markdown, block, block.raw);
}

export function moveMarkdownBlock(
  markdown: string,
  blocks: MarkdownBlock[],
  index: number,
  direction: -1 | 1,
): string {
  const currentPosition = blocks.findIndex((block) => block.index === index);
  const otherPosition = currentPosition + direction;
  const current = blocks[currentPosition];
  const other = blocks[otherPosition];
  if (!current || !other) return markdown;
  const first = direction < 0 ? other : current;
  const second = direction < 0 ? current : other;
  const separator = markdown.slice(first.to, second.from);
  return `${markdown.slice(0, first.from)}${markdown.slice(second.from, second.to)}${separator}${markdown.slice(first.from, first.to)}${markdown.slice(second.to)}`;
}

export type MarkdownTableOperation =
  | 'row-above'
  | 'row-below'
  | 'row-delete'
  | 'column-left'
  | 'column-right'
  | 'column-delete'
  | 'align-left'
  | 'align-center'
  | 'align-right';

export interface MarkdownTableOperationResult {
  value: string;
  row: number;
  column: number;
}

export type MarkdownBlockInsertKind =
  | 'paragraph'
  | 'heading-2'
  | 'heading-3'
  | 'bullet-list'
  | 'numbered-list'
  | 'task-list'
  | 'table'
  | 'blockquote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'mermaid'
  | 'math'
  | 'image';

export type MarkdownBlockTransformKind =
  | 'paragraph'
  | 'heading-2'
  | 'heading-3'
  | 'bullet-list'
  | 'numbered-list'
  | 'task-list'
  | 'blockquote'
  | 'code';

export function updateMarkdownTableCell(raw: string, row: number, column: number, value: string): string | null {
  const table = parseMarkdownTable(raw);
  if (!table || column < 0 || column >= table.head.length) return null;
  const escaped = [...value].map((character, index) => character === '|' && value[index - 1] !== '\\' ? '\\|' : character).join('').trim();
  if (row < 0) table.head[column] = escaped;
  else if (table.rows[row]) table.rows[row][column] = escaped;
  else return null;
  return serializeMarkdownTable(table);
}

function blankTableRow(columns: number): string[] {
  return Array.from({ length: columns }, () => '');
}

export function updateMarkdownTableStructure(
  raw: string,
  operation: MarkdownTableOperation,
  row: number,
  column: number,
): MarkdownTableOperationResult {
  const table = parseMarkdownTable(raw);
  if (!table) throw new Error('这不是一个标准 Markdown 表格。');
  if (column < 0 || column >= table.head.length) throw new Error('没有找到这一列。');

  let nextRow = row;
  let nextColumn = column;
  const columnCount = table.head.length;

  if (operation === 'row-above') {
    if (row < 0) throw new Error('表头上面不能插入正文行。');
    table.rows.splice(row, 0, blankTableRow(columnCount));
  } else if (operation === 'row-below') {
    nextRow = row < 0 ? 0 : row + 1;
    table.rows.splice(nextRow, 0, blankTableRow(columnCount));
  } else if (operation === 'row-delete') {
    if (row < 0) throw new Error('表头不能删除。');
    table.rows.splice(row, 1);
    nextRow = Math.min(row, table.rows.length - 1);
  } else if (operation === 'column-left') {
    table.head.splice(column, 0, '');
    table.align.splice(column, 0, '');
    table.rows.forEach((cells) => cells.splice(column, 0, ''));
  } else if (operation === 'column-right') {
    nextColumn = column + 1;
    table.head.splice(nextColumn, 0, '');
    table.align.splice(nextColumn, 0, '');
    table.rows.forEach((cells) => cells.splice(nextColumn, 0, ''));
  } else if (operation === 'column-delete') {
    if (columnCount <= 1) throw new Error('表格至少要保留一列。');
    table.head.splice(column, 1);
    table.align.splice(column, 1);
    table.rows.forEach((cells) => cells.splice(column, 1));
    nextColumn = Math.min(column, table.head.length - 1);
  } else {
    table.align[column] = operation === 'align-center' ? 'center' : operation === 'align-right' ? 'right' : 'left';
  }

  return {
    value: serializeMarkdownTable(table),
    row: nextRow,
    column: nextColumn,
  };
}

export function markdownForInsertedBlock(kind: MarkdownBlockInsertKind): string {
  const blocks: Record<MarkdownBlockInsertKind, string> = {
    paragraph: '在这里写点什么',
    'heading-2': '## 标题',
    'heading-3': '### 标题',
    'bullet-list': '- 列表项\n- 列表项',
    'numbered-list': '1. 第一项\n2. 第二项',
    'task-list': '- [ ] 待办事项\n- [ ] 待办事项',
    table: '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |',
    blockquote: '> 引用内容',
    callout: '> [!TIP]\n> 提示内容',
    divider: '---',
    code: '```text\n\n```',
    mermaid: '```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```',
    math: '$$\nE = mc^2\n$$',
    image: '![图片描述](图片地址)',
  };
  return blocks[kind];
}

function strippedBlockLines(raw: string): string[] {
  return raw
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
      .replace(/^```.*$/, '')
      .trim())
    .filter(Boolean);
}

export function transformMarkdownBlock(raw: string, kind: MarkdownBlockTransformKind): string {
  const lines = strippedBlockLines(raw);
  if (lines.length === 0) return raw;
  if (kind === 'paragraph') return lines.join('\n\n');
  if (kind === 'heading-2') return `## ${lines.join(' ')}`;
  if (kind === 'heading-3') return `### ${lines.join(' ')}`;
  if (kind === 'bullet-list') return lines.map((line) => `- ${line}`).join('\n');
  if (kind === 'numbered-list') return lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
  if (kind === 'task-list') return lines.map((line) => `- [ ] ${line}`).join('\n');
  if (kind === 'blockquote') return lines.map((line) => `> ${line}`).join('\n');
  return `\`\`\`text\n${lines.join('\n')}\n\`\`\``;
}
