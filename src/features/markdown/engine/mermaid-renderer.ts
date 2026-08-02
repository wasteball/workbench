import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { nanoid } from 'nanoid';

export type MermaidTheme = 'default' | 'dark';

export interface SvgDimensions {
  width: number;
  height: number;
}

export interface RasterizedSvg extends SvgDimensions {
  blob: Blob;
}

let renderQueue: Promise<unknown> = Promise.resolve();

function fixEncodedEntities(svg: string): string {
  return svg.replace(/&amp;(gt|lt|amp|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, '&$1;');
}

function quoteQuadrantText(raw: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  const value = match?.[2] ?? raw;
  if (!Array.from(value).some((character) => character.charCodeAt(0) > 0x7f) || /^"[\s\S]*"$/.test(value)) return raw;
  return `${match?.[1] ?? ''}"${value.replace(/"/g, '#34;')}"${match?.[3] ?? ''}`;
}

export function prepareMermaidSource(source: string): string {
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

function clearTemporaryNode(id: string) {
  document.getElementById(`d${id}`)?.remove();
  const direct = document.getElementById(id);
  if (direct?.parentElement === document.body) direct.remove();
}

export async function renderMermaidSvg(source: string, theme: MermaidTheme = 'default'): Promise<string> {
  const id = `workbench-mermaid-${nanoid(8)}`;
  const render = async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: false },
      theme,
    });
    try {
      const result = await mermaid.render(id, prepareMermaidSource(source));
      return String(DOMPurify.sanitize(fixEncodedEntities(result.svg), { USE_PROFILES: { svg: true, svgFilters: true } }));
    } finally {
      clearTemporaryNode(id);
    }
  };
  const result = renderQueue.then(render, render);
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

function numericDimension(value: string | null): number {
  if (!value || value.endsWith('%')) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function svgDimensions(svg: SVGSVGElement): SvgDimensions {
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3]) && viewBox[2]! > 0 && viewBox[3]! > 0) {
    return { width: viewBox[2]!, height: viewBox[3]! };
  }
  const width = numericDimension(svg.getAttribute('width'));
  const height = numericDimension(svg.getAttribute('height'));
  if (width && height) return { width, height };
  try {
    const box = svg.getBBox();
    if (box.width && box.height) return { width: box.width, height: box.height };
  } catch {
    // Detached SVG elements do not always expose a bounding box.
  }
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 640, height: rect.height || 360 };
}

export async function rasterizeSvgMarkup(markup: string): Promise<RasterizedSvg> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = String(DOMPurify.sanitize(markup, { USE_PROFILES: { svg: true, svgFilters: true } }));
  const svg = host.querySelector<SVGSVGElement>('svg');
  if (!svg) throw new Error('图表没有生成可用的 SVG。');
  document.body.append(host);
  const size = svgDimensions(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  host.remove();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(size.width));
  clone.setAttribute('height', String(size.height));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const serialized = new XMLSerializer().serializeToString(clone);
  const sourceBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(sourceBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error('图表无法转换为图片。'));
      value.src = sourceUrl;
    });
    const scale = Math.max(0.2, Math.min(2, 8192 / size.width, 8192 / size.height, Math.sqrt(26_000_000 / (size.width * size.height))));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.width * scale));
    canvas.height = Math.max(1, Math.round(size.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法生成图表图片。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('浏览器无法生成图表图片。')), 'image/png');
    });
    return { blob, width: size.width, height: size.height };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
