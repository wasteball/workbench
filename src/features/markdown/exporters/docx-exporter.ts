import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
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

type AnyNode = Content & {
  children?: AnyNode[];
  depth?: number;
  lang?: string | null;
  value?: string;
  url?: string;
  ordered?: boolean | null;
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function inlineChildren(nodes: PhrasingContent[] | undefined, style: { bold?: boolean; italics?: boolean; strike?: boolean } = {}): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      children.push(new TextRun({ text: node.value, ...style }));
    } else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') {
      children.push(...inlineChildren(node.children, { ...style, bold: style.bold || node.type === 'strong', italics: style.italics || node.type === 'emphasis', strike: style.strike || node.type === 'delete' }));
    } else if (node.type === 'inlineCode') {
      children.push(new TextRun({ text: node.value, font: 'Consolas', shading: { fill: 'F1F5F9' }, ...style }));
    } else if (node.type === 'break') {
      children.push(new TextRun({ text: '', break: 1 }));
    } else if (node.type === 'link') {
      children.push(new ExternalHyperlink({ link: node.url, children: [new TextRun({ text: toString(node), color: '533AFD', underline: {}, ...style })] }));
    } else if (node.type === 'image') {
      children.push(new TextRun({ text: `[图片：${node.alt || node.url}]`, italics: true, color: '64748D' }));
    } else {
      children.push(new TextRun({ text: toString(node), ...style }));
    }
  }
  return children;
}

function headingLevel(depth = 1): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(5, Math.max(0, depth - 1))] ?? HeadingLevel.HEADING_1;
}

function tableFromNode(node: AnyNode): Table {
  const rows = (node.children ?? []).map((row) => new TableRow({
    children: (row.children ?? []).map((cell) => new TableCell({
      children: [new Paragraph({ children: inlineChildren(cell.children as PhrasingContent[] | undefined) })],
    })),
  }));
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function blocks(nodes: AnyNode[], listLevel = 0, ordered = false): Array<Paragraph | Table> {
  const output: Array<Paragraph | Table> = [];
  for (const node of nodes) {
    if (node.type === 'heading') {
      output.push(new Paragraph({ heading: headingLevel(node.depth), children: inlineChildren(node.children as PhrasingContent[] | undefined) }));
    } else if (node.type === 'paragraph') {
      output.push(new Paragraph({ children: inlineChildren(node.children as PhrasingContent[] | undefined) }));
    } else if (node.type === 'blockquote') {
      for (const child of blocks(node.children ?? [])) {
        if (child instanceof Paragraph) {
          output.push(new Paragraph({ children: [new TextRun({ text: toString(node), italics: true, color: '31445A' })], indent: { left: 420 }, border: { left: { style: BorderStyle.SINGLE, color: '533AFD', size: 12, space: 8 } } }));
          break;
        }
      }
    } else if (node.type === 'list') {
      output.push(...blocks(node.children ?? [], listLevel, Boolean(node.ordered)));
    } else if (node.type === 'listItem') {
      const text = toString(node);
      output.push(new Paragraph(ordered ? { text, numbering: { reference: 'workbench-numbering', level: listLevel } } : { text, bullet: { level: listLevel } }));
      const nested = (node.children ?? []).filter((child) => child.type === 'list');
      for (const child of nested) output.push(...blocks([child], listLevel + 1, Boolean(child.ordered)));
    } else if (node.type === 'code') {
      const label = node.lang === 'mermaid' ? 'Mermaid 图表源码\n' : '';
      output.push(new Paragraph({ children: [new TextRun({ text: `${label}${node.value ?? ''}`, font: 'Consolas', size: 19, color: 'DCE7F1' })], shading: { fill: '142131' }, spacing: { before: 160, after: 160 } }));
    } else if (node.type === 'table') {
      output.push(tableFromNode(node));
    } else if (node.type === 'thematicBreak') {
      output.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: 'E3E8EE', size: 6, space: 8 } } }));
    } else if (node.type === 'html' || node.type === 'math') {
      output.push(new Paragraph({ children: [new TextRun({ text: node.value ?? toString(node), font: node.type === 'math' ? 'Cambria Math' : undefined })] }));
    }
  }
  return output;
}

export const docxExporter: MarkdownExporter = {
  id: 'docx',
  name: 'Word 文档',
  async export({ markdown, title }) {
    const tree = parser.parse(markdown) as Root;
    const document = new Document({
      creator: 'Workbench',
      title,
      description: 'Exported from Workbench',
      numbering: {
        config: [{ reference: 'workbench-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'start', style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }],
      },
      sections: [{ properties: {}, children: blocks(tree.children as AnyNode[]) }],
      styles: {
        default: { document: { run: { font: 'Aptos', size: 22, color: '0D253D' }, paragraph: { spacing: { line: 330, after: 120 } } } },
      },
    });
    const blob = await Packer.toBlob(document);
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return { blob, fileName: safeFileName(title, 'docx'), mimeType };
  },
};
