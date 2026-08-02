import { useEffect, useState } from 'react';
import { ArrowRight, FilePlus2, FileText, FolderOpen, Settings2, UploadCloud } from 'lucide-react';

import { useDestination } from '@/app/destination-context';
import type { PageProps } from '@/features/shared/page-props';
import { documentService } from '@/shared/persistence/document-service';
import type { DocumentRecord } from '@/shared/persistence/database';
import { Button } from '@/shared/ui/Button';

import './home-page.css';

function formatUpdatedAt(value: number): string {
  const diff = Date.now() - value;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value);
}

export function HomePage({ navigate }: PageProps) {
  const [recent, setRecent] = useState<DocumentRecord[]>([]);
  const { resetDestination } = useDestination();

  useEffect(() => {
    resetDestination();
    void documentService.recent(6).then(setRecent);
  }, [resetDestination]);

  const createDocument = async () => {
    const record = await documentService.create();
    navigate('markdown', new URLSearchParams({ document: record.id }));
  };

  return (
    <div className="home-page page-frame">
      <header className="page-intro home-intro">
        <div>
          <p className="page-kicker">Workbench</p>
          <h1>今天要处理什么？</h1>
          <p>打开文档、继续草稿，或把文件安全地分享出去。</p>
        </div>
        <Button icon={FilePlus2} onClick={() => void createDocument()} variant="primary">
          新建文档
        </Button>
      </header>

      <section className="quick-actions" aria-label="快速开始">
        <button
          className="quick-action quick-action--primary"
          onClick={() => navigate('markdown', new URLSearchParams({ intent: 'open' }))}
          type="button"
        >
          <span className="quick-action__icon"><FolderOpen aria-hidden="true" size={23} /></span>
          <span><strong>打开 Markdown</strong><small>从电脑选择文件或文件夹</small></span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        <button
          className="quick-action"
          onClick={() => navigate('files', new URLSearchParams({ intent: 'upload' }))}
          type="button"
        >
          <span className="quick-action__icon"><UploadCloud aria-hidden="true" size={23} /></span>
          <span><strong>上传文件</strong><small>需要先连接自己的存储</small></span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        <button className="quick-action" onClick={() => navigate('settings')} type="button">
          <span className="quick-action__icon"><Settings2 aria-hidden="true" size={23} /></span>
          <span><strong>整理工作台</strong><small>调整菜单、外观与存储</small></span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
      </section>

      <section className="home-section">
        <div className="section-heading">
          <div>
            <h2>最近文档</h2>
            <p>草稿只保存在当前浏览器中。</p>
          </div>
        </div>

        {recent.length === 0 ? (
          <div className="empty-state">
            <FileText aria-hidden="true" size={24} />
            <div><strong>还没有最近文档</strong><p>新建或打开一份 Markdown 后会出现在这里。</p></div>
          </div>
        ) : (
          <div className="recent-list">
            {recent.map((document) => (
              <button
                className="recent-row"
                key={document.id}
                onClick={() => navigate('markdown', new URLSearchParams({ document: document.id }))}
                type="button"
              >
                <span className="recent-row__icon"><FileText aria-hidden="true" size={18} /></span>
                <span className="recent-row__main">
                  <strong>{document.title}</strong>
                  <small>{document.sourceLabel}</small>
                </span>
                <span className="recent-row__status">
                  {document.draftUpdatedAt ? '有恢复草稿' : '最近打开'}
                </span>
                <time>{formatUpdatedAt(document.updatedAt)}</time>
                <ArrowRight aria-hidden="true" size={16} />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
