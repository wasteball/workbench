import { describe, expect, it } from 'vitest';

import { docxExporter } from '@/features/markdown/exporters/docx-exporter';
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
});
