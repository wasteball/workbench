import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Download,
  Eye,
  EyeOff,
  GripVertical,
  HardDrive,
  ListTree,
  Palette,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { nanoid } from 'nanoid';

import { BUILTIN_CAPABILITIES, MAX_POPUP_CAPABILITIES } from '@/app/capabilities';
import { storageService } from '@/connectors/storage/storage-service';
import { useDestination } from '@/app/destination-context';
import { useSettings } from '@/app/settings-context';
import { isStorageProfileConfigured } from '@/app/storage-status';
import type { PageProps } from '@/features/shared/page-props';
import { downloadText } from '@/platform/files/download-blob';
import { db } from '@/shared/persistence/database';
import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import { settingsService } from '@/shared/settings/settings-service';
import {
  createWorkbenchBackup,
  parseWorkbenchImport,
} from '@/shared/settings/settings-transfer';
import type { StorageProfile, StorageProviderId, ThemePreference } from '@/shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { StatusPill } from '@/shared/ui/StatusPill';

import './settings-page.css';

type SettingsSection = 'general' | 'menu' | 'storage' | 'privacy';

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  name: string;
  description: string;
  icon: typeof Palette;
}> = [
  { id: 'general', name: '常规与外观', description: '主题与默认格式', icon: Palette },
  { id: 'menu', name: '菜单与工具', description: '顺序、显示与快捷入口', icon: ListTree },
  { id: 'storage', name: '云端分享', description: '可选，不影响本地使用', icon: HardDrive },
  { id: 'privacy', name: '权限与隐私', description: '导入、导出与本地数据', icon: ShieldCheck },
];

function isSection(value: string | null): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

function createGatewayProfile(): StorageProfile {
  return {
    id: nanoid(),
    provider: 'gateway',
    name: 'API 方式',
    apiUrl: '',
    bucket: '',
    userCode: '',
    cdn: false,
    publicRead: false,
    headers: [],
  };
}

function createAliyunProfile(): StorageProfile {
  return {
    id: nanoid(),
    provider: 'aliyun-oss',
    name: '阿里云 OSS',
    credentialMode: 'access-key',
    region: '',
    endpoint: '',
    bucket: '',
    prefix: '',
    accessKeyId: '',
    accessKeySecret: '',
    rememberAccessKey: false,
    stsUrl: '',
    stsHeaders: [],
    defaultAccess: 'private',
    signedUrlExpiresInSeconds: 3600,
  };
}

function createStorageProfile(provider: StorageProviderId): StorageProfile {
  return provider === 'gateway' ? createGatewayProfile() : createAliyunProfile();
}

function profileName(provider: StorageProviderId): string {
  return provider === 'gateway' ? 'API 方式' : '阿里云 OSS';
}

function savedProfileForProvider(
  profiles: StorageProfile[],
  provider: StorageProviderId,
  activeProfileId: string | null,
): StorageProfile | undefined {
  return profiles.find((profile) => profile.id === activeProfileId && profile.provider === provider)
    ?? profiles.find((profile) => profile.provider === provider);
}

interface MenuSettingsItem {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

function SortableMenuRow({
  item,
  visible,
  pinned,
  pinningDisabled,
  onVisibleChange,
  onPinnedChange,
}: {
  item: MenuSettingsItem;
  visible: boolean;
  pinned: boolean;
  pinningDisabled: boolean;
  onVisibleChange: (visible: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      className={`sortable-menu-row ${isDragging ? 'sortable-menu-row--dragging' : ''}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button className="drag-handle" type="button" {...attributes} {...listeners} aria-label={`拖动 ${item.name}`}>
        <GripVertical aria-hidden="true" size={18} />
      </button>
      <span className="sortable-menu-row__icon">{item.icon}</span>
      <span className="sortable-menu-row__copy"><strong>{item.name}</strong><small>{item.description}</small></span>
      <label className="compact-check"><input checked={visible} onChange={(event) => onVisibleChange(event.target.checked)} type="checkbox" /><span>显示</span></label>
      <label className="compact-check" title={pinningDisabled ? `浏览器快捷菜单最多显示 ${MAX_POPUP_CAPABILITIES} 项` : undefined}><input checked={pinned} disabled={!visible || pinningDisabled} onChange={(event) => onPinnedChange(event.target.checked)} type="checkbox" /><span>快捷</span></label>
    </div>
  );
}

function HeaderEditor({
  value,
  onChange,
}: {
  value: Array<{ key: string; value: string }>;
  onChange: (value: Array<{ key: string; value: string }>) => void;
}) {
  return (
    <div className="header-editor">
      {value.map((header, index) => (
        <div className="header-row" key={`${index}-${header.key}`}>
          <input aria-label={`请求头 ${index + 1} 名称`} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} placeholder="Header 名称" value={header.key} />
          <input aria-label={`请求头 ${index + 1} 内容`} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="内容" type="password" value={header.value} />
          <IconButton icon={Trash2} label="删除请求头" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} />
        </div>
      ))}
      <Button icon={Plus} onClick={() => onChange([...value, { key: '', value: '' }])} size="small" type="button" variant="quiet">添加请求头</Button>
    </div>
  );
}

export function SettingsPage({ route, navigate }: PageProps) {
  const { settings, update } = useSettings();
  const { resetDestination } = useDestination();
  const initialSection = route.params.get('section');
  const activeProfile = settings.storageProfiles.find((profile) => profile.id === settings.activeStorageProfileId);
  const initialStorageProvider = activeProfile?.provider ?? 'gateway';
  const [section, setSection] = useState<SettingsSection>(isSection(initialSection) ? initialSection : 'general');
  const [storageProvider, setStorageProvider] = useState<StorageProviderId>(initialStorageProvider);
  const [profileDraft, setProfileDraft] = useState<StorageProfile>(() => structuredClone(
    savedProfileForProvider(settings.storageProfiles, initialStorageProvider, settings.activeStorageProfileId)
      ?? createStorageProfile(initialStorageProvider),
  ));
  const [showSecret, setShowSecret] = useState(false);
  const [storageMessage, setStorageMessage] = useState('');
  const [testingStorage, setTestingStorage] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => resetDestination(), [resetDestination]);
  useEffect(() => {
    const requested = route.params.get('section');
    if (isSection(requested)) setSection(requested);
  }, [route.params]);

  useEffect(() => {
    const saved = savedProfileForProvider(settings.storageProfiles, storageProvider, settings.activeStorageProfileId);
    setProfileDraft(structuredClone(saved ?? createStorageProfile(storageProvider)));
  }, [settings.activeStorageProfileId, settings.storageProfiles, storageProvider]);

  const menuItems = useMemo<MenuSettingsItem[]>(() => {
    const items: MenuSettingsItem[] = [
      ...BUILTIN_CAPABILITIES.map((capability) => {
        const Icon = capability.icon;
        return { id: capability.id, name: capability.name, description: capability.description, icon: <Icon aria-hidden="true" size={18} /> };
      }),
      ...settings.customTools.map((tool) => ({ id: `tool:${tool.id}`, name: tool.name, description: '网页快捷方式', icon: <span aria-hidden="true">{tool.icon || '↗'}</span> })),
    ];
    const byId = new Map<string, MenuSettingsItem>(items.map((item) => [item.id, item]));
    const ordered = settings.menuOrder.map((id) => byId.get(id)).filter((item): item is MenuSettingsItem => Boolean(item));
    for (const item of items) if (!ordered.some((candidate) => candidate.id === item.id)) ordered.push(item);
    return ordered;
  }, [settings.customTools, settings.menuOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectSection = (next: SettingsSection) => {
    setSection(next);
    navigate('settings', new URLSearchParams({ section: next }));
  };

  const updateListSetting = async (
    key: 'hiddenCapabilities' | 'pinnedCapabilities',
    id: string,
    enabled: boolean,
  ) => {
    const current = settings[key];
    if (key === 'pinnedCapabilities' && enabled && current.length >= MAX_POPUP_CAPABILITIES) return;
    const next = enabled ? [...new Set([...current, id])] : current.filter((item) => item !== id);
    await update({ [key]: next });
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const order = menuItems.map((item) => item.id);
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    await update({ menuOrder: arrayMove(order, oldIndex, newIndex) });
  };

  const setDraft = (patch: Partial<StorageProfile>) => {
    setProfileDraft((current) => ({ ...current, ...patch } as StorageProfile));
    setStorageMessage('');
  };

  const selectStorageProvider = async (provider: StorageProviderId) => {
    setStorageProvider(provider);
    const saved = savedProfileForProvider(settings.storageProfiles, provider, settings.activeStorageProfileId);
    setProfileDraft(structuredClone(saved ?? createStorageProfile(provider)));
    setStorageMessage(saved ? `${profileName(provider)}已选中。` : `请填写${profileName(provider)}的连接信息。`);
    await update({ activeStorageProfileId: saved?.id ?? null });
  };

  const saveProfile = async () => {
    if (profileDraft.provider === 'gateway' && profileDraft.apiUrl) {
      try {
        const url = new URL(profileDraft.apiUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        setStorageMessage('请填写有效的上传地址。');
        return;
      }
    }
    const savedProfile = { ...profileDraft, name: profileName(profileDraft.provider) } as StorageProfile;
    const next = [
      ...settings.storageProfiles.filter((profile) => profile.provider !== savedProfile.provider),
      savedProfile,
    ];
    storageService.forget(savedProfile.id);
    setProfileDraft(savedProfile);
    await update({ storageProfiles: next, activeStorageProfileId: savedProfile.id });
    setStorageMessage(isStorageProfileConfigured(savedProfile) ? '连接信息已保存，可以开始上传。' : '连接信息已保存；补齐必填项后才会开启上传。');
  };

  const testProfile = async () => {
    setTestingStorage(true);
    setStorageMessage('正在检查连接…');
    try {
      const session = await storageService.test(profileDraft);
      setStorageMessage(session.message);
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message : '连接检查失败。');
    } finally {
      setTestingStorage(false);
    }
  };

  const clearProfile = async () => {
    if (!window.confirm(`清空${profileName(profileDraft.provider)}的配置？已保存的凭据也会一并移除。`)) return;
    storageService.forget(profileDraft.id);
    const remaining = settings.storageProfiles.filter((profile) => profile.provider !== profileDraft.provider);
    await update({ storageProfiles: remaining, activeStorageProfileId: null });
    setProfileDraft(createStorageProfile(profileDraft.provider));
    setStorageMessage(`${profileName(profileDraft.provider)}的配置已清空。`);
  };

  const exportBackup = async () => {
    const [shares, categories] = await Promise.all([
      db.shares.orderBy('createdAt').reverse().toArray(),
      db.fileCategories.orderBy('createdAt').toArray(),
    ]);
    const payload = createWorkbenchBackup(settings, shares, categories);
    downloadText(JSON.stringify(payload, null, 2), 'workbench-backup.json', 'application/json');
    setImportMessage(`已备份偏好和 ${shares.length} 条文件记录；密钥与身份信息未写入备份。`);
  };

  const importBackup = async (file: File) => {
    try {
      const imported = parseWorkbenchImport(JSON.parse(await file.text()) as unknown);
      if (imported.fileLibrary) {
        const existingCount = await db.shares.count();
        if (existingCount > 0 && !window.confirm(`恢复备份会替换当前的 ${existingCount} 条文件记录，继续吗？`)) return;
        await db.transaction('rw', db.shares, db.fileCategories, async () => {
          await Promise.all([db.shares.clear(), db.fileCategories.clear()]);
          if (imported.fileLibrary?.shares.length) await db.shares.bulkPut(imported.fileLibrary.shares);
          if (imported.fileLibrary?.categories.length) await db.fileCategories.bulkPut(imported.fileLibrary.categories);
        });
      }
      await update(imported.settings);
      const importedActive = imported.settings.storageProfiles.find((profile) => profile.id === imported.settings.activeStorageProfileId);
      if (importedActive) setStorageProvider(importedActive.provider);
      setImportMessage(imported.fileLibrary
        ? `已恢复偏好和 ${imported.fileLibrary.shares.length} 条文件记录；请重新填写密钥或身份信息。`
        : '旧版配置已导入；请重新填写密钥或身份信息。');
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : '无法读取备份文件。');
    }
  };

  const clearLocalData = async () => {
    const confirmed = window.confirm('这会删除当前浏览器中的草稿、分享记录、设置和已保存凭据。下载到电脑或已上传到云端的文件不会被删除。继续吗？');
    if (!confirmed) return;
    await Promise.all([db.documents.clear(), db.shares.clear(), db.fileCategories.clear(), settingsService.reset()]);
    window.location.reload();
  };

  return (
    <div className="settings-page">
      <aside className="settings-nav" aria-label="设置分类">
        <div className="settings-nav__heading"><p className="page-kicker">设置</p><h1>Workbench</h1></div>
        {SETTINGS_SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button className={section === item.id ? 'settings-nav__item settings-nav__item--active' : 'settings-nav__item'} key={item.id} onClick={() => selectSection(item.id)} type="button">
              <Icon aria-hidden="true" size={18} /><span><strong>{item.name}</strong><small>{item.description}</small></span>
            </button>
          );
        })}
      </aside>

      <div className="settings-content">
        {section === 'general' ? (
          <>
            <header className="settings-title"><h2>常规与外观</h2><p>这些偏好会同时用于浏览器快捷菜单和完整工作台。</p></header>
            <section className="settings-section">
              <div className="settings-section__label"><h3>主题</h3><p>可以固定亮色、暗色，或跟随系统。</p></div>
              <div className="settings-section__control">
                <div className="segmented-control" aria-label="主题">
                  {([['system', '跟随系统'], ['light', '亮色'], ['dark', '暗色']] as Array<[ThemePreference, string]>).map(([value, label]) => (
                    <button aria-pressed={settings.theme === value} key={value} onClick={() => void update({ theme: value })} type="button">{label}</button>
                  ))}
                </div>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-section__label"><h3>默认输出</h3><p>仍可在每次导出或分享时临时更改。</p></div>
              <div className="settings-section__control settings-control-grid">
                <label className="settings-field"><span>导出格式</span><select onChange={(event) => void update({ defaultExportFormat: event.target.value as typeof settings.defaultExportFormat })} value={settings.defaultExportFormat}><option value="html">HTML 网页</option><option value="docx">Word 文档</option><option value="markdown">Markdown</option></select></label>
                <label className="settings-field"><span>在线分享格式</span><select onChange={(event) => void update({ defaultShareFormat: event.target.value as typeof settings.defaultShareFormat })} value={settings.defaultShareFormat}><option value="html">HTML 网页</option><option value="docx">Word 文档</option><option value="markdown">Markdown</option></select></label>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-section__label"><h3>分享文字</h3><p>决定复制到聊天工具中的文字格式。</p></div>
              <div className="settings-section__control settings-control-grid">
                <label className="settings-field"><span>复制格式</span><select onChange={(event) => void update({ shareCopyFormat: event.target.value as typeof settings.shareCopyFormat })} value={settings.shareCopyFormat}><option value="name-and-link">文件名与链接两行</option><option value="markdown">Markdown 链接</option><option value="single-line">文件名与链接单行</option><option value="link-only">仅链接</option></select></label>
                <label className="setting-toggle"><input checked={settings.autoCopyShareLink} onChange={(event) => void update({ autoCopyShareLink: event.target.checked })} type="checkbox" /><span><strong>分享后自动复制</strong><small>成功后把分享文字放入剪贴板</small></span></label>
              </div>
            </section>
          </>
        ) : null}

        {section === 'menu' ? (
          <>
            <header className="settings-title"><h2>菜单与工具</h2><p>拖动调整顺序；设置入口始终固定在菜单底部。</p></header>
            <section className="settings-section settings-section--stacked">
              <div className="settings-section__label settings-section__label--row"><div><h3>工作台菜单</h3><p>“快捷”表示是否显示在浏览器工具栏按钮中，最多选择 {MAX_POPUP_CAPABILITIES} 项。</p></div><Button icon={RotateCcw} onClick={() => void update({ menuOrder: DEFAULT_SETTINGS.menuOrder, hiddenCapabilities: [], pinnedCapabilities: DEFAULT_SETTINGS.pinnedCapabilities })} size="small" variant="quiet">恢复默认</Button></div>
              <div className="sortable-menu-list">
                <DndContext collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event)} sensors={sensors}>
                  <SortableContext items={menuItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    {menuItems.map((item) => (
                      <SortableMenuRow
                        item={item}
                        key={item.id}
                        onPinnedChange={(pinned) => void updateListSetting('pinnedCapabilities', item.id, pinned)}
                        onVisibleChange={(visible) => void updateListSetting('hiddenCapabilities', item.id, !visible)}
                        pinned={settings.pinnedCapabilities.includes(item.id)}
                        pinningDisabled={!settings.pinnedCapabilities.includes(item.id) && settings.pinnedCapabilities.length >= MAX_POPUP_CAPABILITIES}
                        visible={!settings.hiddenCapabilities.includes(item.id)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </section>
          </>
        ) : null}

        {section === 'storage' ? (
          <>
            <header className="settings-title"><h2>云端分享</h2><p>只有上传文件或生成在线链接时才需要设置。</p></header>
            <div className="storage-reassurance"><ShieldCheck aria-hidden="true" size={20} /><div><strong>本地使用无需设置</strong><p>新建、打开、编辑、阅读和导出文档始终可用。没有存储连接时，只会关闭上传和在线分享。</p></div></div>
            <div className="storage-method-picker">
              <div><strong>连接方式</strong><small>选择一种当前使用的方式，配置只在这里维护。</small></div>
              <div aria-label="云端连接方式" className="segmented-control">
                <button aria-pressed={storageProvider === 'gateway'} onClick={() => void selectStorageProvider('gateway')} type="button">API 方式</button>
                <button aria-pressed={storageProvider === 'aliyun-oss'} onClick={() => void selectStorageProvider('aliyun-oss')} type="button">阿里云 OSS</button>
              </div>
            </div>

            <section className="storage-form">
                <div className="storage-form__status"><div><strong>{profileName(profileDraft.provider)}</strong><p>{profileDraft.provider === 'gateway' ? '适合单位或服务提供者给了上传地址、Bucket 和用户标识的情况。' : '直接连接个人阿里云 OSS，填写地域、Bucket 和长期 AccessKey。'}</p></div><StatusPill tone={isStorageProfileConfigured(profileDraft) ? 'success' : 'warning'}>{isStorageProfileConfigured(profileDraft) ? '可以使用' : '尚未配置'}</StatusPill></div>
                <div className="storage-fields">
                  {profileDraft.provider === 'gateway' ? (
                    <>
                      <label className="settings-field settings-field--wide"><span>API 上传地址</span><input inputMode="url" onChange={(event) => setDraft({ apiUrl: event.target.value })} placeholder="完整地址，例如 https://…/upload" value={profileDraft.apiUrl} /></label>
                      <label className="settings-field"><span>存储空间名称</span><input onChange={(event) => setDraft({ bucket: event.target.value })} placeholder="由管理员提供" value={profileDraft.bucket} /></label>
                      <label className="settings-field"><span>用户标识</span><input onChange={(event) => setDraft({ userCode: event.target.value })} placeholder="由管理员提供" value={profileDraft.userCode} /></label>
                      <label className="setting-toggle"><input checked={profileDraft.cdn} onChange={(event) => setDraft({ cdn: event.target.checked })} type="checkbox" /><span><strong>使用加速地址</strong><small>仅在服务提供者要求时开启</small></span></label>
                      <label className="setting-toggle"><input checked={profileDraft.publicRead} onChange={(event) => setDraft({ publicRead: event.target.checked })} type="checkbox" /><span><strong>生成公开链接</strong><small>最终访问范围由存储服务决定</small></span></label>
                      <details className="advanced-settings settings-field--wide"><summary>高级参数（通常不用修改）</summary><p>只有管理员提供了额外参数时才填写。导出配置时会自动移除其中的身份信息。</p><HeaderEditor onChange={(headers) => setDraft({ headers } as Partial<StorageProfile>)} value={profileDraft.headers} /></details>
                    </>
                  ) : (
                    <>
                      <label className="settings-field"><span>所在地域代码</span><input onChange={(event) => setDraft({ region: event.target.value })} placeholder="例如 oss-cn-hangzhou" value={profileDraft.region} /></label>
                      <label className="settings-field"><span>存储空间名称</span><input onChange={(event) => setDraft({ bucket: event.target.value })} placeholder="从阿里云存储页面复制" value={profileDraft.bucket} /></label>

                      {profileDraft.credentialMode === 'access-key' ? (
                        <>
                          <div className="security-notice settings-field--wide"><ShieldCheck aria-hidden="true" size={19} /><p><strong>请为 Workbench 单独创建权限受限的访问密钥。</strong>不要填写阿里云主账号的密钥；不确定时先不要开启云端分享。浏览器扩展还需要在 OSS 跨域规则中允许当前扩展来源。</p></div>
                          <label className="settings-field"><span>访问身份（AccessKey ID）</span><input autoComplete="off" onChange={(event) => setDraft({ accessKeyId: event.target.value })} value={profileDraft.accessKeyId} /></label>
                          <label className="settings-field secret-field"><span>访问密钥（AccessKey Secret）</span><span className="secret-input"><input autoComplete="new-password" onChange={(event) => setDraft({ accessKeySecret: event.target.value })} type={showSecret ? 'text' : 'password'} value={profileDraft.accessKeySecret} /><IconButton icon={showSecret ? EyeOff : Eye} label={showSecret ? '隐藏访问密钥' : '显示访问密钥'} onClick={() => setShowSecret((value) => !value)} /></span></label>
                          <label className="setting-toggle settings-field--wide"><input checked={profileDraft.rememberAccessKey} onChange={(event) => setDraft({ rememberAccessKey: event.target.checked })} type="checkbox" /><span><strong>在此浏览器记住访问密钥</strong><small>关闭时，浏览器完全退出后需要重新填写</small></span></label>
                        </>
                      ) : (
                        <>
                          <div className="security-notice settings-field--wide"><ShieldCheck aria-hidden="true" size={19} /><p><strong>当前使用高级临时授权方式。</strong>服务地址和身份参数应由服务提供者给出。</p></div>
                          <label className="settings-field settings-field--wide"><span>临时授权服务地址</span><input inputMode="url" onChange={(event) => setDraft({ stsUrl: event.target.value })} placeholder="由服务提供者提供" value={profileDraft.stsUrl} /></label>
                        </>
                      )}

                      <div className="settings-field"><span>分享链接默认范围</span><div className="segmented-control"><button aria-pressed={profileDraft.defaultAccess === 'private'} onClick={() => setDraft({ defaultAccess: 'private' })} type="button">私密</button><button aria-pressed={profileDraft.defaultAccess === 'public'} onClick={() => setDraft({ defaultAccess: 'public' })} type="button">公开</button></div></div>
                      <label className="settings-field"><span>私密链接多久后失效</span><select onChange={(event) => setDraft({ signedUrlExpiresInSeconds: Number(event.target.value) })} value={profileDraft.signedUrlExpiresInSeconds}><option value={600}>10 分钟</option><option value={3600}>1 小时</option><option value={21600}>6 小时</option><option value={86400}>1 天</option></select></label>
                      <details className="advanced-settings settings-field--wide">
                        <summary>高级连接方式与参数</summary>
                        <p>只有服务提供者明确要求时才修改这里。</p>
                        <div className="advanced-settings__fields">
                          <div className="settings-field settings-field--wide"><span>连接方式</span><div className="segmented-control"><button aria-pressed={profileDraft.credentialMode === 'access-key'} onClick={() => setDraft({ credentialMode: 'access-key' })} type="button">访问密钥（常用）</button><button aria-pressed={profileDraft.credentialMode === 'sts'} onClick={() => setDraft({ credentialMode: 'sts' })} type="button">临时授权服务</button></div></div>
                          <label className="settings-field settings-field--wide"><span>自定义服务地址</span><input onChange={(event) => setDraft({ endpoint: event.target.value })} placeholder="不填写时使用阿里云默认地址" value={profileDraft.endpoint} /></label>
                          <label className="settings-field settings-field--wide"><span>文件保存目录</span><input onChange={(event) => setDraft({ prefix: event.target.value })} placeholder="例如 workbench/" value={profileDraft.prefix} /></label>
                          {profileDraft.credentialMode === 'sts' ? <div className="settings-field settings-field--wide"><span>临时授权身份参数</span><p>仅填写服务提供者给出的内容；导出配置时会自动移除。</p><HeaderEditor onChange={(stsHeaders) => setDraft({ stsHeaders } as Partial<StorageProfile>)} value={profileDraft.stsHeaders} /></div> : null}
                        </div>
                      </details>
                    </>
                  )}
                </div>
                {storageMessage ? <p className="settings-message" role="status">{storageMessage}</p> : null}
                <div className="storage-form__actions"><Button onClick={() => void clearProfile()} variant="danger">清空此方式</Button><Button disabled={testingStorage} onClick={() => void testProfile()}>{testingStorage ? '正在测试' : '测试连接'}</Button><Button onClick={() => void saveProfile()} variant="primary">保存配置</Button></div>
              </section>
          </>
        ) : null}

        {section === 'privacy' ? (
          <>
            <header className="settings-title"><h2>权限与隐私</h2><p>Workbench 默认在本机处理文档，只有你主动上传时才连接配置的存储。</p></header>
            <section className="settings-section">
              <div className="settings-section__label"><h3>更新与备份</h3><p>直接更新插件会保留数据；卸载会清除偏好、草稿和文件库。必须卸载时，请先备份。</p></div>
              <div className="settings-section__control action-row"><Button icon={Download} onClick={() => void exportBackup()}>备份偏好与文件库</Button><Button icon={Upload} onClick={() => importInput.current?.click()}>恢复备份</Button><input accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.target.value = ''; }} ref={importInput} type="file" /></div>
            </section>
            <section className="settings-section">
              <div className="settings-section__label"><h3>本地数据</h3><p>草稿和分享记录只保存在当前浏览器中；清除扩展数据或卸载扩展也会删除它们。</p></div>
              <div className="settings-section__control"><Button icon={Trash2} onClick={() => void clearLocalData()} variant="danger">清除本地数据</Button></div>
            </section>
            <section className="privacy-facts" aria-label="数据使用说明"><div><strong>文档内容</strong><p>只在你主动分享或上传时发送到当前选择的存储服务。</p></div><div><strong>升级数据</strong><p>同一插件直接更新会保留；卸载后 Chrome 会删除本地数据。</p></div><div><strong>网页权限</strong><p>读取网址时按站点单独申请，不在安装时请求访问全部网站。</p></div></section>
            {importMessage ? <p className="settings-message" role="status">{importMessage}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
