import DOMPurify from 'dompurify';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check,
  Code2,
  Copy,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  Scan,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import mermaid from 'mermaid';
import { nanoid } from 'nanoid';

type Cleanup = () => void;

interface DiagramDimensions {
  width: number;
  height: number;
}

interface DiagramTool {
  button: HTMLButtonElement;
  update: (label: string, icon: LucideIcon) => void;
}

let renderQueue: Promise<unknown> = Promise.resolve();

function listen(
  target: EventTarget,
  type: string,
  listener: EventListener,
  cleanups: Cleanup[],
  options?: AddEventListenerOptions | boolean,
) {
  target.addEventListener(type, listener, options);
  cleanups.push(() => target.removeEventListener(type, listener, options));
}

function fixEncodedEntities(svg: string): string {
  return svg.replace(/&amp;(gt|lt|amp|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, '&$1;');
}

function quoteQuadrantText(raw: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  const value = match?.[2] ?? raw;
  if (!Array.from(value).some((character) => character.charCodeAt(0) > 0x7f) || /^"[\s\S]*"$/.test(value)) return raw;
  return `${match?.[1] ?? ''}"${value.replace(/"/g, '#34;')}"${match?.[3] ?? ''}`;
}

function prepareMermaidSource(source: string): string {
  if (!/(?:^|\n)\s*quadrantChart\s*(?:\n|$)/i.test(source)) return source;
  return source.split(/\r?\n/).map((line) => {
    const axis = /^(\s*[xy]-axis\s+)(.+?)(\s*-->\s*)(.+?)(\s*)$/i.exec(line);
    if (axis) return `${axis[1] ?? ''}${quoteQuadrantText(axis[2] ?? '')}${axis[3] ?? ''}${quoteQuadrantText(axis[4] ?? '')}${axis[5] ?? ''}`;
    const quadrant = /^(\s*quadrant-[1-4]\s+)(.+?)(\s*)$/i.exec(line);
    if (quadrant) return `${quadrant[1] ?? ''}${quoteQuadrantText(quadrant[2] ?? '')}${quadrant[3] ?? ''}`;
    const point = /^(\s*)(.+?)(\s*:\s*\[[^\]]+\]\s*)$/.exec(line);
    if (point) return `${point[1] ?? ''}${quoteQuadrantText(point[2] ?? '')}${point[3] ?? ''}`;
    return line;
  }).join('\n');
}

function dimensions(svg: SVGSVGElement): DiagramDimensions {
  const viewBox = svg.viewBox?.baseVal;
  if (viewBox?.width && viewBox.height) return { width: viewBox.width, height: viewBox.height };
  try {
    const box = svg.getBBox();
    if (box.width && box.height) return { width: box.width, height: box.height };
  } catch {
    // Some browsers do not expose a box until the SVG is attached.
  }
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 640, height: rect.height || 360 };
}

function makeTool(label: string, icon: LucideIcon, action: string, cleanups: Cleanup[]): DiagramTool {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.diagramAction = action;
  const root = createRoot(button);
  let active = true;
  const update = (nextLabel: string, nextIcon: LucideIcon) => {
    if (!active) return;
    button.setAttribute('aria-label', nextLabel);
    button.title = nextLabel;
    root.render(createElement(nextIcon, {
      'aria-hidden': true,
      size: 17,
      strokeWidth: 1.8,
    }));
  };
  update(label, icon);
  cleanups.push(() => {
    active = false;
    root.unmount();
  });
  return { button, update };
}

function installPanZoom(
  figure: HTMLElement,
  viewport: HTMLElement,
  stage: HTMLElement,
  svg: SVGSVGElement,
  controls: HTMLElement,
  cleanups: Cleanup[],
) {
  const size = dimensions(svg);
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.width = `${size.width}px`;
  svg.style.height = `${size.height}px`;
  svg.style.maxWidth = 'none';

  const state = { scale: 1, x: 0, y: 0, fitScale: 1, fitX: 0, fitY: 0 };
  const apply = () => {
    stage.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  };
  const fit = () => {
    const viewportWidth = Math.max(220, viewport.clientWidth || 640);
    const maxHeight = document.fullscreenElement === figure ? Math.max(240, window.innerHeight - 90) : 620;
    const fitScale = Math.max(0.12, Math.min((viewportWidth - 28) / size.width, (maxHeight - 28) / size.height, 1));
    const viewportHeight = document.fullscreenElement === figure
      ? maxHeight
      : Math.max(160, Math.min(maxHeight, size.height * fitScale + 28));
    viewport.style.height = `${viewportHeight}px`;
    state.scale = fitScale;
    state.x = (viewportWidth - size.width * fitScale) / 2;
    state.y = Math.max(14, (viewportHeight - size.height * fitScale) / 2);
    state.fitScale = state.scale;
    state.fitX = state.x;
    state.fitY = state.y;
    apply();
  };
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const next = Math.min(8, Math.max(0.1, state.scale * factor));
    const rect = viewport.getBoundingClientRect();
    const x = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const y = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    state.x = x - (x - state.x) * (next / state.scale);
    state.y = y - (y - state.y) * (next / state.scale);
    state.scale = next;
    apply();
  };

  controls.append(
    makeTool('缩小图表', ZoomOut, 'out', cleanups).button,
    makeTool('放大图表', ZoomIn, 'in', cleanups).button,
    makeTool('适应画布', Scan, 'fit', cleanups).button,
    makeTool('全屏查看', Maximize2, 'fullscreen', cleanups).button,
  );

  listen(controls, 'click', ((event: MouseEvent) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-diagram-action]')?.dataset.diagramAction;
    if (action === 'out') zoomAt(1 / 1.25);
    if (action === 'in') zoomAt(1.25);
    if (action === 'fit') fit();
    if (action === 'fullscreen') {
      if (document.fullscreenElement === figure) void document.exitFullscreen?.();
      else void figure.requestFullscreen?.();
    }
  }) as EventListener, cleanups);

  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;
  listen(viewport, 'pointerdown', ((event: PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    viewport.classList.add('mermaid-figure__viewport--dragging');
    viewport.setPointerCapture(event.pointerId);
  }) as EventListener, cleanups);
  listen(viewport, 'pointermove', ((event: PointerEvent) => {
    if (!dragging) return;
    state.x += event.clientX - pointerX;
    state.y += event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    apply();
  }) as EventListener, cleanups);
  const stopDragging = ((event: PointerEvent) => {
    dragging = false;
    viewport.classList.remove('mermaid-figure__viewport--dragging');
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }) as EventListener;
  listen(viewport, 'pointerup', stopDragging, cleanups);
  listen(viewport, 'pointercancel', stopDragging, cleanups);
  listen(viewport, 'wheel', ((event: WheelEvent) => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
  }) as EventListener, cleanups, { passive: false });
  listen(document, 'fullscreenchange', (() => {
    if (document.fullscreenElement === figure || !document.fullscreenElement) window.requestAnimationFrame(fit);
  }) as EventListener, cleanups);

  const observer = new ResizeObserver(() => window.requestAnimationFrame(fit));
  observer.observe(viewport);
  cleanups.push(() => observer.disconnect());
  window.requestAnimationFrame(fit);
}

function svgToPng(svg: SVGSVGElement): Promise<Blob> {
  const size = dimensions(svg);
  const scale = Math.max(0.2, Math.min(2, 8192 / size.width, 8192 / size.height, Math.sqrt(26_000_000 / (size.width * size.height))));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(size.width));
  clone.setAttribute('height', String(size.height));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  const source = new XMLSerializer().serializeToString(clone);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(size.width * scale));
      canvas.height = Math.max(1, Math.round(size.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('浏览器无法生成图片。'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('浏览器无法生成图片。')), 'image/png');
    };
    image.onerror = () => reject(new Error('图表无法转换为图片。'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });
}

async function copyDiagram(svg: SVGSVGElement, tool: DiagramTool) {
  tool.update('Preparing', LoaderCircle);
  const restore = () => tool.update('Copy image', Copy);
  try {
    const blob = await svgToPng(svg);
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        tool.update('Copied', Check);
        window.setTimeout(restore, 1_400);
        return;
      } catch {
        // A user gesture can still be denied by browser clipboard policy.
      }
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'workbench-diagram.png';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    tool.update('Downloaded', Download);
  } catch {
    tool.update('Failed', X);
  }
  window.setTimeout(restore, 1_400);
}

function mountDiagram(pre: HTMLElement, source: string, svgMarkup: string): Cleanup[] {
  const cleanups: Cleanup[] = [];
  const figure = document.createElement('figure');
  figure.className = 'mermaid-figure';
  figure.dataset.view = 'diagram';

  const header = document.createElement('figcaption');
  header.className = 'mermaid-figure__header';
  const label = document.createElement('span');
  label.textContent = 'Mermaid 图表';
  const actions = document.createElement('span');
  actions.className = 'mermaid-figure__actions';
  const viewTool = makeTool('View source', Code2, 'view-source', cleanups);
  const copyTool = makeTool('Copy image', Copy, 'copy-image', cleanups);
  actions.append(viewTool.button, copyTool.button);
  header.append(label, actions);

  const viewport = document.createElement('div');
  viewport.className = 'mermaid-figure__viewport';
  const stage = document.createElement('div');
  stage.className = 'mermaid-figure__stage';
  stage.innerHTML = String(DOMPurify.sanitize(fixEncodedEntities(svgMarkup), { USE_PROFILES: { svg: true, svgFilters: true } }));
  const svg = stage.querySelector<SVGSVGElement>('svg');
  const controls = document.createElement('div');
  controls.className = 'mermaid-figure__controls';
  viewport.append(stage, controls);

  const sourcePre = document.createElement('pre');
  sourcePre.className = 'mermaid-figure__source';
  const sourceCode = document.createElement('code');
  sourceCode.className = 'language-mermaid';
  sourceCode.textContent = source;
  sourcePre.append(sourceCode);
  figure.append(header, viewport, sourcePre);
  pre.replaceWith(figure);

  listen(viewTool.button, 'click', (() => {
    const showingDiagram = figure.dataset.view === 'diagram';
    figure.dataset.view = showingDiagram ? 'source' : 'diagram';
    viewTool.update(showingDiagram ? 'View image' : 'View source', showingDiagram ? ImageIcon : Code2);
  }) as EventListener, cleanups);
  if (svg) {
    installPanZoom(figure, viewport, stage, svg, controls, cleanups);
    listen(copyTool.button, 'click', (() => void copyDiagram(svg, copyTool)) as EventListener, cleanups);
  } else {
    viewport.textContent = '图表无法显示，已保留源码。';
    copyTool.button.disabled = true;
  }
  return cleanups;
}

function clearTemporaryNode(id: string) {
  document.getElementById(`d${id}`)?.remove();
  const direct = document.getElementById(id);
  if (direct?.parentElement === document.body) direct.remove();
}

function queuedRender(id: string, source: string) {
  const render = () => mermaid.render(id, source);
  const result = renderQueue.then(render, render);
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function enhanceMermaidDiagrams(body: HTMLElement, signal?: AbortSignal): Promise<Cleanup[]> {
  const dark = document.documentElement.dataset.theme === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: false },
    theme: dark ? 'dark' : 'default',
  });

  const cleanups: Cleanup[] = [];
  const blocks = [...body.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) continue;
    const source = code.textContent ?? '';
    const id = `workbench-mermaid-${nanoid(8)}`;
    try {
      const result = await queuedRender(id, prepareMermaidSource(source));
      if (signal?.aborted || !pre.isConnected) continue;
      cleanups.push(...mountDiagram(pre, source, result.svg));
    } catch (error) {
      if (!signal?.aborted && pre.isConnected) {
        pre.dataset.renderError = error instanceof Error ? `图表无法渲染：${error.message}` : '图表无法渲染，已保留源码。';
      }
    } finally {
      clearTemporaryNode(id);
    }
  }
  return cleanups;
}
