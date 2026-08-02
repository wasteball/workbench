import { describe, expect, it } from 'vitest';

import { docxExporter } from '@/features/markdown/exporters/docx-exporter';
import { htmlExporter } from '@/features/markdown/exporters/html-exporter';
import { markdownExporter } from '@/features/markdown/exporters/markdown-exporter';

describe('Markdown exporters', () => {
  it('sanitizes download file names', async () => {
    const result = await markdownExporter.export({ markdown: '# Test', title: 'bad/name:*?' });
    expect(result.fileName).toBe('bad-name---.md');
    expect(await result.blob.text()).toBe('# Test');
  });

  it('creates a non-empty editable Word document', async () => {
    const result = await docxExporter.export({ markdown: '# Report\n\n- One\n- Two\n\n| A | B |\n| - | - |\n| 1 | 2 |', title: 'Report' });
    expect(result.fileName).toBe('Report.docx');
    expect(result.blob.size).toBeGreaterThan(1_000);
  });

  it('keeps the current reading appearance in exported HTML', async () => {
    const result = await htmlExporter.export({
      markdown: '# Report\n\nReadable content.',
      title: 'Report',
      appearance: {
        theme: 'dark',
        accentColor: 'amber',
        readingFont: 'sans',
        readingFontSize: 21,
        readingWidth: 1040,
      },
    });
    const html = await result.blob.text();

    expect(html).toContain('--reading-width:1040px');
    expect(html).toContain('--reading-font-size:21px');
    expect(html).toContain('--font-document:Inter');
    expect(html).toContain('color-scheme:dark');
    expect(html).toContain('--primary:#f0b429');
    expect(html).toContain('width:min(var(--reading-width),100%)');
  });
});
