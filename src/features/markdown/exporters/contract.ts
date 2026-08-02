export type ExportFormat = 'markdown' | 'html' | 'docx';

export interface ExportInput {
  markdown: string;
  title: string;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

export interface MarkdownExporter {
  id: ExportFormat;
  name: string;
  export(input: ExportInput): Promise<ExportResult>;
}
