import { createElement } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/settings-context', () => ({
  useSettings: () => ({
    settings: { readingFont: 'serif', readingFontSize: 17, readingWidth: 760 },
  }),
}));

vi.mock('@/features/markdown/components/enhance-mermaid', () => ({
  enhanceMermaidDiagrams: vi.fn(async () => []),
}));

import { findReviewNavigationTarget, MarkdownPreview } from '@/features/markdown/components/MarkdownPreview';
import { renderMarkdown } from '@/features/markdown/engine/render-markdown';
import { reviewMarkdownChanges, type ReviewChange } from '@/features/markdown/engine/review-changes';

const change: ReviewChange = {
  id: 'table-change',
  kind: 'modified',
  before: '| Name |\n| --- |\n| Before |',
  after: '| Name |\n| --- |\n| After |',
  oldStartLine: 2,
  newStartLine: 2,
  oldFrom: 20,
  oldTo: 50,
  currentFrom: 20,
  currentTo: 49,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('findReviewNavigationTarget', () => {
  it('locates the visible review card before a suppressed table block', () => {
    const body = document.createElement('div');
    body.innerHTML = `
      <section class="inline-review-card inline-review-card--table" data-review-index="0"></section>
      <div class="markdown-block markdown-block--review-suppressed" data-source-from="20" data-source-to="49"></div>
    `;

    const card = body.querySelector('.inline-review-card');
    expect(findReviewNavigationTarget(body, change, 0)).toBe(card);
  });

  it('falls back to the matching Markdown block before a review card exists', () => {
    const body = document.createElement('div');
    body.innerHTML = '<div class="markdown-block" data-source-from="20" data-source-to="49"></div>';

    const block = body.querySelector('.markdown-block');
    expect(findReviewNavigationTarget(body, change, 0)).toBe(block);
  });

  it('positions the visible table review again when the current change is selected repeatedly', async () => {
    const baseline = '| Name |\n| --- |\n| Before |';
    const current = '| Name |\n| --- |\n| After |';
    const rendered = await renderMarkdown(current);
    const changes = reviewMarkdownChanges(baseline, current);
    expect(changes[0]?.table).toBeDefined();

    const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const review = (focusVersion: number) => ({
      changes,
      current: 0,
      focusVersion,
      showMarks: true,
      showAll: false,
      showCurrent: true,
      onSelect: vi.fn(),
      onStep: vi.fn(),
      onRevert: vi.fn(),
      onCollapseInline: vi.fn(),
    });

    try {
      const result = render(createElement(MarkdownPreview, {
        html: rendered.html,
        markdown: current,
        blocks: rendered.blocks,
        review: review(0),
      }));
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      expect(scrollIntoView.mock.instances[0]).toHaveClass('inline-review-card--table');
      expect(scrollIntoView.mock.instances[0]).not.toHaveClass('markdown-block--review-suppressed');

      result.rerender(createElement(MarkdownPreview, {
        html: rendered.html,
        markdown: current,
        blocks: rendered.blocks,
        review: review(1),
      }));
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
      expect(scrollIntoView.mock.instances[1]).toHaveClass('inline-review-card--table');
    } finally {
      if (originalScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });
});
