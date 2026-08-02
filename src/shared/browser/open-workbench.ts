import { browser } from 'wxt/browser';

export async function openWorkbench(route = 'home', params?: URLSearchParams): Promise<void> {
  const hash = params && [...params].length > 0 ? `${route}?${params.toString()}` : route;
  const url = browser.runtime.getURL(`/workbench.html#${hash}`);
  const existing = await browser.tabs.query({ url: browser.runtime.getURL('/workbench.html*') });
  const tab = existing[0];
  if (tab?.id) {
    await browser.tabs.update(tab.id, { active: true, url });
    if (tab.windowId) await browser.windows.update(tab.windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url });
}
