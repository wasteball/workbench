import { describe, expect, it } from 'vitest';

import {
  findTextMatches,
  replaceAllTextMatches,
  replaceTextMatch,
} from '@/features/markdown/engine/find-replace';

describe('find and replace', () => {
  it('finds literal text without treating punctuation as a regular expression', () => {
    expect(findTextMatches('A+B a+b A-B', 'A+B', false)).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
    expect(findTextMatches('A+B a+b', 'A+B', true)).toEqual([{ from: 0, to: 3 }]);
  });

  it('replaces one or all matches without changing surrounding Markdown', () => {
    const text = '# 标题\n\n正文 正文';
    const matches = findTextMatches(text, '正文', true);
    expect(replaceTextMatch(text, matches[1]!, '内容')).toBe('# 标题\n\n正文 内容');
    expect(replaceAllTextMatches(text, matches, '内容')).toBe('# 标题\n\n内容 内容');
  });
});
