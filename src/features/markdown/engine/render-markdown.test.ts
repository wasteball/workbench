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

    expect(result.html).toContain('<table>');
    expect(result.html).toContain('class="katex"');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('onerror');
    expect(result.html).not.toContain('javascript:');
    expect(result.headings).toEqual([{ id: '标题', text: '标题', level: 1 }]);
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('creates stable unique outline ids', async () => {
    const result = await renderMarkdown('## Same\n\n## Same\n');
    expect(result.headings.map((heading) => heading.id)).toEqual(['same', 'same-2']);
  });
});
