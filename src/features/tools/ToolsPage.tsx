import { useEffect, useState } from 'react';
import { ExternalLink, Link2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { browser } from 'wxt/browser';

import { useDestination } from '@/app/destination-context';
import { useSettings } from '@/app/settings-context';
import type { CustomTool } from '@/shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';

import './tools-page.css';

function parseWebUrl(value: string): string | null {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function ToolsPage() {
  const { settings, update } = useSettings();
  const { resetDestination } = useDestination();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [icon, setIcon] = useState('↗');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => resetDestination(), [resetDestination]);

  const resetForm = () => {
    setName('');
    setUrl('');
    setIcon('↗');
    setError('');
    setEditingId(null);
  };

  const saveTool = async () => {
    const normalizedUrl = parseWebUrl(url.trim());
    if (!name.trim()) {
      setError('请填写工具名称。');
      return;
    }
    if (!normalizedUrl) {
      setError('请填写有效的 http 或 https 地址。');
      return;
    }
    if (editingId) {
      await update({
        customTools: settings.customTools.map((tool) => tool.id === editingId
          ? { ...tool, name: name.trim(), url: normalizedUrl, icon: icon.trim() || '↗' }
          : tool),
      });
    } else {
      const id = nanoid();
      await update({
        customTools: [
          ...settings.customTools,
          { id, name: name.trim(), url: normalizedUrl, icon: icon.trim() || '↗', createdAt: Date.now() },
        ],
        menuOrder: [...settings.menuOrder, `tool:${id}`],
      });
    }
    resetForm();
  };

  const editTool = (tool: CustomTool) => {
    setEditingId(tool.id);
    setName(tool.name);
    setUrl(tool.url);
    setIcon(tool.icon || '↗');
    setError('');
  };

  const removeTool = async (id: string) => {
    await update({
      customTools: settings.customTools.filter((tool) => tool.id !== id),
      menuOrder: settings.menuOrder.filter((item) => item !== `tool:${id}`),
      hiddenCapabilities: settings.hiddenCapabilities.filter((item) => item !== `tool:${id}`),
      pinnedCapabilities: settings.pinnedCapabilities.filter((item) => item !== `tool:${id}`),
    });
    if (editingId === id) resetForm();
  };

  return (
    <div className="page-frame tools-page">
      <header className="page-intro">
        <div>
          <p className="page-kicker">我的工具</p>
          <h1>把常用网页放在顺手的位置</h1>
          <p>网页工具会在新标签页打开，不会获得 Workbench 中的文档和存储权限。</p>
        </div>
      </header>

      <section className="tool-form-section">
        <div className="section-heading">
          <div><h2>{editingId ? '编辑网页工具' : '添加网页工具'}</h2><p>名称、图标和地址以后都可以重新设置。</p></div>
        </div>
        <div className="tool-form">
          <label><span>图标</span><input aria-label="图标" maxLength={4} onChange={(event) => setIcon(event.target.value)} value={icon} /></label>
          <label><span>名称</span><input onChange={(event) => setName(event.target.value)} placeholder="例如：在线白板" value={name} /></label>
          <label className="tool-form__url"><span>网页地址</span><input onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" value={url} /></label>
          <div className="tool-form__actions">
            <Button icon={editingId ? Save : Plus} onClick={() => void saveTool()} variant="primary">{editingId ? '保存' : '添加'}</Button>
            {editingId ? <Button icon={X} onClick={resetForm} variant="quiet">取消</Button> : null}
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>

      <section className="tool-list-section">
        <div className="section-heading"><div><h2>已添加</h2><p>菜单顺序和显示状态在“设置 → 菜单与工具”中统一调整。</p></div></div>
        {settings.customTools.length === 0 ? (
          <div className="empty-state"><Link2 aria-hidden="true" size={24} /><div><strong>还没有网页工具</strong><p>添加后，它会同时出现在左侧菜单中。</p></div></div>
        ) : (
          <div className="custom-tool-list">
            {settings.customTools.map((tool) => (
              <div className="custom-tool-row" key={tool.id}>
                <span className="custom-tool-row__icon" aria-hidden="true">{tool.icon}</span>
                <span><strong>{tool.name}</strong><small>{tool.url}</small></span>
                <span className="custom-tool-row__actions">
                  <Button icon={ExternalLink} onClick={() => void browser.tabs.create({ url: tool.url })} size="small">打开</Button>
                  <IconButton icon={Pencil} label={`编辑 ${tool.name}`} onClick={() => editTool(tool)} />
                  <IconButton icon={Trash2} label={`移除 ${tool.name}`} onClick={() => void removeTool(tool.id)} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
