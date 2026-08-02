const taskLinePattern = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[([ xX])\](?=\s|$)/;

/** Update one GFM task marker while preserving the rest of the source text. */
export function toggleTask(markdown: string, taskIndex: number, checked: boolean): string {
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return markdown;
  let currentIndex = 0;
  return markdown.split('\n').map((line) => {
    const match = taskLinePattern.exec(line);
    if (!match) return line;
    const lineIndex = currentIndex++;
    if (lineIndex !== taskIndex) return line;
    const markerStart = (match[1] ?? '').length;
    return `${line.slice(0, markerStart)}[${checked ? 'x' : ' '}]${line.slice(markerStart + 3)}`;
  }).join('\n');
}
