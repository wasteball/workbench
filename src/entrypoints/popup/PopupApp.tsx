import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FilePlus2, FileText, FolderOpen, Grid2X2, Home, Settings, UploadCloud, type LucideIcon } from 'lucide-react';
import { browser } from 'wxt/browser';

import { useSettings } from '@/app/settings-context';
import { MAX_POPUP_CAPABILITIES } from '@/app/capabilities';
import { getActiveStorageProfile, isStorageProfileConfigured } from '@/app/storage-status';
import { openWorkbench } from '@/shared/browser/open-workbench';
import type { DocumentRecord } from '@/shared/persistence/database';
import { documentService } from '@/shared/persistence/document-service';
import { IconButton } from '@/shared/ui/IconButton';
import { StatusPill } from '@/shared/ui/StatusPill';

export function PopupApp() {
  const { settings } = useSettings();
  const [recent, setRecent] = useState<DocumentRecord[]>([]);
  useEffect(() => {
    void documentService.recent(3).then(setRecent);
  }, []);

  const profile = useMemo(
    () => getActiveStorageProfile(settings.storageProfiles, settings.activeStorageProfileId),
    [settings.activeStorageProfileId, settings.storageProfiles],
  );
  const storageReady = isStorageProfileConfigured(profile);

  const open = (route: string, params?: Record<string, string>) => {
    void openWorkbench(route, params ? new URLSearchParams(params) : undefined);
  };

  const actions = useMemo(() => {
    const builtins: Record<string, { title: string; description: string; icon: LucideIcon; run: () => void }> = {
      home: { title: '工作台首页', description: '查看最近文档与状态', icon: Home, run: () => open('home') },
      markdown: { title: '打开 Markdown', description: '从电脑选择文档', icon: FolderOpen, run: () => open('markdown', { intent: 'open' }) },
      files: { title: '上传文件', description: storageReady ? `使用 ${profile?.name}` : '需要先连接存储', icon: UploadCloud, run: () => open('files', { intent: 'upload' }) },
      tools: { title: '我的工具', description: '打开网页快捷方式', icon: Grid2X2, run: () => open('tools') },
    };
    const custom = new Map(settings.customTools.map((tool) => [`tool:${tool.id}`, {
      title: tool.name,
      description: '在新标签页打开',
      emoji: tool.icon || '↗',
      run: () => { void browser.tabs.create({ url: tool.url }); },
    }]));
    const order = [...settings.menuOrder, ...settings.pinnedCapabilities.filter((id) => !settings.menuOrder.includes(id))];
    return order
      .filter((id) => settings.pinnedCapabilities.includes(id) && !settings.hiddenCapabilities.includes(id))
      .map((id) => builtins[id] ?? custom.get(id))
      .filter((action): action is NonNullable<typeof action> => Boolean(action));
  }, [profile?.name, settings.customTools, settings.hiddenCapabilities, settings.menuOrder, settings.pinnedCapabilities, storageReady]);

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div className="popup-brand"><span className="brand-mark">W</span><strong>Workbench</strong></div>
        <IconButton icon={Settings} label="打开设置" onClick={() => open('settings')} />
      </header>

      <section className="popup-actions" aria-label="快速操作">
        <button className="popup-action popup-action--primary" onClick={() => open('markdown', { intent: 'new' })} type="button">
          <FilePlus2 aria-hidden="true" size={20} /><span><strong>新建文档</strong><small>创建本地恢复草稿</small></span><ArrowRight aria-hidden="true" size={16} />
        </button>
        {actions.slice(0, MAX_POPUP_CAPABILITIES).map((action) => {
          const Icon = 'icon' in action ? action.icon : null;
          return <button className="popup-action" key={action.title} onClick={action.run} type="button">{Icon ? <Icon aria-hidden="true" size={20} /> : <span className="popup-action__emoji" aria-hidden="true">{'emoji' in action ? action.emoji : '↗'}</span>}<span><strong>{action.title}</strong><small>{action.description}</small></span><ArrowRight aria-hidden="true" size={16} /></button>;
        })}
      </section>

      <section className="popup-recents">
        <div className="popup-section-heading"><strong>最近文档</strong><StatusPill tone={storageReady ? 'success' : 'warning'}>{storageReady ? '存储已连接' : '仅本地'}</StatusPill></div>
        {recent.length === 0 ? (
          <p className="popup-empty">打开过的文档会显示在这里。</p>
        ) : recent.map((document) => (
          <button className="popup-recent" key={document.id} onClick={() => open('markdown', { document: document.id })} type="button">
            <FileText aria-hidden="true" size={17} /><span><strong>{document.title}</strong><small>{document.draftUpdatedAt ? '有恢复草稿' : document.sourceLabel}</small></span><ArrowRight aria-hidden="true" size={15} />
          </button>
        ))}
      </section>

      <button className="popup-open-all" onClick={() => open('home')} type="button">打开完整工作台 <ArrowRight aria-hidden="true" size={16} /></button>
    </div>
  );
}
