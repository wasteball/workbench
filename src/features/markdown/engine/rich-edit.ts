import type { MarkdownBlock } from '@/features/markdown/engine/render-markdown';

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

function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && index + 1 < source.length) {
      current += character + source[index + 1];
      index += 1;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

interface MarkdownTable {
  head: string[];
  align: Array<'left' | 'center' | 'right' | ''>;
  rows: string[][];
}

function parseMarkdownTable(raw: string): MarkdownTable | null {
  const lines = raw.trimEnd().split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || !/^[\s|:-]+$/.test(lines[1] ?? '')) return null;
  const head = splitTableRow(lines[0] ?? '');
  const align = splitTableRow(lines[1] ?? '').map((value) => {
    const trimmed = value.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
  });
  while (align.length < head.length) align.push('');
  const rows = lines.slice(2).map((line) => {
    const cells = splitTableRow(line);
    while (cells.length < head.length) cells.push('');
    return cells.slice(0, head.length);
  });
  return { head, align: align.slice(0, head.length), rows };
}

function displayWidth(value: string): number {
  return [...value].reduce((width, character) => width + ((character.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);
}

function padCell(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

function serializeMarkdownTable(table: MarkdownTable): string {
  const widths = table.head.map((heading, column) => Math.max(
    3,
    displayWidth(heading),
    ...table.rows.map((row) => displayWidth(row[column] ?? '')),
  ));
  const line = (cells: string[]) => `| ${cells.map((cell, column) => padCell(cell, widths[column] ?? 3)).join(' | ')} |`;
  const delimiter = `| ${table.align.map((align, column) => {
    const width = widths[column] ?? 3;
    if (align === 'center') return `:${'-'.repeat(Math.max(1, width - 2))}:`;
    if (align === 'right') return `${'-'.repeat(Math.max(1, width - 1))}:`;
    if (align === 'left') return `:${'-'.repeat(Math.max(1, width - 1))}`;
    return '-'.repeat(width);
  }).join(' | ')} |`;
  return [line(table.head), delimiter, ...table.rows.map(line)].join('\n');
}

export function updateMarkdownTableCell(raw: string, row: number, column: number, value: string): string | null {
  const table = parseMarkdownTable(raw);
  if (!table || column < 0 || column >= table.head.length) return null;
  const escaped = [...value].map((character, index) => character === '|' && value[index - 1] !== '\\' ? '\\|' : character).join('').trim();
  if (row < 0) table.head[column] = escaped;
  else if (table.rows[row]) table.rows[row][column] = escaped;
  else return null;
  return serializeMarkdownTable(table);
}
