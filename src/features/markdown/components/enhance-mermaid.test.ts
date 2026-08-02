import { describe, expect, it, vi } from 'vitest';

const { renderMermaidSvg } = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(async () => '<svg viewBox="0 0 10 10"></svg>'),
}));

vi.mock('@/features/markdown/engine/mermaid-renderer', () => ({ renderMermaidSvg }));

import { enhanceMermaidDiagrams } from '@/features/markdown/components/enhance-mermaid';

describe('enhanceMermaidDiagrams', () => {
  it('does not render the source viewer inside an existing diagram again', async () => {
    const body = document.createElement('div');
    body.innerHTML = '<figure class="mermaid-figure"><pre class="mermaid-figure__source"><code class="language-mermaid">flowchart TD; A-->B</code></pre></figure>';

    await enhanceMermaidDiagrams(body);

    expect(renderMermaidSvg).not.toHaveBeenCalled();
    expect(body.querySelectorAll('.mermaid-figure')).toHaveLength(1);
  });

  it('uses the preferred zoom, fit, and fullscreen icon sequence', async () => {
    const body = document.createElement('div');
    body.innerHTML = '<pre><code class="language-mermaid">flowchart TD; A--&gt;B</code></pre>';
    document.body.append(body);
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    try {
      const cleanups = await enhanceMermaidDiagrams(body);
      const controls = [...body.querySelectorAll<HTMLButtonElement>('.mermaid-figure__controls button')];

      expect(controls.map((button) => button.getAttribute('aria-label'))).toEqual([
        '缩小图表',
        '放大图表',
        '适应画布',
        '全屏查看',
      ]);
      expect(controls[0]?.querySelector('.lucide-zoom-out')).toBeInTheDocument();
      expect(controls[1]?.querySelector('.lucide-zoom-in')).toBeInTheDocument();
      expect(controls[2]?.querySelector('.lucide-minimize')).toBeInTheDocument();
      expect(controls[3]?.querySelector('.lucide-maximize')).toBeInTheDocument();
      cleanups.forEach((cleanup) => cleanup());
    } finally {
      body.remove();
      vi.unstubAllGlobals();
    }
  });
});
