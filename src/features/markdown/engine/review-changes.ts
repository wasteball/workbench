import { diffLines } from 'diff';

export type ReviewChangeKind = 'added' | 'modified' | 'removed';

export interface ReviewChange {
  id: string;
  kind: ReviewChangeKind;
  before: string;
  after: string;
  oldStartLine: number;
  newStartLine: number;
  currentFrom: number;
  currentTo: number;
}

interface PendingPart {
  added: boolean;
  removed: boolean;
  value: string;
  oldStartLine: number;
  newStartLine: number;
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
    currentFrom,
    currentTo,
  };
}

export function reviewMarkdownChanges(baseline: string, current: string): ReviewChange[] {
  if (baseline === current) return [];
  const chunks = diffLines(baseline, current, { timeout: 300 }) ?? [
    { value: baseline, added: false, removed: true, count: 1 },
    { value: current, added: true, removed: false, count: 1 },
  ];
  const result: ReviewChange[] = [];
  let pending: PendingPart[] = [];
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
      currentFrom: currentOffset,
      currentTo: currentOffset + (chunk.added ? chunk.value.length : 0),
    });
    if (chunk.removed) {
      oldLine += lineAdvance(chunk.value);
    }
    if (chunk.added) {
      currentOffset += chunk.value.length;
      currentLine += lineAdvance(chunk.value);
    }
  }
  flush();
  return result;
}

export function revertReviewChange(current: string, change: ReviewChange): string {
  return `${current.slice(0, change.currentFrom)}${change.before}${current.slice(change.currentTo)}`;
}
