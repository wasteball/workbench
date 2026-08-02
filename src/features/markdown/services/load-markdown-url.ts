import { ensureWebsitePermission } from '@/platform/permissions/website-permission';

export function normalizeMarkdownUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 http 或 https 地址。');
  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 5 && parts[2] === 'blob') {
      return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join('/')}`;
    }
  }
  if (url.hostname === 'gist.github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return `https://gist.githubusercontent.com/${parts[0]}/${parts[1]}/raw`;
  }
  return url.toString();
}

export async function loadMarkdownUrl(value: string): Promise<{ url: string; content: string }> {
  const url = normalizeMarkdownUrl(value);
  if (!await ensureWebsitePermission(url)) throw new Error('未获得该网站的读取权限。');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）。`);
    const content = await response.text();
    if (content.length > 10 * 1024 * 1024) throw new Error('文档超过 10 MB，暂不在浏览器中打开。');
    return { url: response.url || url, content };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('读取超时，请检查地址或网络。', { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
