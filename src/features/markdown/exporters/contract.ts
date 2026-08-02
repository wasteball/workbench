import type { AccentColor, ReadingFont, ThemePreference } from '@/shared/types';

export type ExportFormat = 'markdown' | 'html' | 'docx';

export interface ExportAppearance {
  theme: ThemePreference;
  accentColor: AccentColor;
  readingFont: ReadingFont;
  readingFontSize: number;
  readingWidth: number;
}

export interface ExportInput {
  markdown: string;
  title: string;
  appearance?: ExportAppearance;
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
