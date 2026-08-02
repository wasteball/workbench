import { describe, expect, it } from 'vitest';

import { applyContentAwareColumnWidths, contentAwareColumnWidths } from '@/features/markdown/engine/table-column-widths';

describe('content-aware table column widths', () => {
  it('keeps a sequence column narrow and gives descriptive content more room', () => {
    const widths = contentAwareColumnWidths([
      ['序号', '名称', '说明'],
      ['1', '登录', '用户输入账号和密码后进入工作台'],
      ['2', '导出', '将当前文档导出为 HTML、Word 或 PDF'],
    ], 1_000);

    expect(widths).toHaveLength(3);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(1_000);
    expect(widths[0]).toBeLessThan(widths[1]!);
    expect(widths[1]).toBeLessThan(widths[2]!);
    expect(widths[0]).toBeLessThanOrEqual(120);
    expect(widths[2]).toBeGreaterThanOrEqual(600);
  });

  it('writes the calculated ratios into a colgroup', () => {
    document.body.innerHTML = '<table><thead><tr><th>序号</th><th>内容说明</th></tr></thead><tbody><tr><td>1</td><td>这是一段明显更长的内容</td></tr></tbody></table>';
    const table = document.querySelector('table')!;
    const widths = applyContentAwareColumnWidths(table);
    const columns = table.querySelectorAll('col');

    expect(columns).toHaveLength(2);
    expect(widths[0]).toBeLessThan(widths[1]!);
    expect(columns[0]?.style.width).not.toBe(columns[1]?.style.width);
    expect(table.style.minWidth).toBe('520px');
  });

  it('prioritizes the descriptive column in the acceptance document table', () => {
    const widths = contentAwareColumnWidths([
      ['阶段', '时长', '目标', '对应模块'],
      ['入门', '第 1 周', '讲清楚 AI 外呼是什么、值多少钱、红线在哪', '一、二'],
      ['进阶', '第 2 至 3 周', '能独立拆解技术链路，读懂技术方案，写出 PRD', '三、四'],
      ['实践', '第 4 至 8 周', '能主导一个外呼项目从 0 到 1，能做效果归因与调优', '五、六'],
    ], 10_000);

    expect(widths.reduce((total, width) => total + width, 0)).toBe(10_000);
    expect(widths[0]).toBeLessThan(widths[1]!);
    expect(widths[2]).toBeGreaterThan(widths[0]! * 4);
    expect(widths[2]).toBeGreaterThan(widths[3]! * 3);
  });
});
