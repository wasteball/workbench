import { ensureWebsitePermission } from '@/platform/permissions/website-permission';
import { downloadBlob } from '@/platform/files/download-blob';

const WRAPPED_URL_PARAMETERS = ['file_path', 'filepath', 'url', 'fileUrl', 'target', 'src'];

function fixMojibake(value: string): string {
  if (!/[\u0080-\u00ff]/.test(value) || /[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return decoded && !decoded.includes('\ufffd') ? decoded : value;
  } catch {
    return value;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveDownloadUrl(value: string): string {
  const raw = value.trim();
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 http 或 https 下载地址。');
  for (const parameter of WRAPPED_URL_PARAMETERS) {
    const candidate = parsed.searchParams.get(parameter);
    if (!candidate) continue;
    try {
      const nested = new URL(candidate);
      if (['http:', 'https:'].includes(nested.protocol)) return nested.toString();
    } catch {
      // Keep checking other supported wrapper parameters.
    }
  }
  return parsed.toString();
}

export function filenameFromContentDisposition(value: string | null): string {
  if (!value) return '';
  const encoded = value.match(/filename\*\s*=\s*([\w-]+)?'[^']*'([^;]+)/i);
  if (encoded?.[2]) return fixMojibake(safeDecode(encoded[2].trim().replace(/^["']|["']$/g, '')));
  const plain = value.match(/filename\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]+))/i);
  const candidate = (plain?.[1] ?? plain?.[2] ?? plain?.[3] ?? '').trim();
  return fixMojibake(/%[0-9a-f]{2}/i.test(candidate) ? safeDecode(candidate) : candidate);
}

export function filenameFromUrl(value: string): string {
  const parsed = new URL(value);
  const candidate = parsed.pathname.split('/').filter(Boolean).at(-1) ?? 'download';
  return fixMojibake(safeDecode(candidate)) || 'download';
}

export function safeDownloadFilename(value: string): string {
  const leaf = value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? 'download';
  const clean = [...leaf]
    .map((character) => character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character) ? '_' : character)
    .join('');
  return clean.replace(/[. ]+$/g, '').trim() || 'download';
}

function downloadError(status: number): Error {
  if (status === 401 || status === 403) return new Error('链接已失效或没有下载权限，请重新获取链接。');
  if (status === 404) return new Error('文件不存在，或链接已经失效。');
  return new Error(`文件下载失败（HTTP ${status}）。`);
}

export async function isObjectStorageError(blob: Blob, contentType: string, fileName: string): Promise<boolean> {
  const expectsXml = /\.xml$/i.test(fileName);
  const mayBeXml = /(?:application|text)\/(?:[\w.+-]*\+)?xml/i.test(contentType);
  if (expectsXml || (!mayBeXml && blob.size > 128 * 1024)) return false;
  const sample = await blob.slice(0, 16 * 1024).text();
  return /^\s*<\?xml[\s\S]*?<Error[>\s]/i.test(sample)
    || /^\s*<Error[>\s]/i.test(sample)
    || /<(?:ListBucketResult|ListAllMyBucketsResult|InitiateMultipartUploadResult)[>\s]/i.test(sample)
    || /<Code>(?:AccessDenied|NoSuchKey|InvalidAccessKeyId|SecurityTokenExpired|SignatureDoesNotMatch)<\/Code>/i.test(sample);
}

export interface DownloadRemoteFileOptions {
  url: string;
  preferredFileName?: string;
  signal?: AbortSignal;
}

export async function downloadRemoteFile({
  url: rawUrl,
  preferredFileName,
  signal,
}: DownloadRemoteFileOptions): Promise<{ fileName: string; size: number }> {
  const url = resolveDownloadUrl(rawUrl);
  if (!await ensureWebsitePermission(url)) throw new Error('未获得该网站的下载权限。');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw downloadError(response.status);
    const blob = await response.blob();
    const headerName = filenameFromContentDisposition(response.headers.get('content-disposition'));
    const fileName = safeDownloadFilename(preferredFileName?.trim() || headerName || filenameFromUrl(response.url || url));
    if (await isObjectStorageError(blob, response.headers.get('content-type') ?? blob.type, fileName)) {
      throw new Error('对象存储返回了错误信息，没有下载该内容。链接可能已失效，请重新获取链接。');
    }
    downloadBlob(blob, fileName);
    return { fileName, size: blob.size };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('下载超时，请检查网络后重试。', { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
