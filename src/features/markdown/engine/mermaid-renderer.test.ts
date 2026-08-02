import { beforeEach, describe, expect, it, vi } from 'vitest';

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, _source: string, host?: Element) => {
    if (host) host.innerHTML = `<div id="d${id}"><svg viewBox="0 0 100 50"></svg></div>`;
    return { svg: '<svg viewBox="0 0 100 50"></svg>' };
  }),
}));

vi.mock('mermaid', () => ({ default: { initialize, render } }));

import { renderMermaidSvg } from '@/features/markdown/engine/mermaid-renderer';

describe('renderMermaidSvg', () => {
  beforeEach(() => {
    initialize.mockClear();
    render.mockClear();
    document.body.replaceChildren();
  });

  it('renders in an isolated container and reuses the result', async () => {
    const source = `flowchart TD\n  isolated_${Date.now()} --> B`;
    const first = await renderMermaidSvg(source);
    const second = await renderMermaidSvg(source);

    expect(first).toBe(second);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[2]).toBeInstanceOf(HTMLDivElement);
    expect((render.mock.calls[0]?.[2] as HTMLDivElement).style.width).toBe('1200px');
    expect(document.body.children).toHaveLength(0);
  });
});
