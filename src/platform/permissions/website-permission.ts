import { browser } from 'wxt/browser';

export function permissionPatternForUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 http 或 https 地址。');
  return `${url.protocol}//${url.host}/*`;
}

export async function ensureWebsitePermission(value: string): Promise<boolean> {
  const origin = permissionPatternForUrl(value);
  if (await browser.permissions.contains({ origins: [origin] })) return true;
  return browser.permissions.request({ origins: [origin] });
}
