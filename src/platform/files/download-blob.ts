export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadText(content: string, fileName: string, type = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([content], { type }), fileName);
}
