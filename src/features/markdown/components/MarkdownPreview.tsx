import { memo, useEffect, useRef } from 'react';

import { enhanceMermaidDiagrams } from '@/features/markdown/components/enhance-mermaid';
import { findTextMatches } from '@/features/markdown/engine/find-replace';
import 'katex/dist/katex.min.css';
import './markdown-preview.css';

interface MarkdownPreviewProps {
  html: string;
  onTaskToggle?: (taskIndex: number, checked: boolean) => void;
  search?: {
    query: string;
    matchCase: boolean;
    current: number;
  };
}

const SEARCH_HIGHLIGHT = 'workbench-find-match';
const CURRENT_SEARCH_HIGHLIGHT = 'workbench-find-current';

export const MarkdownPreview = memo(function MarkdownPreview({ html, onTaskToggle, search }: MarkdownPreviewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchQuery = search?.query ?? '';
  const searchMatchCase = search?.matchCase ?? false;
  const searchCurrent = search?.current ?? 0;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let active = true;

    const cleanups: Array<() => void> = [];
    const enhance = async () => {
      const diagramCleanups = await enhanceMermaidDiagrams(body);
      if (!active) {
        diagramCleanups.forEach((cleanup) => cleanup());
        return;
      }
      cleanups.push(...diagramCleanups);

      if (onTaskToggle) {
        body.querySelectorAll<HTMLInputElement>('li.task-list-item > input[type="checkbox"]').forEach((checkbox, taskIndex) => {
          checkbox.removeAttribute('disabled');
          checkbox.classList.add('markdown-task-checkbox');
          const updateLabel = () => {
            checkbox.setAttribute('aria-label', checkbox.checked ? '标记任务为未完成' : '标记任务为已完成');
          };
          const handleChange = () => {
            updateLabel();
            onTaskToggle(taskIndex, checkbox.checked);
          };
          updateLabel();
          checkbox.addEventListener('change', handleChange);
          cleanups.push(() => checkbox.removeEventListener('change', handleChange));
        });
      }

      body.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
        if (pre.dataset.enhanced === 'true') return;
        pre.dataset.enhanced = 'true';
        const button = document.createElement('button');
        button.className = 'code-copy-button';
        button.type = 'button';
        button.textContent = '复制';
        button.title = '复制代码';
        button.addEventListener('click', () => {
          const source = pre.querySelector('code')?.textContent ?? '';
          void navigator.clipboard.writeText(source).then(() => {
            button.textContent = '已复制';
            window.setTimeout(() => { button.textContent = '复制'; }, 1_200);
          });
        });
        pre.append(button);
      });
    };

    void enhance();
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [html, onTaskToggle]);

  useEffect(() => {
    const registry = CSS.highlights;
    registry?.delete(SEARCH_HIGHLIGHT);
    registry?.delete(CURRENT_SEARCH_HIGHLIGHT);
    const body = bodyRef.current;
    if (!body || !registry || !searchQuery || typeof Highlight === 'undefined') return;

    const ranges: Range[] = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue || parent.closest('button, .mermaid-figure__source')) return NodeFilter.FILTER_REJECT;
        if (parent.offsetParent === null) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      for (const match of findTextMatches(node.data, searchQuery, searchMatchCase)) {
        const range = document.createRange();
        range.setStart(node, match.from);
        range.setEnd(node, match.to);
        ranges.push(range);
      }
    }
    if (ranges.length === 0) return;
    registry.set(SEARCH_HIGHLIGHT, new Highlight(...ranges));
    const current = ranges[((searchCurrent % ranges.length) + ranges.length) % ranges.length];
    if (!current) return;
    registry.set(CURRENT_SEARCH_HIGHLIGHT, new Highlight(current));
    window.requestAnimationFrame(() => current.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' }));

    return () => {
      registry.delete(SEARCH_HIGHLIGHT);
      registry.delete(CURRENT_SEARCH_HIGHLIGHT);
    };
  }, [searchCurrent, searchMatchCase, searchQuery]);

  return <div className="markdown-preview__body" dangerouslySetInnerHTML={{ __html: html }} ref={bodyRef} />;
});
