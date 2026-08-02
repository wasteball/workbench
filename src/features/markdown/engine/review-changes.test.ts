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

  it('presents edits across one table as one cell-level change', () => {
    const baseline = `# 学习计划

| 阶段 | 时长 | 目标 |
| --- | --- | --- |
| 入门 | 第 1 周 | 了解产品 |
| 进阶 | 第 2 周 | 写出方案 |
`;
    const current = `# 学习计划

| 阶段 | 时长 | 目标 |
| --- | --- | --- |
| 入门 | 第 1 周 | 了解产品和价格 |
| 进阶 | 第 2 周 | 写出方案 |
| 实战 | 第 3 周 | 完成项目 |
`;

    const changes = reviewMarkdownChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'modified',
      oldStartLine: 3,
      newStartLine: 3,
      table: {
        modifiedCells: 1,
        addedRows: 1,
        removedRows: 0,
      },
    });
    expect(changes[0]!.table?.rows.map((row) => row.kind)).toEqual(['modified', 'same', 'added']);
    expect(revertReviewChange(current, changes[0]!)).toBe(baseline);
  });

  it('keeps code-fence replacements out of the structured table comparison', () => {
    const baseline = '| 阶段 | 时长 |\n| --- | --- |\n| 入门 | 1 周 |\n';
    const current = '```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```\n';
    const [change] = reviewMarkdownChanges(baseline, current);

    expect(change?.kind).toBe('modified');
    expect(change?.table?.replacement).toBe(true);
    expect(change?.table?.before?.head).toEqual(['阶段', '时长']);
    expect(change?.table?.after).toBeNull();
    expect(revertReviewChange(current, change!)).toBe(baseline);
  });

});
