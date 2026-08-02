export interface TextMatch {
  from: number;
  to: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findTextMatches(text: string, query: string, matchCase: boolean): TextMatch[] {
  if (!query) return [];
  const matches: TextMatch[] = [];
  const expression = new RegExp(escapeRegExp(query), matchCase ? 'gu' : 'giu');
  for (const match of text.matchAll(expression)) {
    const from = match.index;
    matches.push({ from, to: from + match[0].length });
  }
  return matches;
}

export function replaceTextMatch(text: string, match: TextMatch, replacement: string): string {
  return `${text.slice(0, match.from)}${replacement}${text.slice(match.to)}`;
}

export function replaceAllTextMatches(text: string, matches: TextMatch[], replacement: string): string {
  if (matches.length === 0) return text;
  let result = '';
  let offset = 0;
  for (const match of matches) {
    result += text.slice(offset, match.from) + replacement;
    offset = match.to;
  }
  return result + text.slice(offset);
}
