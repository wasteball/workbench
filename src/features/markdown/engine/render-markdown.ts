import DOMPurify from 'dompurify';
import type { Properties } from 'hast';
import type { Root } from 'mdast';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { applyContentAwareColumnWidths } from '@/features/markdown/engine/table-column-widths';

export interface MarkdownHeading {
  id: string;
  text: string;
  level: number;
}

export interface MarkdownBlock {
  index: number;
  type: string;
  from: number;
  to: number;
  raw: string;
}

export interface MarkdownRenderResult {
  html: string;
  headings: MarkdownHeading[];
  blocks: MarkdownBlock[];
  wordCount: number;
  readingMinutes: number;
}

function remarkAnnotateBlocks() {
  return (tree: Root) => {
    let index = 0;
    for (const node of tree.children) {
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      if (typeof from !== 'number' || typeof to !== 'number') continue;
      node.data ??= {};
      const data = node.data as typeof node.data & { hProperties?: Properties };
      data.hProperties = {
        ...data.hProperties,
        'data-markdown-block': index,
        'data-block-type': node.type,
        'data-source-from': from,
        'data-source-to': to,
      };
      index += 1;
    }
  };
}

const renderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkAnnotateBlocks)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeHighlight, { detect: true })
  .use(rehypeKatex)
  .use(rehypeStringify);

function slugify(value: string, used: Set<string>): string {
  const base = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  used.add(slug);
  return slug;
}

function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?(?:\[[^\]]*\])\([^)]*\)/g, ' ')
    .replace(/[#>*_~|-]/g, ' ');
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const words = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + words;
}

export async function renderMarkdown(markdown: string): Promise<MarkdownRenderResult> {
  const raw = String(await renderer.process(markdown));
  const safe = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target'],
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  });
  const document = new DOMParser().parseFromString(`<main>${safe}</main>`, 'text/html');
  const main = document.querySelector('main');
  if (!main) return { html: '', headings: [], blocks: [], wordCount: 0, readingMinutes: 1 };

  const blocks: MarkdownBlock[] = [];
  const annotations = [...main.querySelectorAll<HTMLElement>('[data-markdown-block]')];
  for (const annotation of annotations) {
    const indexValue = annotation.getAttribute('data-markdown-block');
    const fromValue = annotation.getAttribute('data-source-from');
    const toValue = annotation.getAttribute('data-source-to');
    if (indexValue === null || fromValue === null || toValue === null) continue;
    const index = Number(indexValue);
    const from = Number(fromValue);
    const to = Number(toValue);
    if (!Number.isInteger(index) || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    const type = annotation.getAttribute('data-block-type') || 'paragraph';
    const target = annotation.parentElement?.tagName === 'PRE' ? annotation.parentElement : annotation;
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-block';
    wrapper.dataset.blockIndex = String(index);
    wrapper.dataset.blockType = type;
    wrapper.dataset.sourceFrom = String(from);
    wrapper.dataset.sourceTo = String(to);
    annotation.removeAttribute('data-markdown-block');
    annotation.removeAttribute('data-block-type');
    annotation.removeAttribute('data-source-from');
    annotation.removeAttribute('data-source-to');
    target.replaceWith(wrapper);
    wrapper.append(target);
    blocks.push({ index, type, from, to, raw: markdown.slice(from, to) });
  }

  const headings: MarkdownHeading[] = [];
  const usedSlugs = new Set<string>();
  main.querySelectorAll('h1, h2, h3, h4').forEach((heading) => {
    const text = heading.textContent?.trim() || '未命名章节';
    const level = Number(heading.tagName.slice(1));
    const id = slugify(text, usedSlugs);
    heading.id = id;
    headings.push({ id, text, level });
  });

  main.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const url = link.getAttribute('href') ?? '';
    if (/^https?:/i.test(url)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  });
  main.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    image.loading = 'lazy';
    image.decoding = 'async';
  });
  main.querySelectorAll<HTMLTableElement>('table').forEach(applyContentAwareColumnWidths);

  const wordCount = countWords(markdown);
  return {
    html: main.innerHTML,
    headings,
    blocks,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 350)),
  };
}
