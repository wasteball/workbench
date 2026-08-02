import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@/features/markdown/engine/render-markdown';

describe('renderMarkdown', () => {
  it('renders GFM and math while removing executable content', async () => {
    const result = await renderMarkdown(`# 标题

[危险链接](javascript:alert(1))

<img src="x" onerror="alert(1)">
<script>window.attacked = true</script>

| A | B |
| - | - |
| 1 | 2 |

$x^2$
`);

    expect(result.html).toContain('<table');
    expect(result.html).toContain('<colgroup>');
    expect(result.html).toContain('style="width:');
    expect(result.html).toContain('class="katex"');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('onerror');
    expect(result.html).not.toContain('javascript:');
    expect(result.headings).toEqual([{ id: '标题', text: '标题', level: 1 }]);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks[0]).toMatchObject({ index: 0, type: 'heading', from: 0 });
    expect(result.html).toContain('class="markdown-block"');
    expect(result.html).toContain('data-source-from="0"');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('creates stable unique outline ids', async () => {
    const result = await renderMarkdown('## Same\n\n## Same\n');
    expect(result.headings.map((heading) => heading.id)).toEqual(['same', 'same-2']);
  });

  it('preserves Mermaid flowcharts for browser-side rendering', async () => {
    const result = await renderMarkdown('```mermaid\nflowchart TD\n  A[打开文件] --> B[直接编辑]\n```\n');

    expect(result.html).toContain('language-mermaid');
    expect(result.html).toContain('flowchart TD');
    expect(result.html).toContain('<pre><code class="hljs language-mermaid">');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ type: 'code', from: 0 });
  });

  it('keeps details intact while annotating editable blocks inside them', async () => {
    const result = await renderMarkdown(`<details>
<summary><strong>展开查看</strong></summary>

正文内容

| A | B |
| --- | --- |
| 1 | 2 |

</details>`);

    expect(result.html).toContain('<details>');
    expect(result.html).toContain('<summary><strong>展开查看</strong></summary>');
    expect(result.html).toContain('data-block-type="paragraph"');
    expect(result.html).toContain('data-block-type="table"');
    expect(result.blocks.map((block) => block.type)).toEqual(['paragraph', 'table']);
  });
});
