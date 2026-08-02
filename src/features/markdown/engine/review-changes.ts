import { diffArrays, diffLines } from 'diff';

import {
  scanMarkdownTables,
  type MarkdownTable,
  type MarkdownTableSnapshot,
} from '@/features/markdown/engine/markdown-table';

export type ReviewChangeKind = 'added' | 'modified' | 'removed';
export type ReviewTableCellKind = 'same' | 'modified' | 'added' | 'removed';
export type ReviewTableRowKind = 'same' | 'modified' | 'added' | 'removed';

export interface ReviewTableCell {
  kind: ReviewTableCellKind;
  before: string;
  after: string;
}

export interface ReviewTableRow {
  kind: ReviewTableRowKind;
  cells: ReviewTableCell[];
}

export interface ReviewTableComparison {
  before: MarkdownTableSnapshot | null;
  after: MarkdownTableSnapshot | null;
  head: ReviewTableCell[];
  rows: ReviewTableRow[];
  modifiedHeaders: number;
  modifiedCells: number;
  addedRows: number;
  removedRows: number;
  addedColumns: number;
  removedColumns: number;
  replacement: boolean;
}

export interface ReviewChange {
  id: string;
  kind: ReviewChangeKind;
  before: string;
  after: string;
  oldStartLine: number;
  newStartLine: number;
  oldFrom: number;
  oldTo: number;
  currentFrom: number;
  currentTo: number;
  table?: ReviewTableComparison;
}

interface PendingPart {
  added: boolean;
  removed: boolean;
  value: string;
  oldStartLine: number;
  newStartLine: number;
  oldFrom: number;
  oldTo: number;
  currentFrom: number;
  currentTo: number;
}

function lineAdvance(value: string): number {
  return value.match(/\n/g)?.length ?? 0;
}

function buildChange(parts: PendingPart[], index: number): ReviewChange {
  const first = parts[0];
  if (!first) throw new Error('Cannot build an empty review change.');
  const removed = parts.filter((part) => part.removed);
  const added = parts.filter((part) => part.added);
  const before = removed.map((part) => part.value).join('');
  const after = added.map((part) => part.value).join('');
  const oldFrom = removed[0]?.oldFrom ?? first.oldFrom;
  const oldTo = removed.at(-1)?.oldTo ?? oldFrom;
  const currentFrom = added[0]?.currentFrom ?? first.currentFrom;
  const currentTo = added.at(-1)?.currentTo ?? currentFrom;
  const kind: ReviewChangeKind = before && after ? 'modified' : after ? 'added' : 'removed';
  const oldStartLine = removed[0]?.oldStartLine ?? first.oldStartLine;
  const newStartLine = added[0]?.newStartLine ?? first.newStartLine;
  return {
    id: `${kind}-${oldStartLine}-${newStartLine}-${index}`,
    kind,
    before,
    after,
    oldStartLine,
    newStartLine,
    oldFrom,
    oldTo,
    currentFrom,
    currentTo,
  };
}

function compareCell(before: string, after: string, beforeExists = true, afterExists = true): ReviewTableCell {
  const kind: ReviewTableCellKind = !beforeExists
    ? 'added'
    : !afterExists
      ? 'removed'
      : before === after
        ? 'same'
        : 'modified';
  return { kind, before, after };
}

function compareRow(before: string[], after: string[], columns: number): ReviewTableRow {
  const cells = Array.from({ length: columns }, (_, column) => compareCell(
    before[column] ?? '',
    after[column] ?? '',
    column < before.length,
    column < after.length,
  ));
  return { kind: cells.some((cell) => cell.kind !== 'same') ? 'modified' : 'same', cells };
}

function addedRow(row: string[], columns: number): ReviewTableRow {
  return {
    kind: 'added',
    cells: Array.from({ length: columns }, (_, column) => compareCell('', row[column] ?? '', false, column < row.length)),
  };
}

function removedRow(row: string[], columns: number): ReviewTableRow {
  return {
    kind: 'removed',
    cells: Array.from({ length: columns }, (_, column) => compareCell(row[column] ?? '', '', column < row.length, false)),
  };
}

function uniqueRowKeys(rows: string[][]): string[] | null {
  const keys = rows.map((row) => (row[0] ?? '').trim().toLocaleLowerCase());
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return null;
  return keys;
}

function compareRows(before: string[][], after: string[][], columns: number): ReviewTableRow[] {
  const beforeKeys = uniqueRowKeys(before);
  const afterKeys = uniqueRowKeys(after);
  const sharedKeys = beforeKeys && afterKeys
    ? beforeKeys.filter((key) => afterKeys.includes(key)).length
    : 0;

  if (beforeKeys && afterKeys && sharedKeys > 0) {
    const rows: ReviewTableRow[] = [];
    let beforeIndex = 0;
    let afterIndex = 0;
    for (const part of diffArrays(beforeKeys, afterKeys)) {
      if (part.removed) {
        for (let offset = 0; offset < part.value.length; offset += 1) rows.push(removedRow(before[beforeIndex + offset] ?? [], columns));
        beforeIndex += part.value.length;
      } else if (part.added) {
        for (let offset = 0; offset < part.value.length; offset += 1) rows.push(addedRow(after[afterIndex + offset] ?? [], columns));
        afterIndex += part.value.length;
      } else {
        for (let offset = 0; offset < part.value.length; offset += 1) {
          rows.push(compareRow(before[beforeIndex + offset] ?? [], after[afterIndex + offset] ?? [], columns));
        }
        beforeIndex += part.value.length;
        afterIndex += part.value.length;
      }
    }
    return rows;
  }

  const length = Math.max(before.length, after.length);
  return Array.from({ length }, (_, index) => {
    if (index >= before.length) return addedRow(after[index] ?? [], columns);
    if (index >= after.length) return removedRow(before[index] ?? [], columns);
    return compareRow(before[index] ?? [], after[index] ?? [], columns);
  });
}

export function compareReviewTables(
  beforeSnapshot: MarkdownTableSnapshot | null,
  afterSnapshot: MarkdownTableSnapshot | null,
  replacement = false,
): ReviewTableComparison {
  const before: MarkdownTable = beforeSnapshot ?? { head: [], align: [], rows: [] };
  const after: MarkdownTable = afterSnapshot ?? { head: [], align: [], rows: [] };
  const columns = Math.max(before.head.length, after.head.length);
  const head = Array.from({ length: columns }, (_, column) => compareCell(
    before.head[column] ?? '',
    after.head[column] ?? '',
    column < before.head.length,
    column < after.head.length,
  ));
  const rows = compareRows(before.rows, after.rows, columns);
  return {
    before: beforeSnapshot,
    after: afterSnapshot,
    head,
    rows,
    modifiedHeaders: head.filter((cell) => cell.kind === 'modified').length,
    modifiedCells: rows.reduce((count, row) => count + (row.kind === 'modified' ? row.cells.filter((cell) => cell.kind === 'modified').length : 0), 0),
    addedRows: rows.filter((row) => row.kind === 'added').length,
    removedRows: rows.filter((row) => row.kind === 'removed').length,
    addedColumns: Math.max(0, after.head.length - before.head.length),
    removedColumns: Math.max(0, before.head.length - after.head.length),
    replacement,
  };
}

export function describeReviewTableChange(table: ReviewTableComparison): string {
  if (table.replacement) return table.before ? '表格已替换为其他内容' : '原内容已替换为表格';
  if (!table.before && table.after) return `新增表格，共 ${table.after.rows.length} 行`;
  if (table.before && !table.after) return `删除表格，共 ${table.before.rows.length} 行`;
  const parts: string[] = [];
  const changedCells = table.modifiedHeaders + table.modifiedCells;
  if (changedCells > 0) parts.push(`${changedCells} 个单元格修改`);
  if (table.addedRows > 0) parts.push(`${table.addedRows} 行新增`);
  if (table.removedRows > 0) parts.push(`${table.removedRows} 行删除`);
  if (table.addedColumns > 0) parts.push(`${table.addedColumns} 列新增`);
  if (table.removedColumns > 0) parts.push(`${table.removedColumns} 列删除`);
  return parts.join('、') || '表格格式已调整';
}

function intersectsTable(table: MarkdownTableSnapshot, from: number, to: number): boolean {
  if (from === to) return from >= table.from && from <= table.to;
  return from < table.to && to > table.from;
}

function containedByTable(table: MarkdownTableSnapshot, from: number, to: number): boolean {
  return from >= table.from && to <= table.to;
}

function tableForRange(tables: MarkdownTableSnapshot[], from: number, to: number): MarkdownTableSnapshot | null {
  return tables.find((table) => intersectsTable(table, from, to)) ?? null;
}

function tableNearRange(table: MarkdownTableSnapshot | undefined, from: number, to: number): table is MarkdownTableSnapshot {
  if (!table) return false;
  if (intersectsTable(table, from, to)) return true;
  return from === to && Math.min(Math.abs(from - table.from), Math.abs(from - table.to)) <= 2;
}

function addTableComparisons(changes: ReviewChange[], baseline: string, current: string): ReviewChange[] {
  const beforeTables = scanMarkdownTables(baseline);
  const afterTables = scanMarkdownTables(current);
  if (beforeTables.length === 0 && afterTables.length === 0) return changes;

  const collapsed = new Set<string>();
  const result: ReviewChange[] = [];
  for (const change of changes) {
    let beforeTable = tableForRange(beforeTables, change.oldFrom, change.oldTo);
    let afterTable = tableForRange(afterTables, change.currentFrom, change.currentTo);
    if (!beforeTable && afterTable) {
      const candidate = beforeTables[afterTables.indexOf(afterTable)];
      if (tableNearRange(candidate, change.oldFrom, change.oldTo)) beforeTable = candidate;
    }
    if (!afterTable && beforeTable) {
      const candidate = afterTables[beforeTables.indexOf(beforeTable)];
      if (tableNearRange(candidate, change.currentFrom, change.currentTo)) afterTable = candidate;
    }
    const fullyInsideBefore = beforeTable
      ? containedByTable(beforeTable, change.oldFrom, change.oldTo) || tableNearRange(beforeTable, change.oldFrom, change.oldTo)
      : change.oldFrom === change.oldTo;
    const fullyInsideAfter = afterTable
      ? containedByTable(afterTable, change.currentFrom, change.currentTo) || tableNearRange(afterTable, change.currentFrom, change.currentTo)
      : change.currentFrom === change.currentTo;
    const canCollapse = fullyInsideBefore
      && fullyInsideAfter
      && ((beforeTable && afterTable) || (beforeTable && change.kind === 'removed') || (afterTable && change.kind === 'added'));

    if (canCollapse) {
      const key = `${beforeTable?.from ?? 'none'}:${beforeTable?.to ?? 'none'}:${afterTable?.from ?? 'none'}:${afterTable?.to ?? 'none'}`;
      if (collapsed.has(key)) continue;
      collapsed.add(key);
      const kind: ReviewChangeKind = beforeTable && afterTable ? 'modified' : afterTable ? 'added' : 'removed';
      result.push({
        id: `table-${key}`,
        kind,
        before: beforeTable?.raw ?? '',
        after: afterTable?.raw ?? '',
        oldStartLine: beforeTable?.startLine ?? change.oldStartLine,
        newStartLine: afterTable?.startLine ?? change.newStartLine,
        oldFrom: beforeTable?.from ?? change.oldFrom,
        oldTo: beforeTable?.to ?? change.oldTo,
        currentFrom: afterTable?.from ?? change.currentFrom,
        currentTo: afterTable?.to ?? change.currentTo,
        table: compareReviewTables(beforeTable, afterTable),
      });
      continue;
    }

    if (beforeTable || afterTable) {
      result.push({
        ...change,
        table: compareReviewTables(beforeTable, afterTable, change.kind === 'modified' && (!beforeTable || !afterTable)),
      });
    } else {
      result.push(change);
    }
  }
  return result;
}

export function reviewMarkdownChanges(baseline: string, current: string): ReviewChange[] {
  if (baseline === current) return [];
  const chunks = diffLines(baseline, current, { timeout: 300 }) ?? [
    { value: baseline, added: false, removed: true, count: 1 },
    { value: current, added: true, removed: false, count: 1 },
  ];
  const result: ReviewChange[] = [];
  let pending: PendingPart[] = [];
  let oldOffset = 0;
  let currentOffset = 0;
  let oldLine = 1;
  let currentLine = 1;

  const flush = () => {
    if (pending.length > 0) result.push(buildChange(pending, result.length));
    pending = [];
  };

  for (const chunk of chunks) {
    if (!chunk.added && !chunk.removed) {
      flush();
      oldOffset += chunk.value.length;
      currentOffset += chunk.value.length;
      oldLine += lineAdvance(chunk.value);
      currentLine += lineAdvance(chunk.value);
      continue;
    }

    pending.push({
      added: chunk.added,
      removed: chunk.removed,
      value: chunk.value,
      oldStartLine: oldLine,
      newStartLine: currentLine,
      oldFrom: oldOffset,
      oldTo: oldOffset + (chunk.removed ? chunk.value.length : 0),
      currentFrom: currentOffset,
      currentTo: currentOffset + (chunk.added ? chunk.value.length : 0),
    });
    if (chunk.removed) {
      oldOffset += chunk.value.length;
      oldLine += lineAdvance(chunk.value);
    }
    if (chunk.added) {
      currentOffset += chunk.value.length;
      currentLine += lineAdvance(chunk.value);
    }
  }
  flush();
  return addTableComparisons(result, baseline, current);
}

export function revertReviewChange(current: string, change: ReviewChange): string {
  return `${current.slice(0, change.currentFrom)}${change.before}${current.slice(change.currentTo)}`;
}
