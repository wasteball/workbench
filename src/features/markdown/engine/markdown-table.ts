export type MarkdownTableAlignment = 'left' | 'center' | 'right' | '';

export interface MarkdownTable {
  head: string[];
  align: MarkdownTableAlignment[];
  rows: string[][];
}

export interface MarkdownTableSnapshot extends MarkdownTable {
  from: number;
  to: number;
  startLine: number;
  raw: string;
}

interface SourceLine {
  text: string;
  from: number;
  to: number;
  fullTo: number;
  line: number;
}

export function splitMarkdownTableRow(line: string): string[] {
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

function sourceLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  let line = 1;
  while (from < markdown.length) {
    const newline = markdown.indexOf('\n', from);
    const fullTo = newline === -1 ? markdown.length : newline + 1;
    let to = newline === -1 ? markdown.length : newline;
    if (to > from && markdown[to - 1] === '\r') to -= 1;
    lines.push({ text: markdown.slice(from, to), from, to, fullTo, line });
    from = fullTo;
    line += 1;
  }
  return lines;
}

function hasUnescapedPipe(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') index += 1;
    else if (value[index] === '|') return true;
  }
  return false;
}

function delimiterAlignment(value: string): MarkdownTableAlignment | null {
  const trimmed = value.trim();
  if (!/^:?-+:?$/.test(trimmed)) return null;
  const left = trimmed.startsWith(':');
  const right = trimmed.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

function tableHeader(line: string, delimiter: string): { head: string[]; align: MarkdownTableAlignment[] } | null {
  if (!hasUnescapedPipe(line) || !hasUnescapedPipe(delimiter)) return null;
  const head = splitMarkdownTableRow(line);
  const delimiterCells = splitMarkdownTableRow(delimiter);
  if (head.length === 0 || delimiterCells.length !== head.length) return null;
  const align = delimiterCells.map(delimiterAlignment);
  if (align.some((value) => value === null)) return null;
  return { head, align: align as MarkdownTableAlignment[] };
}

export function scanMarkdownTables(markdown: string): MarkdownTableSnapshot[] {
  const lines = sourceLines(markdown);
  const tables: MarkdownTableSnapshot[] = [];
  let fence: { marker: '`' | '~'; size: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = line.text.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const token = fenceMatch[1]!;
      const marker = token[0] as '`' | '~';
      if (!fence) fence = { marker, size: token.length };
      else if (fence.marker === marker && token.length >= fence.size) fence = null;
      continue;
    }
    if (fence) continue;

    const delimiter = lines[index + 1];
    if (!delimiter) continue;
    const header = tableHeader(line.text, delimiter.text);
    if (!header) continue;

    const rows: string[][] = [];
    let last = delimiter;
    let rowIndex = index + 2;
    while (rowIndex < lines.length) {
      const rowLine = lines[rowIndex]!;
      if (!rowLine.text.trim() || /^\s*(`{3,}|~{3,})/.test(rowLine.text) || !hasUnescapedPipe(rowLine.text)) break;
      const cells = splitMarkdownTableRow(rowLine.text);
      while (cells.length < header.head.length) cells.push('');
      rows.push(cells.slice(0, header.head.length));
      last = rowLine;
      rowIndex += 1;
    }

    tables.push({
      ...header,
      rows,
      from: line.from,
      to: last.to,
      startLine: line.line,
      raw: markdown.slice(line.from, last.to),
    });
    index = rowIndex - 1;
  }

  return tables;
}

export function parseMarkdownTable(raw: string): MarkdownTable | null {
  const table = scanMarkdownTables(raw)[0];
  if (!table || raw.slice(0, table.from).trim() || raw.slice(table.to).trim()) return null;
  return { head: table.head, align: table.align, rows: table.rows };
}

function displayWidth(value: string): number {
  return [...value].reduce((width, character) => width + ((character.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);
}

function padCell(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  const widths = table.head.map((heading, column) => Math.max(
    3,
    displayWidth(heading),
    ...table.rows.map((row) => displayWidth(row[column] ?? '')),
  ));
  const line = (cells: string[]) => `| ${cells.map((cell, column) => padCell(cell, widths[column] ?? 3)).join(' | ')} |`;
  const delimiter = `| ${table.align.map((align, column) => {
    const width = widths[column] ?? 3;
    if (align === 'center') return `:${'-'.repeat(Math.max(3, width - 2))}:`;
    if (align === 'right') return `${'-'.repeat(Math.max(3, width - 1))}:`;
    if (align === 'left') return `:${'-'.repeat(Math.max(3, width - 1))}`;
    return '-'.repeat(Math.max(3, width));
  }).join(' | ')} |`;
  return [line(table.head), delimiter, ...table.rows.map(line)].join('\n');
}
