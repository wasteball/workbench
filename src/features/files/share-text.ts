import type { ShareRecord } from '@/shared/persistence/database';
import type { ShareCopyFormat } from '@/shared/types';

export function formatShareText(record: Pick<ShareRecord, 'displayName' | 'url'>, format: ShareCopyFormat): string {
  if (format === 'markdown') return `[${record.displayName}](${record.url})`;
  if (format === 'single-line') return `${record.displayName} - ${record.url}`;
  if (format === 'link-only') return record.url;
  return `${record.displayName}\n${record.url}`;
}

export function formatShareRecords(
  records: Array<Pick<ShareRecord, 'displayName' | 'url'>>,
  format: ShareCopyFormat,
): string {
  const separator = format === 'name-and-link' ? '\n\n' : '\n';
  return records.map((record) => formatShareText(record, format)).join(separator);
}
