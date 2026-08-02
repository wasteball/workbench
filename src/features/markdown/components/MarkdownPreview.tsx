import { memo, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { nanoid } from 'nanoid';

import 'katex/dist/katex.min.css';
import './markdown-preview.css';

interface MarkdownPreviewProps {
  html: string;
  onTaskToggle?: (taskIndex: number, checked: boolean) => void;
}

export const MarkdownPreview = memo(function MarkdownPreview({ html, onTaskToggle }: MarkdownPreviewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let active = true;

    const cleanups: Array<() => void> = [];
    const enhance = async () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: dark ? 'dark' : 'default',
      });

      const mermaidBlocks = [...body.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
      for (const code of mermaidBlocks) {
        const pre = code.parentElement;
        if (!pre) continue;
        const source = code.textContent ?? '';
        try {
          const { svg } = await mermaid.render(`workbench-mermaid-${nanoid(8)}`, source);
          if (!active) return;
          const figure = document.createElement('figure');
          figure.className = 'mermaid-figure';
          const canvas = document.createElement('div');
          canvas.className = 'mermaid-figure__canvas';
          canvas.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
          const diagram = canvas.querySelector('svg');
          const toolbar = document.createElement('div');
          toolbar.className = 'mermaid-figure__toolbar';
          let zoom = 1;
          const zoomLabel = document.createElement('span');
          zoomLabel.className = 'mermaid-figure__zoom';
          const updateZoom = () => {
            const percentage = Math.round(zoom * 100);
            zoomLabel.textContent = `${percentage}%`;
            if (diagram) diagram.style.width = `${percentage}%`;
          };
          const addTool = (label: string, symbol: string, action: () => void) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mermaid-figure__tool';
            button.setAttribute('aria-label', label);
            button.title = label;
            button.textContent = symbol;
            button.addEventListener('click', action);
            toolbar.append(button);
          };
          addTool('缩小图表', '−', () => {
            zoom = Math.max(0.5, Number((zoom - 0.1).toFixed(1)));
            updateZoom();
          });
          addTool('放大图表', '+', () => {
            zoom = Math.min(3, Number((zoom + 0.1).toFixed(1)));
            updateZoom();
          });
          addTool('重置图表大小', '↺', () => {
            zoom = 1;
            updateZoom();
          });
          addTool('全屏查看图表', '⛶', () => {
            if (document.fullscreenElement === figure) {
              const exit = document.exitFullscreen?.();
              if (exit) void exit.catch(() => undefined);
            } else {
              const request = figure.requestFullscreen?.();
              if (request) void request.catch(() => undefined);
            }
          });
          toolbar.append(zoomLabel);
          updateZoom();
          const details = document.createElement('details');
          const summary = document.createElement('summary');
          summary.textContent = '查看图表源码';
          const sourcePre = document.createElement('pre');
          const sourceCode = document.createElement('code');
          sourceCode.textContent = source;
          sourcePre.append(sourceCode);
          details.append(summary, sourcePre);
          figure.append(toolbar, canvas, details);
          pre.replaceWith(figure);
        } catch {
          pre.dataset.renderError = '图表无法渲染，已保留源码。';
        }
      }

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

  return <div className="markdown-preview__body" dangerouslySetInnerHTML={{ __html: html }} ref={bodyRef} />;
});
