import { describe, expect, it } from 'vitest';

import {
  revertReviewChange,
  reviewMarkdownChanges,
} from '@/features/markdown/engine/review-changes';

describe('Markdown change review', () => {
  it('groups adjacent removed and added lines as a modification', () => {
    const baseline = '# 标题\n\n旧内容\n\n结尾\n';
    const current = '# 标题\n\n新内容\n\n结尾\n';
    const changes = reviewMarkdownChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'modified',
      before: '旧内容\n',
      after: '新内容\n',
      oldStartLine: 3,
      newStartLine: 3,
    });
    expect(revertReviewChange(current, changes[0]!)).toBe(baseline);
  });

  it('supports independent additions and removals', () => {
    const baseline = '第一段\n\n第二段\n\n结尾\n';
    const current = '新增\n\n第一段\n\n结尾\n';
    const changes = reviewMarkdownChanges(baseline, current);
    expect(changes.map((change) => change.kind)).toEqual(['added', 'removed']);
    expect(revertReviewChange(current, changes[0]!)).toBe('第一段\n\n结尾\n');
  });
});
