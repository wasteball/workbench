import type { MarkdownExporter } from '@/features/markdown/exporters/contract';
import { safeFileName } from '@/features/markdown/exporters/file-name';

export const markdownExporter: MarkdownExporter = {
  id: 'markdown',
  name: 'Markdown',
  async export({ markdown, title }) {
    const mimeType = 'text/markdown;charset=utf-8';
    return {
      blob: new Blob([markdown], { type: mimeType }),
      fileName: safeFileName(title, 'md'),
      mimeType,
    };
  },
};
