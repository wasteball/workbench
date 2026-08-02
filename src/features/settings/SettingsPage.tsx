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
  createSettingsExport,
  parseSettingsImport,
} from '@/shared/settings/settings-transfer';
import type { StorageProfile, ThemePreference } from '@/shared/types';
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
  { id: 'storage', name: '存储连接', description: '上传网关与阿里云 OSS', icon: HardDrive },
  { id: 'privacy', name: '权限与隐私', description: '导入、导出与本地数据', icon: ShieldCheck },
];

function isSection(value: string | null): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

function createGatewayProfile(index: number): StorageProfile {
  return {
    id: nanoid(),
    provider: 'gateway',
    name: index > 1 ? `上传网关 ${index}` : '上传网关',
    apiUrl: '',
    bucket: '',
    userCode: '',
    cdn: false,
    publicRead: false,
    headers: [],
  };
}

function createAliyunProfile(index: number): StorageProfile {
  return {
    id: nanoid(),
    provider: 'aliyun-oss',
    name: index > 1 ? `阿里云 OSS ${index}` : '阿里云 OSS',
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
      <label className="compact-check" title={pinningDisabled ? `Popup 最多固定 ${MAX_POPUP_CAPABILITIES} 项` : undefined}><input checked={pinned} disabled={!visible || pinningDisabled} onChange={(event) => onPinnedChange(event.target.checked)} type="checkbox" /><span>Popup</span></label>
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
  const [section, setSection] = useState<SettingsSection>(isSection(initialSection) ? initialSection : 'general');
  const [profileDraft, setProfileDraft] = useState<StorageProfile | null>(null);
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

  const activeProfile = settings.storageProfiles.find((profile) => profile.id === settings.activeStorageProfileId)
    ?? settings.storageProfiles[0];

  useEffect(() => {
    if (activeProfile) setProfileDraft(structuredClone(activeProfile));
  }, [activeProfile]);

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
    setProfileDraft((current) => current ? ({ ...current, ...patch } as StorageProfile) : current);
    setStorageMessage('');
  };

  const saveProfile = async () => {
    if (!profileDraft) return;
    if (!profileDraft.name.trim()) {
      setStorageMessage('请填写连接名称。');
      return;
    }
    if (profileDraft.provider === 'gateway' && profileDraft.apiUrl) {
      try {
        const url = new URL(profileDraft.apiUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        setStorageMessage('API 地址必须是有效的 http 或 https 地址。');
        return;
      }
    }
    const next = settings.storageProfiles.map((profile) => profile.id === profileDraft.id ? profileDraft : profile);
    storageService.forget(profileDraft.id);
    await update({ storageProfiles: next, activeStorageProfileId: profileDraft.id });
    setStorageMessage(isStorageProfileConfigured(profileDraft) ? '连接信息已保存，可以测试实际权限。' : '连接信息已保存；补齐必填项后才会开启上传。');
  };

  const testProfile = async () => {
    if (!profileDraft) return;
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

  const addProfile = async (provider: 'gateway' | 'aliyun-oss') => {
    const sameProviderCount = settings.storageProfiles.filter((profile) => profile.provider === provider).length + 1;
    const profile = provider === 'gateway' ? createGatewayProfile(sameProviderCount) : createAliyunProfile(sameProviderCount);
    await update({ storageProfiles: [...settings.storageProfiles, profile], activeStorageProfileId: profile.id });
    setProfileDraft(profile);
    setStorageMessage('新连接已创建，请填写连接信息。');
  };

  const deleteProfile = async () => {
    if (!profileDraft || !window.confirm(`删除“${profileDraft.name}”？已保存的凭据也会一并移除。`)) return;
    storageService.forget(profileDraft.id);
    const remaining = settings.storageProfiles.filter((profile) => profile.id !== profileDraft.id);
    const nextProfiles = remaining.length > 0 ? remaining : [createGatewayProfile(1)];
    await update({ storageProfiles: nextProfiles, activeStorageProfileId: nextProfiles[0]?.id ?? null });
    setProfileDraft(nextProfiles[0] ?? null);
    setStorageMessage('连接已删除。');
  };

  const exportSettings = () => {
    const payload = createSettingsExport(settings);
    downloadText(JSON.stringify(payload, null, 2), 'workbench-settings.json', 'application/json');
    setImportMessage('已导出不含密钥和请求头内容的配置。');
  };

  const importSettings = async (file: File) => {
    try {
      const imported = parseSettingsImport(JSON.parse(await file.text()) as unknown);
      await update(imported);
      setImportMessage('配置已导入；出于安全考虑，凭据需要重新填写。');
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : '无法读取配置文件。');
    }
  };

  const clearLocalData = async () => {
    const confirmed = window.confirm('这会删除当前浏览器中的草稿、分享记录、设置和已保存凭据。下载到电脑或已上传到云端的文件不会被删除。继续吗？');
    if (!confirmed) return;
    await Promise.all([db.documents.clear(), db.shares.clear(), settingsService.reset()]);
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
            <header className="settings-title"><h2>常规与外观</h2><p>这些偏好会同时用于 Popup 和完整工作台。</p></header>
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
              <div className="settings-section__label settings-section__label--row"><div><h3>工作台菜单</h3><p>“Popup”表示是否出现在浏览器按钮的快捷区，最多固定 {MAX_POPUP_CAPABILITIES} 项。</p></div><Button icon={RotateCcw} onClick={() => void update({ menuOrder: DEFAULT_SETTINGS.menuOrder, hiddenCapabilities: [], pinnedCapabilities: DEFAULT_SETTINGS.pinnedCapabilities })} size="small" variant="quiet">恢复默认</Button></div>
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
            <header className="settings-title"><h2>存储连接</h2><p>未配置时只关闭上传和在线分享，本地编辑与导出始终可用。</p></header>
            <div className="profile-toolbar">
              <label className="settings-field"><span>当前连接</span><select onChange={(event) => void update({ activeStorageProfileId: event.target.value })} value={activeProfile?.id ?? ''}>{settings.storageProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.provider === 'gateway' ? '上传网关' : '阿里云 OSS'}</option>)}</select></label>
              <div className="profile-toolbar__actions"><Button icon={Plus} onClick={() => void addProfile('gateway')} size="small">上传网关</Button><Button icon={Plus} onClick={() => void addProfile('aliyun-oss')} size="small">阿里云 OSS</Button></div>
            </div>

            {profileDraft ? (
              <section className="storage-form">
                <div className="storage-form__status"><div><strong>{profileDraft.provider === 'gateway' ? '现有上传网关' : '阿里云 OSS'}</strong><p>{profileDraft.provider === 'gateway' ? '使用管理员提供的上传接口；代码中不带任何默认地址。' : '直接连接你自己的 Bucket，支持长期 AccessKey 或 STS。'}</p></div><StatusPill tone={isStorageProfileConfigured(profileDraft) ? 'success' : 'warning'}>{isStorageProfileConfigured(profileDraft) ? '必填项完整' : '尚未配置'}</StatusPill></div>
                <div className="storage-fields">
                  <label className="settings-field"><span>连接名称</span><input onChange={(event) => setDraft({ name: event.target.value })} value={profileDraft.name} /></label>

                  {profileDraft.provider === 'gateway' ? (
                    <>
                      <label className="settings-field settings-field--wide"><span>API 地址</span><input inputMode="url" onChange={(event) => setDraft({ apiUrl: event.target.value })} placeholder="https://your-service.example/upload" value={profileDraft.apiUrl} /></label>
                      <label className="settings-field"><span>Bucket</span><input onChange={(event) => setDraft({ bucket: event.target.value })} placeholder="管理员提供" value={profileDraft.bucket} /></label>
                      <label className="settings-field"><span>用户标识</span><input onChange={(event) => setDraft({ userCode: event.target.value })} placeholder="管理员提供" value={profileDraft.userCode} /></label>
                      <label className="setting-toggle"><input checked={profileDraft.cdn} onChange={(event) => setDraft({ cdn: event.target.checked })} type="checkbox" /><span><strong>使用 CDN</strong><small>仅在网关支持时开启</small></span></label>
                      <label className="setting-toggle"><input checked={profileDraft.publicRead} onChange={(event) => setDraft({ publicRead: event.target.checked })} type="checkbox" /><span><strong>请求公开读取</strong><small>最终访问权限由网关决定</small></span></label>
                      <details className="advanced-settings settings-field--wide"><summary>高级连接参数</summary><p>请求头内容可能包含凭据，只会保存在当前浏览器中，导出配置时会移除。</p><HeaderEditor onChange={(headers) => setDraft({ headers } as Partial<StorageProfile>)} value={profileDraft.headers} /></details>
                    </>
                  ) : (
                    <>
                      <div className="settings-field settings-field--wide"><span>凭证方式</span><div className="segmented-control"><button aria-pressed={profileDraft.credentialMode === 'access-key'} onClick={() => setDraft({ credentialMode: 'access-key' })} type="button">长期 AccessKey</button><button aria-pressed={profileDraft.credentialMode === 'sts'} onClick={() => setDraft({ credentialMode: 'sts' })} type="button">STS 临时凭证</button></div></div>
                      <label className="settings-field"><span>地域 Region</span><input onChange={(event) => setDraft({ region: event.target.value })} placeholder="oss-cn-hangzhou" value={profileDraft.region} /></label>
                      <label className="settings-field"><span>Bucket</span><input onChange={(event) => setDraft({ bucket: event.target.value })} value={profileDraft.bucket} /></label>
                      <label className="settings-field settings-field--wide"><span>自定义 Endpoint（可选）</span><input onChange={(event) => setDraft({ endpoint: event.target.value })} placeholder="https://oss-cn-hangzhou.aliyuncs.com" value={profileDraft.endpoint} /></label>
                      <label className="settings-field settings-field--wide"><span>对象前缀（可选）</span><input onChange={(event) => setDraft({ prefix: event.target.value })} placeholder="workbench/" value={profileDraft.prefix} /></label>

                      {profileDraft.credentialMode === 'access-key' ? (
                        <>
                          <div className="security-notice settings-field--wide"><ShieldCheck aria-hidden="true" size={19} /><p><strong>请使用权限受限的独立 RAM 用户。</strong>浏览器扩展存储不是系统钥匙串；不要填写阿里云主账号 AccessKey。</p></div>
                          <label className="settings-field"><span>AccessKey ID</span><input autoComplete="off" onChange={(event) => setDraft({ accessKeyId: event.target.value })} value={profileDraft.accessKeyId} /></label>
                          <label className="settings-field secret-field"><span>AccessKey Secret</span><span className="secret-input"><input autoComplete="new-password" onChange={(event) => setDraft({ accessKeySecret: event.target.value })} type={showSecret ? 'text' : 'password'} value={profileDraft.accessKeySecret} /><IconButton icon={showSecret ? EyeOff : Eye} label={showSecret ? '隐藏 Secret' : '显示 Secret'} onClick={() => setShowSecret((value) => !value)} /></span></label>
                          <label className="setting-toggle settings-field--wide"><input checked={profileDraft.rememberAccessKey} onChange={(event) => setDraft({ rememberAccessKey: event.target.checked })} type="checkbox" /><span><strong>在此浏览器记住 Secret</strong><small>关闭时仅保留到本次浏览器会话结束</small></span></label>
                        </>
                      ) : (
                        <>
                          <label className="settings-field settings-field--wide"><span>STS 服务地址</span><input inputMode="url" onChange={(event) => setDraft({ stsUrl: event.target.value })} placeholder="https://your-service.example/sts" value={profileDraft.stsUrl} /></label>
                          <details className="advanced-settings settings-field--wide"><summary>STS 请求头</summary><p>用于向你自己的 STS 服务证明身份；导出配置时会移除内容。</p><HeaderEditor onChange={(stsHeaders) => setDraft({ stsHeaders } as Partial<StorageProfile>)} value={profileDraft.stsHeaders} /></details>
                        </>
                      )}

                      <div className="settings-field"><span>默认访问方式</span><div className="segmented-control"><button aria-pressed={profileDraft.defaultAccess === 'private'} onClick={() => setDraft({ defaultAccess: 'private' })} type="button">私有</button><button aria-pressed={profileDraft.defaultAccess === 'public'} onClick={() => setDraft({ defaultAccess: 'public' })} type="button">公开</button></div></div>
                      <label className="settings-field"><span>私有链接有效期（秒）</span><input max={86400} min={60} onChange={(event) => setDraft({ signedUrlExpiresInSeconds: Number(event.target.value) || 3600 })} type="number" value={profileDraft.signedUrlExpiresInSeconds} /></label>
                    </>
                  )}
                </div>
                {storageMessage ? <p className="settings-message" role="status">{storageMessage}</p> : null}
                <div className="storage-form__actions"><Button onClick={() => void deleteProfile()} variant="danger">删除连接</Button><Button disabled={testingStorage} onClick={() => void testProfile()}>{testingStorage ? '正在测试' : '测试连接'}</Button><Button onClick={() => void saveProfile()} variant="primary">保存连接</Button></div>
              </section>
            ) : null}
          </>
        ) : null}

        {section === 'privacy' ? (
          <>
            <header className="settings-title"><h2>权限与隐私</h2><p>Workbench 默认在本机处理文档，只有你主动上传时才连接配置的存储。</p></header>
            <section className="settings-section">
              <div className="settings-section__label"><h3>配置备份</h3><p>导出文件不包含 AccessKey、用户标识或请求头内容。</p></div>
              <div className="settings-section__control action-row"><Button icon={Download} onClick={exportSettings}>导出配置</Button><Button icon={Upload} onClick={() => importInput.current?.click()}>导入配置</Button><input accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importSettings(file); event.target.value = ''; }} ref={importInput} type="file" /></div>
            </section>
            <section className="settings-section">
              <div className="settings-section__label"><h3>本地数据</h3><p>草稿和分享记录保存在扩展的 IndexedDB 中；清除浏览器扩展数据或卸载扩展也会删除它们。</p></div>
              <div className="settings-section__control"><Button icon={Trash2} onClick={() => void clearLocalData()} variant="danger">清除本地数据</Button></div>
            </section>
            <section className="privacy-facts" aria-label="数据使用说明"><div><strong>文档内容</strong><p>只在你主动分享或上传时发送到当前连接器。</p></div><div><strong>配置同步</strong><p>所有设置均使用本地存储，不写入浏览器同步空间。</p></div><div><strong>网页权限</strong><p>读取网址时按站点单独申请，不在安装时请求访问全部网站。</p></div></section>
            {importMessage ? <p className="settings-message" role="status">{importMessage}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
