export const UNCATEGORIZED = '未分类';

export const FILE_KINDS = [
  { id: 'image', label: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif', 'raw'] },
  { id: 'document', label: '文档', extensions: ['doc', 'docx', 'pdf', 'txt', 'md', 'markdown', 'rtf', 'odt', 'pages', 'wps', 'tex', 'epub'] },
  { id: 'sheet', label: '表格', extensions: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers'] },
  { id: 'slide', label: '演示', extensions: ['ppt', 'pptx', 'pps', 'ppsx', 'key', 'odp'] },
  { id: 'video', label: '视频', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', 'mpeg', 'mpg', '3gp', 'ts'] },
  { id: 'audio', label: '音频', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'amr'] },
  { id: 'archive', label: '压缩包', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'z'] },
  { id: 'code', label: '代码', extensions: ['js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'html', 'htm', 'css', 'scss', 'less', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'bat', 'ps1', 'sql', 'vue', 'r', 'lua', 'pl', 'dart'] },
] as const;

export type FileKind = typeof FILE_KINDS[number]['id'] | 'other';

const EXTENSION_KIND = new Map<string, FileKind>(
  FILE_KINDS.flatMap((kind) => kind.extensions.map((extension) => [extension, kind.id] as const)),
);

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  image: '图片',
  document: '文档',
  sheet: '表格',
  slide: '演示',
  video: '视频',
  audio: '音频',
  archive: '压缩包',
  code: '代码',
  other: '其他',
};

export function fileKindForName(name: string): FileKind {
  const cleanName = name.split(/[?#]/, 1)[0] ?? '';
  const extension = cleanName.includes('.') ? cleanName.split('.').at(-1)?.toLocaleLowerCase() : '';
  return extension ? EXTENSION_KIND.get(extension) ?? 'other' : 'other';
}

export function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path;
}

export function topFolder(path: string): string | null {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] ?? null : null;
}

export function normalizeCategoryName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 60);
}
