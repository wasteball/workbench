import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { nanoid } from 'nanoid';

import type { MarkdownExporter } from '@/features/markdown/exporters/contract';
import { safeFileName } from '@/features/markdown/exporters/file-name';
import { renderMarkdown } from '@/features/markdown/engine/render-markdown';

const DOCUMENT_STYLES = `
:root{color-scheme:light;--ink:#0d253d;--muted:#64748d;--border:#e3e8ee;--soft:#f6f9fc;--primary:#533afd}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Charter,"Source Han Serif SC","Songti SC",Georgia,serif;font-size:16px;line-height:1.78}
main{width:min(820px,100%);margin:0 auto;padding:56px 44px 90px;overflow-wrap:anywhere}h1,h2,h3,h4{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0;line-height:1.3}h1{border-bottom:1px solid var(--border);padding-bottom:14px;font-size:32px}h2{margin-top:42px;font-size:24px}h3{margin-top:30px;font-size:19px}a{color:var(--primary)}img,svg{max-width:100%;height:auto}blockquote{border-left:3px solid var(--primary);padding-left:18px;color:#31445a}pre{overflow:auto;border:1px solid var(--border);border-radius:7px;padding:18px;background:#142131;color:#dbe6ef;font:13px/1.6 "SFMono-Regular",Consolas,monospace}:not(pre)>code{border:1px solid var(--border);border-radius:4px;padding:2px 5px;background:var(--soft)}table{display:block;width:100%;overflow-x:auto;border-collapse:collapse;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px}th,td{border:1px solid var(--border);padding:8px 11px;text-align:left}th{background:var(--soft)}.mermaid-export{display:grid;place-items:center;overflow:auto;border-block:1px solid var(--border);padding:20px 0}
@media(max-width:640px){main{padding:34px 20px 70px;font-size:15px}h1{font-size:27px}}@media print{main{width:100%;max-width:none;padding:0}}
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function renderMermaidBlocks(html: string): Promise<string> {
  const document = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  const main = document.querySelector('main');
  if (!main) return html;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'default' });
  for (const code of [...main.querySelectorAll<HTMLElement>('pre > code.language-mermaid')]) {
    const pre = code.parentElement;
    if (!pre) continue;
    try {
      const { svg } = await mermaid.render(`workbench-export-${nanoid(8)}`, code.textContent ?? '');
      const figure = document.createElement('figure');
      figure.className = 'mermaid-export';
      figure.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      pre.replaceWith(figure);
    } catch {
      pre.dataset.renderError = 'Mermaid diagram could not be rendered.';
    }
  }
  return DOMPurify.sanitize(main.innerHTML, { USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true } });
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
