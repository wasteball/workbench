import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { Content, PhrasingContent, Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { MarkdownExporter } from '@/features/markdown/exporters/contract';
import { safeFileName } from '@/features/markdown/exporters/file-name';
import { rasterizeSvgMarkup, renderMermaidSvg } from '@/features/markdown/engine/mermaid-renderer';
import { contentAwareColumnWidths } from '@/features/markdown/engine/table-column-widths';

type TableAlignment = 'left' | 'right' | 'center' | null;

type AnyNode = Content & {
  align?: TableAlignment[];
  checked?: boolean | null;
  children?: AnyNode[];
  depth?: number;
  lang?: string | null;
  ordered?: boolean | null;
  start?: number | null;
  value?: string;
  url?: string;
};

interface DetailsNode {
  type: 'workbenchDetails';
  summary: string;
  children: AnyNode[];
}

type ExportNode = AnyNode | DetailsNode;
type WordBlock = Paragraph | Table;

interface RunStyle {
  bold?: boolean;
  color?: string;
  font?: string;
  italics?: boolean;
  size?: number;
  strike?: boolean;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const PAGE_WIDTH = 11_906;
const PAGE_HEIGHT = 16_838;
const PAGE_MARGIN = 1_134;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const DOCUMENT_FONT = { ascii: 'Aptos', hAnsi: 'Aptos', eastAsia: 'Microsoft YaHei', cs: 'Aptos' } as const;
const CODE_FONT = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: 'Microsoft YaHei', cs: 'Consolas' } as const;

function inlineChildren(nodes: PhrasingContent[] | undefined, style: RunStyle = {}): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      children.push(new TextRun({ text: node.value, ...style }));
    } else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') {
      children.push(...inlineChildren(node.children, {
        ...style,
        bold: style.bold || node.type === 'strong',
        italics: style.italics || node.type === 'emphasis',
        strike: style.strike || node.type === 'delete',
      }));
    } else if (node.type === 'inlineCode') {
      children.push(new TextRun({ text: node.value, font: 'Consolas', shading: { fill: 'F1F3F5' }, color: '9C2F5A', size: 19, ...style }));
    } else if (node.type === 'break') {
      children.push(new TextRun({ text: '', break: 1 }));
    } else if (node.type === 'link') {
      children.push(new ExternalHyperlink({
        link: node.url,
        children: [new TextRun({ text: toString(node), color: '0563C1', underline: {}, ...style })],
      }));
    } else if (node.type === 'image') {
      children.push(new TextRun({ text: node.alt ? `[图片：${node.alt}]` : '[图片]', italics: true, color: '64748D' }));
    } else {
      children.push(new TextRun({ text: toString(node), ...style }));
    }
  }
  return children;
}

function headingLevel(depth = 1): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ][Math.min(5, Math.max(0, depth - 1))] ?? HeadingLevel.HEADING_1;
}

function border(color = 'D7DCE2', size = 4) {
  return { style: BorderStyle.SINGLE, size, color } as const;
}

function htmlText(markup: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
  return parsed.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function tagCount(value: string, tag: string, closing: boolean): number {
  const expression = closing ? new RegExp(`<\\/${tag}\\s*>`, 'gi') : new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  return value.match(expression)?.length ?? 0;
}

function detailsSummary(value: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html');
  return parsed.querySelector('summary')?.textContent?.replace(/\s+/g, ' ').trim() || '补充内容';
}

function groupDetails(nodes: AnyNode[]): ExportNode[] {
  const output: ExportNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const raw = node.type === 'html' ? node.value ?? '' : '';
    const opens = tagCount(raw, 'details', false);
    const closes = tagCount(raw, 'details', true);
    if (opens === 0) {
      if (closes === 0) output.push(node);
      continue;
    }

    const children: AnyNode[] = [];
    let depth = opens - closes;
    while (depth > 0 && index + 1 < nodes.length) {
      index += 1;
      const child = nodes[index];
      if (!child) continue;
      if (child.type === 'html') {
        const childRaw = child.value ?? '';
        const childOpens = tagCount(childRaw, 'details', false);
        const childCloses = tagCount(childRaw, 'details', true);
        depth += childOpens - childCloses;
        if (childOpens > 0 && depth > 0) children.push(child);
        continue;
      }
      children.push(child);
    }
    output.push({ type: 'workbenchDetails', summary: detailsSummary(raw), children });
  }
  return output;
}

function tableAlignment(value: TableAlignment | undefined) {
  if (value === 'center') return AlignmentType.CENTER;
  if (value === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function tableFromNode(node: AnyNode): Table {
  const sourceRows = node.children ?? [];
  const columns = Math.max(1, ...sourceRows.map((row) => row.children?.length ?? 0));
  const columnWidths = contentAwareColumnWidths(sourceRows.map((row) => Array.from(
    { length: columns },
    (_, column) => row.children?.[column] ? toString(row.children[column]) : '',
  )), CONTENT_WIDTH);
  const rows = sourceRows.map((row, rowIndex) => {
    const sourceCells = row.children ?? [];
    const cells = columnWidths.map((width, column) => {
      const cell = sourceCells[column];
      const head = rowIndex === 0;
      return new TableCell({
        children: [new Paragraph({
          alignment: tableAlignment(node.align?.[column]),
          children: cell ? inlineChildren(cell.children as PhrasingContent[] | undefined, head ? { bold: true, color: '27313D', size: 19 } : { size: 19 }) : [new TextRun('')],
          spacing: { after: 0, line: 285 },
        })],
        width: { size: width, type: WidthType.DXA },
        shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1F4' } : undefined,
        margins: { top: 90, bottom: 90, left: 110, right: 110 },
        verticalAlign: VerticalAlign.CENTER,
        borders: { top: border(), bottom: border(), left: border(), right: border() },
      });
    });
    return new TableRow({ children: cells, tableHeader: rowIndex === 0, cantSplit: true });
  });
  return new Table({
    rows,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: { top: border(), bottom: border(), left: border(), right: border(), insideHorizontal: border(), insideVertical: border() },
  });
}

function codeParagraphs(text: string, language = ''): Paragraph[] {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const runs = lines.map((line, index) => new TextRun({
    text: line || ' ',
    break: index > 0 ? 1 : undefined,
    font: CODE_FONT,
    size: 18,
    color: '263238',
    characterSpacing: 0,
  }));
  const output: Paragraph[] = [];
  if (language) output.push(new Paragraph({
    children: [new TextRun({ text: language, bold: true, size: 17, color: '6B7280' })],
    spacing: { before: 100, after: 40 },
    keepNext: true,
  }));
  output.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    autoSpaceEastAsianText: false,
    children: runs,
    spacing: { after: 160, line: 270 },
    keepLines: true,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F4F6' },
    border: { top: border(), bottom: border(), left: border(), right: border() },
    indent: { left: 160, right: 160 },
  }));
  return output;
}

async function mermaidParagraph(source: string): Promise<Paragraph[]> {
  try {
    const svg = await renderMermaidSvg(source);
    const image = await rasterizeSvgMarkup(svg);
    const scale = Math.min(1, 620 / image.width, 760 / image.height);
    const data = await image.blob.arrayBuffer();
    const run = new ImageRun({
      type: 'png',
      data,
      transformation: {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
      },
      altText: { title: 'Mermaid diagram', description: 'Mermaid diagram', name: 'Mermaid diagram' },
    });
    return [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run],
      spacing: { before: 100, after: 180 },
      keepLines: true,
    })];
  } catch {
    return codeParagraphs(source, 'Mermaid 图表（无法生成图片，已保留源码）');
  }
}

async function detailsTable(node: DetailsNode): Promise<Table> {
  const body = await blocks(node.children);
  const outer = border('C9D2DC');
  const headerCell = new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: node.summary, bold: true, color: '27313D', size: 21 })],
      spacing: { after: 0, line: 300 },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1F4' },
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    borders: { top: outer, bottom: outer, left: outer, right: outer },
  });
  const bodyCell = new TableCell({
    children: body.length > 0 ? body : [new Paragraph({ children: [new TextRun('')] })],
    margins: { top: 140, bottom: 100, left: 160, right: 160 },
    borders: { top: outer, bottom: outer, left: outer, right: outer },
  });
  return new Table({
    rows: [
      new TableRow({ children: [headerCell], cantSplit: true }),
      new TableRow({ children: [bodyCell] }),
    ],
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    layout: TableLayoutType.FIXED,
  });
}

async function blocks(nodes: AnyNode[], listLevel = 0, ordered = false): Promise<WordBlock[]> {
  const output: WordBlock[] = [];
  for (const node of groupDetails(nodes)) {
    if (node.type === 'workbenchDetails') {
      output.push(await detailsTable(node));
    } else if (node.type === 'heading') {
      const depth = node.depth ?? 1;
      const sizes = [36, 32, 28, 25, 23, 22];
      output.push(new Paragraph({
        heading: headingLevel(depth),
        children: inlineChildren(node.children as PhrasingContent[] | undefined, { bold: true, color: depth === 1 ? '0D253D' : '202833', size: sizes[Math.min(5, depth - 1)] }),
        spacing: { before: depth === 1 ? 180 : 220, after: depth === 1 ? 160 : 100, line: 300 },
        keepNext: true,
      }));
    } else if (node.type === 'paragraph') {
      output.push(new Paragraph({ children: inlineChildren(node.children as PhrasingContent[] | undefined), spacing: { after: 120, line: 320 } }));
    } else if (node.type === 'blockquote') {
      output.push(new Paragraph({
        children: [new TextRun({ text: toString(node), italics: true, color: '57606A' })],
        indent: { left: 360, right: 180 },
        border: { left: border('B7C0CA', 12) },
        spacing: { before: 45, after: 90, line: 310 },
      }));
    } else if (node.type === 'list') {
      output.push(...await blocks(node.children ?? [], listLevel, Boolean(node.ordered)));
    } else if (node.type === 'listItem') {
      const nested = (node.children ?? []).filter((child) => child.type === 'list');
      const direct = (node.children ?? []).filter((child) => child.type !== 'list');
      const text = direct.map((child) => toString(child)).join(' ').trim();
      const checkbox = node.checked === true ? '☒ ' : node.checked === false ? '☐ ' : '';
      output.push(new Paragraph(ordered ? {
        text: `${checkbox}${text}`,
        numbering: { reference: 'workbench-numbering', level: Math.min(8, listLevel) },
        spacing: { after: 45, line: 300 },
      } : {
        text: `${checkbox}${text}`,
        bullet: { level: Math.min(8, listLevel) },
        spacing: { after: 45, line: 300 },
      }));
      for (const child of nested) output.push(...await blocks([child as AnyNode], listLevel + 1, Boolean(child.ordered)));
    } else if (node.type === 'code') {
      output.push(...(node.lang?.toLocaleLowerCase() === 'mermaid'
        ? await mermaidParagraph(node.value ?? '')
        : codeParagraphs(node.value ?? '', node.lang ?? '')));
    } else if (node.type === 'table') {
      output.push(tableFromNode(node));
    } else if (node.type === 'thematicBreak') {
      output.push(new Paragraph({ border: { bottom: border('C9CED6', 6) }, spacing: { before: 150, after: 160 } }));
    } else if (node.type === 'math') {
      output.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: node.value ?? '', font: 'Cambria Math', italics: true, size: 22 })],
        spacing: { before: 100, after: 160 },
        keepLines: true,
      }));
    } else if (node.type === 'html') {
      const text = htmlText(node.value ?? '');
      if (text) output.push(new Paragraph({ children: [new TextRun(text)], spacing: { after: 120, line: 320 } }));
    }
  }
  return output;
}

export const docxExporter: MarkdownExporter = {
  id: 'docx',
  name: 'Word 文档',
  async export({ markdown, title }) {
    const tree = parser.parse(markdown) as Root;
    const children = await blocks(tree.children as AnyNode[]);
    const document = new Document({
      creator: 'Workbench',
      title,
      description: 'Exported from Workbench',
      numbering: {
        config: [{
          reference: 'workbench-numbering',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: 'decimal',
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        }],
      },
      sections: [{
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
          },
        },
        children,
      }],
      styles: {
        default: {
          document: {
            run: { font: DOCUMENT_FONT, size: 22, color: '202833' },
            paragraph: { spacing: { line: 320, after: 120 } },
          },
        },
      },
    });
    const blob = await Packer.toBlob(document);
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return { blob, fileName: safeFileName(title, 'docx'), mimeType };
  },
};
