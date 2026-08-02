import type { ExportFormat, MarkdownExporter } from '@/features/markdown/exporters/contract';

const loaders: Record<ExportFormat, () => Promise<MarkdownExporter>> = {
  markdown: async () => (await import('@/features/markdown/exporters/markdown-exporter')).markdownExporter,
  html: async () => (await import('@/features/markdown/exporters/html-exporter')).htmlExporter,
  docx: async () => (await import('@/features/markdown/exporters/docx-exporter')).docxExporter,
};

export async function getExporter(format: ExportFormat): Promise<MarkdownExporter> {
  const loader = loaders[format];
  if (!loader) throw new Error(`Unsupported export format: ${format}`);
  return loader();
}

export async function listExporters(): Promise<MarkdownExporter[]> {
  return Promise.all(Object.values(loaders).map((load) => load()));
}
