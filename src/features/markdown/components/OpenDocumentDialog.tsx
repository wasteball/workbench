import { useEffect, useState } from 'react';
import { FileText, FolderOpen, Globe2, X } from 'lucide-react';

import {
  pickMarkdownDirectory,
  pickMarkdownFiles,
  type PickedMarkdownFile,
} from '@/platform/files/file-picker';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';

import './open-document-dialog.css';

export function OpenDocumentDialog({
  open,
  sourceMode = 'all',
  onClose,
  onFiles,
  onUrl,
}: {
  open: boolean;
  sourceMode?: 'all' | 'url';
  onClose: () => void;
  onFiles: (files: PickedMarkdownFile[]) => Promise<void>;
  onUrl: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  const choose = async (directory: boolean) => {
    setBusy(true);
    setError('');
    try {
      const files = directory ? await pickMarkdownDirectory() : await pickMarkdownFiles();
      if (files.length > 0) {
        await onFiles(files);
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开所选内容。');
    } finally {
      setBusy(false);
    }
  };

  const submitUrl = async () => {
    if (!url.trim()) {
      setError('请粘贴 Markdown 地址。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onUrl(url.trim());
      onClose();
      setUrl('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取这个地址。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section aria-labelledby="open-document-title" aria-modal="true" className="open-document-dialog" role="dialog">
        <header><div><p className="page-kicker">打开 Markdown</p><h2 id="open-document-title">{sourceMode === 'url' ? '从网址打开' : '选择内容来源'}</h2></div><IconButton disabled={busy} icon={X} label="关闭" onClick={onClose} /></header>
        {sourceMode === 'all' ? (
          <div className="open-source-actions">
            <button disabled={busy} onClick={() => void choose(false)} type="button"><FileText aria-hidden="true" size={22} /><span><strong>Markdown 文件</strong><small>可一次选择多个文件</small></span></button>
            <button disabled={busy} onClick={() => void choose(true)} type="button"><FolderOpen aria-hidden="true" size={22} /><span><strong>整个文件夹</strong><small>读取其中的 Markdown 文档</small></span></button>
          </div>
        ) : null}
        <div className="open-url-form">
          <label className="settings-field"><span>从网址读取</span><span className="url-input-row"><Globe2 aria-hidden="true" size={18} /><input disabled={busy} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitUrl(); }} placeholder="支持 Markdown 直链、GitHub 文件页和 Gist" value={url} /></span></label>
          <Button disabled={busy} onClick={() => void submitUrl()} variant="primary">{busy ? '正在读取' : '打开网址'}</Button>
        </div>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <footer>从网址读取时，只会申请对应网站的访问权限。</footer>
      </section>
    </div>
  );
}
