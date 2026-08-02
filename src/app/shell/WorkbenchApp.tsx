import { lazy, Suspense, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Moon,
  Settings,
  Sun,
} from 'lucide-react';

import { BUILTIN_CAPABILITIES, SETTINGS_CAPABILITY } from '@/app/capabilities';
import { useDestination } from '@/app/destination-context';
import { useSettings } from '@/app/settings-context';
import { getActiveStorageProfile, isStorageProfileConfigured } from '@/app/storage-status';
import { useRoute } from '@/app/use-route';
import { browser } from 'wxt/browser';

import { IconButton } from '@/shared/ui/IconButton';
import { StatusPill } from '@/shared/ui/StatusPill';

import './workbench-app.css';

const PAGE_COMPONENTS = {
  home: lazy(async () => ({ default: (await import('@/features/home/HomePage')).HomePage })),
  markdown: lazy(async () => ({ default: (await import('@/features/markdown/MarkdownWorkspace')).MarkdownWorkspace })),
  files: lazy(async () => ({ default: (await import('@/features/files/FilesPage')).FilesPage })),
  tools: lazy(async () => ({ default: (await import('@/features/tools/ToolsPage')).ToolsPage })),
  settings: lazy(async () => ({ default: (await import('@/features/settings/SettingsPage')).SettingsPage })),
} as const;

export function WorkbenchApp() {
  const { route, navigate } = useRoute();
  const { settings, update } = useSettings();
  const { destination } = useDestination();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarItems = useMemo(() => {
    const allItems = [
      ...BUILTIN_CAPABILITIES.map((item) => ({
        id: item.id,
        kind: 'builtin' as const,
        item,
      })),
      ...settings.customTools.map((item) => ({
        id: `tool:${item.id}`,
        kind: 'custom' as const,
        item,
      })),
    ];
    const byId = new Map(allItems.map((entry) => [entry.id, entry]));
    const ordered = settings.menuOrder
      .map((id) => byId.get(id))
      .filter((item): item is (typeof allItems)[number] => Boolean(item));
    for (const item of allItems) {
      if (!ordered.some((candidate) => candidate.id === item.id)) ordered.push(item);
    }
    return ordered.filter((entry) => !settings.hiddenCapabilities.includes(entry.id));
  }, [settings.customTools, settings.hiddenCapabilities, settings.menuOrder]);

  const activeProfile = getActiveStorageProfile(
    settings.storageProfiles,
    settings.activeStorageProfileId,
  );
  const storageReady = isStorageProfileConfigured(activeProfile);
  const CurrentPage = PAGE_COMPONENTS[route.page as keyof typeof PAGE_COMPONENTS] ?? PAGE_COMPONENTS.home;

  const go = (page: string) => {
    navigate(page);
    setMobileOpen(false);
  };

  const openCustomTool = async (url: string) => {
    await browser.tabs.create({ url });
  };

  const toggleTheme = async () => {
    const next = settings.theme === 'dark' ? 'light' : 'dark';
    await update({ theme: next });
  };

  return (
    <div className="workbench-layout">
      <aside
        className={`app-sidebar ${collapsed ? 'app-sidebar--collapsed' : ''} ${mobileOpen ? 'app-sidebar--mobile-open' : ''}`}
      >
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">W</span>
          {!collapsed ? (
            <span className="brand-copy">
              <strong>Workbench</strong>
              <small>浏览器工作台</small>
            </span>
          ) : null}
        </div>

        <nav className="capability-nav" aria-label="工作台菜单">
          {sidebarItems.map((entry) => {
            if (entry.kind === 'custom') {
              const tool = entry.item;
              return (
                <button
                  key={entry.id}
                  className="capability-nav__item capability-nav__item--custom"
                  onClick={() => void openCustomTool(tool.url)}
                  title={collapsed ? tool.name : undefined}
                  type="button"
                >
                  <span className="custom-tool-icon" aria-hidden="true">{tool.icon || '↗'}</span>
                  {!collapsed ? (
                    <span>
                      <strong>{tool.name}</strong>
                      <small>在新标签页打开</small>
                    </span>
                  ) : null}
                </button>
              );
            }
            const capability = entry.item;
            const Icon = capability.icon;
            const active = route.page === capability.id;
            return (
              <button
                key={capability.id}
                className={`capability-nav__item ${active ? 'capability-nav__item--active' : ''}`}
                onClick={() => go(capability.id)}
                title={collapsed ? capability.name : undefined}
                type="button"
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                {!collapsed ? (
                  <span>
                    <strong>{capability.name}</strong>
                    <small>{capability.description}</small>
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            className={`capability-nav__item ${route.page === 'settings' ? 'capability-nav__item--active' : ''}`}
            onClick={() => go(SETTINGS_CAPABILITY.id)}
            title={collapsed ? SETTINGS_CAPABILITY.name : undefined}
            type="button"
          >
            <Settings aria-hidden="true" size={19} strokeWidth={1.8} />
            {!collapsed ? (
              <span>
                <strong>设置</strong>
                <small>{storageReady ? '云端分享已连接' : '本地功能可用'}</small>
              </span>
            ) : null}
          </button>
          <IconButton
            className="sidebar-collapse"
            icon={collapsed ? ChevronRight : ChevronLeft}
            label={collapsed ? '展开菜单' : '收起菜单'}
            onClick={() => setCollapsed((value) => !value)}
          />
        </div>
      </aside>

      {mobileOpen ? (
        <button
          aria-label="关闭菜单"
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <div className="workbench-main">
        <header className="workbench-header">
          <IconButton
            className="mobile-menu-button"
            icon={Menu}
            label="打开菜单"
            onClick={() => setMobileOpen(true)}
          />
          <div className={`destination-strip destination-strip--${destination.kind}`}>
            <span className="destination-strip__dot" aria-hidden="true" />
            <span className="destination-strip__copy">
              <strong>{destination.label}</strong>
              <small>{destination.detail}</small>
            </span>
          </div>
          <div className="header-actions">
            <StatusPill tone={storageReady ? 'success' : 'warning'}>
              {storageReady ? activeProfile?.name : '仅本地'}
            </StatusPill>
            <IconButton
              icon={settings.theme === 'dark' ? Sun : Moon}
              label={settings.theme === 'dark' ? '切换到亮色' : '切换到暗色'}
              onClick={() => void toggleTheme()}
            />
          </div>
        </header>
        <main className="workbench-content">
          <Suspense fallback={<div className="page-loading" role="status">正在打开…</div>}>
            <CurrentPage route={route} navigate={navigate} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
