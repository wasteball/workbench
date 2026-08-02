function displayWidth(value: string): number {
  let width = 0;
  for (const character of value.replace(/\s+/g, ' ').trim()) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\s/u.test(character)) width += 0.45;
    else if (/\p{Punctuation}/u.test(character)) width += 0.7;
    else if (codePoint > 0xff) width += 2;
    else width += 1;
  }
  return width;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
}

function isCompactIdentifierColumn(values: string[]): boolean {
  const header = values[0]?.replace(/\s+/g, '').toLocaleLowerCase() ?? '';
  const compactHeader = /^(?:序号|编号|序|id|no\.?|#|index)$/i.test(header);
  const body = values.slice(1).map((value) => value.trim()).filter(Boolean);
  const compactBody = body.length > 0 && body.every((value) => (
    displayWidth(value) <= 6
    && /^(?:[a-z]?\d+|[一二三四五六七八九十百]+|[-–—])$/iu.test(value)
  ));
  return compactHeader || compactBody;
}

function preferredColumnWidth(values: string[]): number {
  const measured = values.map(displayWidth);
  const header = measured[0] ?? 0;
  const body = measured.slice(1);
  const samples = body.length > 0 ? body : measured;
  const average = samples.reduce((total, value) => total + value, 0) / Math.max(1, samples.length);
  const upperTypical = percentile(samples, 0.75);
  const longest = Math.max(0, ...samples);
  const preferred = Math.max(
    2.5,
    Math.min(48, header * 1.15),
    Math.min(48, upperTypical * 0.75 + average * 0.25),
    Math.min(48, longest * 0.55),
  );
  return isCompactIdentifierColumn(values) ? Math.max(1.5, preferred * 0.55) : preferred;
}

function maximumColumnRatio(columns: number): number {
  if (columns <= 1) return 1;
  if (columns === 2) return 0.9;
  if (columns === 3) return 0.76;
  if (columns === 4) return 0.62;
  if (columns === 5) return 0.52;
  if (columns === 6) return 0.44;
  return Math.max(0.28, 2.7 / columns);
}

function constrainedRatios(weights: number[], compactColumns: boolean[]): number[] {
  if (weights.length <= 1) return [1];
  const standardMinimum = Math.min(0.1, 0.5 / weights.length);
  const minimums = weights.map((_, index) => compactColumns[index] ? standardMinimum * 0.65 : standardMinimum);
  const maximum = maximumColumnRatio(weights.length);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const ratios = weights.map((weight) => weightTotal > 0 ? weight / weightTotal : 1 / weights.length);

  for (let pass = 0; pass < weights.length * 3; pass += 1) {
    ratios.forEach((ratio, index) => {
      ratios[index] = Math.min(maximum, Math.max(minimums[index] ?? standardMinimum, ratio));
    });
    const difference = 1 - ratios.reduce((sum, value) => sum + value, 0);
    if (Math.abs(difference) < 0.000_001) break;
    const candidates = ratios
      .map((ratio, index) => ({ index, ratio }))
      .filter(({ index, ratio }) => difference > 0
        ? ratio < maximum - 0.000_001
        : ratio > (minimums[index] ?? standardMinimum) + 0.000_001);
    if (candidates.length === 0) break;
    const candidateWeight = candidates.reduce((sum, { index }) => sum + (weights[index] ?? 0), 0);
    for (const { index } of candidates) {
      const share = candidateWeight > 0 ? (weights[index] ?? 0) / candidateWeight : 1 / candidates.length;
      ratios[index] = (ratios[index] ?? 0) + difference * share;
    }
  }
  return ratios;
}

export function contentAwareColumnWidths(rows: readonly (readonly string[])[], totalWidth: number): number[] {
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const values = Array.from({ length: columns }, (_, column) => rows.map((row) => String(row[column] ?? '')));
  const compactColumns = values.map(isCompactIdentifierColumn);
  const weights = values.map(preferredColumnWidth);
  const ratios = constrainedRatios(weights, compactColumns);
  const exact = ratios.map((ratio) => Math.max(1, ratio * totalWidth));
  const widths = exact.map(Math.floor);
  let remainder = Math.round(totalWidth) - widths.reduce((sum, width) => sum + width, 0);
  const remainderOrder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; remainder > 0; index = (index + 1) % remainderOrder.length) {
    widths[remainderOrder[index]?.index ?? 0] = (widths[remainderOrder[index]?.index ?? 0] ?? 0) + 1;
    remainder -= 1;
  }
  return widths;
}

export function applyContentAwareColumnWidths(table: HTMLTableElement): number[] {
  const rows = [...table.rows].map((row) => [...row.cells].map((cell) => cell.textContent?.trim() ?? ''));
  const widths = contentAwareColumnWidths(rows, 10_000);
  const existing = [...table.children].find((child) => child.tagName === 'COLGROUP');
  existing?.remove();
  const colgroup = table.ownerDocument.createElement('colgroup');
  widths.forEach((width) => {
    const column = table.ownerDocument.createElement('col');
    column.style.width = `${(width / 100).toFixed(2)}%`;
    colgroup.append(column);
  });
  table.prepend(colgroup);
  table.style.minWidth = `${Math.max(520, widths.length * 88)}px`;
  return widths;
}
