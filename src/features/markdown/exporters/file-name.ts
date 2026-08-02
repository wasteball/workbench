export function safeFileName(value: string, extension: string): string {
  const base = [...value]
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'document';
  return `${base}.${extension}`;
}
