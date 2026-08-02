import DOMPurify from 'dompurify';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

export interface MarkdownHeading {
  id: string;
  text: string;
  level: number;
}

export interface MarkdownRenderResult {
  html: string;
  headings: MarkdownHeading[];
  wordCount: number;
  readingMinutes: number;
}

const renderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
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
  if (!main) return { html: '', headings: [], wordCount: 0, readingMinutes: 1 };

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

  const wordCount = countWords(markdown);
  return {
    html: main.innerHTML,
    headings,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 350)),
  };
}
