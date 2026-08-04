import { useEffect, useRef } from 'react';
import { Copy, Settings, Share2, X } from 'lucide-react';

import type { ExportFormat } from '@/features/markdown/exporters/contract';
import type { DocumentShareAccess } from '@/features/markdown/services/share-markdown-document';
import type { StorageProfile } from '@/shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';

import './share-document-dialog.css';

const FORMAT_HELP: Record<ExportFormat, string> = {
  html: '对方打开链接即可阅读，适合直接分享。',
  docx: '对方下载后可用 Word 打开和继续编辑。',
  markdown: '保留原始 Markdown 文本和语法。',
};

export function ShareDocumentDialog({
  open,
  title,
  format,
  access,
  profile,
  storageReady,
  busy,
  error,
  generatedUrl,
  onFormatChange,
  onAccessChange,
  onConfirm,
  onCopyGenerated,
  onOpenSettings,
  onClose,
}: {
  open: boolean;
  title: string;
  format: ExportFormat;
  access: DocumentShareAccess;
  profile: StorageProfile | undefined;
  storageReady: boolean;
  busy: boolean;
  error: string;
  generatedUrl: string;
  onFormatChange: (format: ExportFormat) => void;
  onAccessChange: (access: DocumentShareAccess) => void;
  onConfirm: () => void;
  onCopyGenerated: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKey);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="share-document-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section aria-describedby="share-document-description" aria-labelledby="share-document-title" aria-modal="true" className="share-document-dialog" ref={dialogRef} role="dialog">
        <header>
          <span className="share-document-dialog__mark"><Share2 aria-hidden="true" size={19} /></span>
          <div><h2 id="share-document-title">分享这篇文档</h2><p id="share-document-description" title={title}>{title}</p></div>
          <IconButton disabled={busy} icon={X} label="关闭分享" onClick={onClose} />
        </header>

        <div className="share-document-field">
          <span>分享格式</span>
          <div aria-label="分享格式" className="share-document-segments" role="group">
            <button aria-pressed={format === 'html'} disabled={busy || Boolean(generatedUrl)} onClick={() => onFormatChange('html')} type="button">HTML 网页</button>
            <button aria-pressed={format === 'docx'} disabled={busy || Boolean(generatedUrl)} onClick={() => onFormatChange('docx')} type="button">Word 文档</button>
            <button aria-pressed={format === 'markdown'} disabled={busy || Boolean(generatedUrl)} onClick={() => onFormatChange('markdown')} type="button">Markdown</button>
          </div>
          <small>{FORMAT_HELP[format]}</small>
        </div>

        {profile?.provider === 'aliyun-oss' ? (
          <div className="share-document-field">
            <span>访问方式</span>
            <div aria-label="访问方式" className="share-document-segments share-document-segments--access" role="group">
              <button aria-pressed={access === 'private'} disabled={busy || Boolean(generatedUrl)} onClick={() => onAccessChange('private')} type="button">限时链接</button>
              <button aria-pressed={access === 'public'} disabled={busy || Boolean(generatedUrl)} onClick={() => onAccessChange('public')} type="button">公开链接</button>
            </div>
          </div>
        ) : profile ? <p className="share-document-provider">通过“{profile.name}”分享，访问范围由当前存储服务决定。</p> : null}

        {!storageReady ? (
          <div className="share-document-warning"><span>分享前需要先连接存储。</span><Button icon={Settings} onClick={onOpenSettings} size="small">连接存储</Button></div>
        ) : null}

        {generatedUrl ? (
          <label className="share-document-result"><span>分享链接已生成</span><input aria-label="已生成的分享链接" readOnly value={generatedUrl} /></label>
        ) : null}

        {error ? <p className="share-document-error" role="alert">{error}</p> : null}

        <footer>
          <Button disabled={busy} onClick={onClose}>{generatedUrl ? '完成' : '取消'}</Button>
          {generatedUrl
            ? <Button icon={Copy} onClick={onCopyGenerated} variant="primary">复制分享内容</Button>
            : <Button disabled={busy || !storageReady} icon={Share2} onClick={onConfirm} variant="primary">{busy ? '正在生成' : '生成并复制链接'}</Button>}
        </footer>
      </section>
    </div>
  );
}
