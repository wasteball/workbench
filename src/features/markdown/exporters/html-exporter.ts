import DOMPurify from 'dompurify';

import type { MarkdownExporter } from '@/features/markdown/exporters/contract';
import { safeFileName } from '@/features/markdown/exporters/file-name';
import { renderMermaidSvg } from '@/features/markdown/engine/mermaid-renderer';
import { renderMarkdown } from '@/features/markdown/engine/render-markdown';

const DOCUMENT_STYLES = `
:root{color-scheme:light;--ink:#0d253d;--muted:#64748d;--border:#e3e8ee;--soft:#f6f9fc;--primary:#533afd}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Charter,"Source Han Serif SC","Songti SC",Georgia,serif;font-size:16px;line-height:1.78}
main{width:min(860px,100%);margin:0 auto;padding:56px 44px 90px;overflow-wrap:anywhere}h1,h2,h3,h4{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0;line-height:1.3}h1{border-bottom:1px solid var(--border);padding-bottom:14px;font-size:32px}h2{margin-top:42px;font-size:24px}h3{margin-top:30px;font-size:19px}a{color:var(--primary)}img,svg{max-width:100%;height:auto}blockquote{border-left:3px solid var(--primary);padding-left:18px;color:#31445a}details{margin:1.2em 0;overflow:hidden;border:1px solid var(--border);border-radius:7px;padding:0 .95em;background:color-mix(in srgb,var(--primary) 4%,#fff)}details>summary{padding:.72em 0;cursor:pointer;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:650}details[open]>summary{margin-bottom:.85em;border-bottom:1px solid var(--border)}details>:last-child{margin-bottom:.85em}pre{overflow:auto;border:1px solid var(--border);border-radius:7px;padding:18px;background:#142131;color:#dbe6ef;font:13px/1.6 "SFMono-Regular",Consolas,monospace}:not(pre)>code{border:1px solid var(--border);border-radius:4px;padding:2px 5px;background:var(--soft)}.markdown-block:has(>table){max-width:100%;overflow-x:auto}table{width:100%;min-width:520px;border-collapse:collapse;table-layout:fixed;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px}th,td{min-width:0;border:1px solid var(--border);padding:8px 11px;text-align:left;overflow-wrap:anywhere}th{background:var(--soft)}.mermaid-export{display:grid;place-items:center;overflow:hidden;margin:22px 0;border:1px solid var(--border);border-radius:7px;padding:20px;background:#fff}.mermaid-export svg{display:block;width:100%;max-height:760px}
@media(max-width:640px){main{padding:34px 20px 70px;font-size:15px}h1{font-size:27px}}@page{size:A4 portrait;margin:14mm 13mm 16mm}@media print{main{width:100%;max-width:none;padding:0}.mermaid-export,table,blockquote,pre{break-inside:avoid}.markdown-block:has(>table){overflow:visible}table{min-width:0!important;table-layout:fixed;font-size:9pt}th,td{min-width:0;padding:5px 7px}.mermaid-export svg{max-height:230mm}}
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function renderMermaidBlocks(html: string): Promise<string> {
  const document = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  const main = document.querySelector('main');
  if (!main) return html;
  for (const code of [...main.querySelectorAll<HTMLElement>('pre > code.language-mermaid')]) {
    const pre = code.parentElement;
    if (!pre) continue;
    try {
      const svg = await renderMermaidSvg(code.textContent ?? '');
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
  async export({ markdown, title }) {
    const rendered = await renderMarkdown(markdown);
    const content = await renderMermaidBlocks(rendered.html);
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOCUMENT_STYLES.replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body><main>${content}</main></body>
</html>`;
    const mimeType = 'text/html;charset=utf-8';
    return { blob: new Blob([html], { type: mimeType }), fileName: safeFileName(title, 'html'), mimeType };
  },
};
