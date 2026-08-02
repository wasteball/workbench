import DOMPurify from 'dompurify';

import type {
  ExportAppearance,
  MarkdownExporter,
} from '@/features/markdown/exporters/contract';
import { safeFileName } from '@/features/markdown/exporters/file-name';
import { renderMermaidSvg } from '@/features/markdown/engine/mermaid-renderer';
import { renderMarkdown } from '@/features/markdown/engine/render-markdown';

const DOCUMENT_STYLES = `
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--font-document);font-size:var(--reading-font-size);line-height:1.78}
main{width:min(var(--reading-width),100%);margin:0 auto;padding:56px clamp(28px,6vw,72px) 90px;overflow-wrap:anywhere}h1,h2,h3,h4{color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0;line-height:1.3}h1{border-bottom:1px solid var(--border);padding-bottom:14px;font-size:32px}h2{margin-top:42px;font-size:24px}h3{margin-top:30px;font-size:19px}a{color:var(--primary)}img,svg{max-width:100%;height:auto}blockquote{border-left:3px solid var(--primary);padding-left:18px;color:var(--ink-secondary)}details{margin:1.2em 0;overflow:hidden;border:1px solid var(--border);border-radius:7px;padding:0 .95em;background:color-mix(in srgb,var(--primary) 4%,var(--canvas))}details>summary{padding:.72em 0;cursor:pointer;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:650}details[open]>summary{margin-bottom:.85em;border-bottom:1px solid var(--border)}details>:last-child{margin-bottom:.85em}pre{overflow:auto;border:1px solid var(--border);border-radius:7px;padding:18px;background:var(--code-canvas);color:var(--code-ink);font:13px/1.6 "SFMono-Regular",Consolas,monospace}:not(pre)>code{border:1px solid var(--border);border-radius:4px;padding:2px 5px;background:var(--soft)}.markdown-block:has(>table){max-width:100%;overflow-x:auto}table{width:100%;min-width:520px;border-collapse:collapse;table-layout:fixed;background:var(--canvas);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px}th,td{min-width:0;border:1px solid var(--border);padding:8px 11px;text-align:left;overflow-wrap:anywhere}th{background:var(--soft)}.mermaid-export{display:grid;place-items:center;overflow:hidden;margin:22px 0;border:1px solid var(--border);border-radius:7px;padding:20px;background:var(--diagram-canvas)}.mermaid-export svg{display:block;width:100%;max-height:760px}
@media(max-width:640px){main{padding:34px 20px 70px}h1{font-size:27px}}@page{size:A4 portrait;margin:14mm 13mm 16mm}@media print{:root{color-scheme:light;--ink:#0d253d;--ink-secondary:#31445a;--muted:#64748d;--border:#e3e8ee;--soft:#f6f9fc;--canvas:#fff;--code-canvas:#142131;--code-ink:#dbe6ef}body{background:#fff}main{width:100%;max-width:none;padding:0}.mermaid-export,table,blockquote,pre{break-inside:avoid}.markdown-block:has(>table){overflow:visible}table{min-width:0!important;table-layout:fixed;font-size:9pt}th,td{min-width:0;padding:5px 7px}.mermaid-export svg{max-height:230mm}}
`;

interface ExportPalette {
  ink: string;
  inkSecondary: string;
  muted: string;
  border: string;
  soft: string;
  canvas: string;
  codeCanvas: string;
  codeInk: string;
}

const LIGHT_PALETTE: ExportPalette = {
  ink: '#0d253d',
  inkSecondary: '#31445a',
  muted: '#64748d',
  border: '#e3e8ee',
  soft: '#f6f9fc',
  canvas: '#ffffff',
  codeCanvas: '#142131',
  codeInk: '#dbe6ef',
};

const DARK_PALETTE: ExportPalette = {
  ink: '#edf3f8',
  inkSecondary: '#c5d0db',
  muted: '#92a2b3',
  border: '#2c3846',
  soft: '#181f29',
  canvas: '#121821',
  codeCanvas: '#0b1118',
  codeInk: '#dbe6ef',
};

const ACCENT_COLORS: Record<ExportAppearance['accentColor'], { light: string; dark: string }> = {
  indigo: { light: '#533afd', dark: '#8b7cff' },
  amber: { light: '#a55d00', dark: '#f0b429' },
  blue: { light: '#1769aa', dark: '#72b7f2' },
  green: { light: '#14765a', dark: '#57c8a9' },
  pink: { light: '#b83272', dark: '#f08ab8' },
  cyan: { light: '#087d89', dark: '#58cbd2' },
};

const FONT_STACKS: Record<ExportAppearance['readingFont'], string> = {
  serif: 'Charter,"Source Han Serif SC","Songti SC",Georgia,serif',
  sans: 'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
};

const DEFAULT_EXPORT_APPEARANCE: ExportAppearance = {
  theme: 'light',
  accentColor: 'indigo',
  readingFont: 'serif',
  readingFontSize: 16,
  readingWidth: 860,
};

function normalizedAppearance(value: ExportAppearance | undefined): ExportAppearance {
  const appearance = value ?? DEFAULT_EXPORT_APPEARANCE;
  return {
    theme: appearance.theme === 'dark' || appearance.theme === 'system' ? appearance.theme : 'light',
    accentColor: appearance.accentColor in ACCENT_COLORS ? appearance.accentColor : 'indigo',
    readingFont: appearance.readingFont === 'sans' ? 'sans' : 'serif',
    readingFontSize: Math.min(26, Math.max(14, Math.round(appearance.readingFontSize))),
    readingWidth: Math.min(1200, Math.max(560, Math.round(appearance.readingWidth))),
  };
}

function paletteDeclarations(
  palette: ExportPalette,
  primary: string,
  colorScheme: 'light' | 'dark',
  diagramCanvas = palette.canvas,
): string {
  return `color-scheme:${colorScheme};--ink:${palette.ink};--ink-secondary:${palette.inkSecondary};--muted:${palette.muted};--border:${palette.border};--soft:${palette.soft};--canvas:${palette.canvas};--code-canvas:${palette.codeCanvas};--code-ink:${palette.codeInk};--primary:${primary};--diagram-canvas:${diagramCanvas};`;
}

function appearanceStyles(appearance: ExportAppearance): string {
  const sizing = `--reading-width:${appearance.readingWidth}px;--reading-font-size:${appearance.readingFontSize}px;--font-document:${FONT_STACKS[appearance.readingFont]};`;
  const accents = ACCENT_COLORS[appearance.accentColor];
  const light = paletteDeclarations(LIGHT_PALETTE, accents.light, 'light');
  const dark = paletteDeclarations(DARK_PALETTE, accents.dark, 'dark');
  if (appearance.theme === 'system') {
    const systemDark = paletteDeclarations(DARK_PALETTE, accents.dark, 'dark', LIGHT_PALETTE.canvas);
    return `:root{${sizing}${light}}@media(prefers-color-scheme:dark){:root{${systemDark}}}`;
  }
  return `:root{${sizing}${appearance.theme === 'dark' ? dark : light}}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function renderMermaidBlocks(html: string, theme: ExportAppearance['theme']): Promise<string> {
  const document = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  const main = document.querySelector('main');
  if (!main) return html;
  for (const code of [...main.querySelectorAll<HTMLElement>('pre > code.language-mermaid')]) {
    const pre = code.parentElement;
    if (!pre) continue;
    try {
      const svg = await renderMermaidSvg(code.textContent ?? '', theme === 'dark' ? 'dark' : 'default');
      const figure = document.createElement('figure');
      figure.className = 'mermaid-export';
      figure.innerHTML = svg;
      pre.replaceWith(figure);
    } catch {
      pre.dataset.renderError = 'Mermaid diagram could not be rendered.';
    }
  }
  return String(DOMPurify.sanitize(main.innerHTML, { ADD_ATTR: ['open'], USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true } }));
}

export const htmlExporter: MarkdownExporter = {
  id: 'html',
  name: 'HTML 网页',
  async export({ markdown, title, appearance: requestedAppearance }) {
    const appearance = normalizedAppearance(requestedAppearance);
    const rendered = await renderMarkdown(markdown);
    const content = await renderMermaidBlocks(rendered.html, appearance.theme);
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${`${appearanceStyles(appearance)}${DOCUMENT_STYLES}`.replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body><main>${content}</main></body>
</html>`;
    const mimeType = 'text/html;charset=utf-8';
    return { blob: new Blob([html], { type: mimeType }), fileName: safeFileName(title, 'html'), mimeType };
  },
};
