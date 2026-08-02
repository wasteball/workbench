import { useMemo } from 'react';
import { diffWordsWithSpace } from 'diff';
import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';

import type { ReviewChange } from '@/features/markdown/engine/review-changes';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';

import './change-review-panel.css';

const CHANGE_LABELS = {
  added: '新增',
  modified: '修改',
  removed: '删除',
} as const;

function excerpt(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '空白内容';
  return compact.length > 90 ? `${compact.slice(0, 90)}…` : compact;
}

function InlineDiff({ before, after, side }: { before: string; after: string; side: 'before' | 'after' }) {
  const parts = useMemo(() => diffWordsWithSpace(before, after), [after, before]);
  return parts.map((part, index) => {
    if (side === 'before' && part.added) return null;
    if (side === 'after' && part.removed) return null;
    if (part.removed) return <del key={index}>{part.value}</del>;
    if (part.added) return <ins key={index}>{part.value}</ins>;
    return <span key={index}>{part.value}</span>;
  });
}

export function ChangeReviewPanel({
  changes,
  current,
  onClose,
  onSelect,
  onStep,
  onRevert,
  onRevertAll,
}: {
  changes: ReviewChange[];
  current: number;
  onClose: () => void;
  onSelect: (index: number) => void;
  onStep: (direction: -1 | 1) => void;
  onRevert: (change: ReviewChange) => void;
  onRevertAll: () => void;
}) {
  const counts = changes.reduce((result, change) => ({ ...result, [change.kind]: result[change.kind] + 1 }), { added: 0, modified: 0, removed: 0 });

  return (
    <aside aria-label="改动审阅" className="change-review-panel">
      <header className="change-review-panel__header">
        <div><strong>改动审阅</strong><small>{changes.length > 0 ? `${changes.length} 处尚未保存` : '当前内容与上次保存一致'}</small></div>
        <div className="change-review-panel__nav">
          <IconButton disabled={changes.length === 0} icon={ChevronUp} label="上一处改动" onClick={() => onStep(-1)} />
          <span>{changes.length > 0 ? `${current + 1}/${changes.length}` : '0/0'}</span>
          <IconButton disabled={changes.length === 0} icon={ChevronDown} label="下一处改动" onClick={() => onStep(1)} />
          <IconButton icon={X} label="关闭改动审阅" onClick={onClose} />
        </div>
      </header>

      <div className="change-review-panel__summary" aria-label="改动统计">
        <span data-kind="added">+{counts.added} 新增</span>
        <span data-kind="modified">~{counts.modified} 修改</span>
        <span data-kind="removed">-{counts.removed} 删除</span>
      </div>

      {changes.length === 0 ? (
        <div className="change-review-panel__empty"><strong>没有未保存的改动</strong><p>开始编辑后，改动会按位置列在这里。</p></div>
      ) : (
        <div className="change-review-list">
          {changes.map((change, index) => (
            <div className={`change-review-item ${index === current ? 'change-review-item--active' : ''}`} data-kind={change.kind} key={change.id}>
              <button aria-current={index === current ? 'true' : undefined} className="change-review-item__trigger" onClick={() => onSelect(index)} type="button">
                <span className="change-review-item__badge">{change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : '~'}</span>
                <span><strong>第 {change.newStartLine} 行 · {CHANGE_LABELS[change.kind]}</strong><small>{excerpt(change.after || change.before)}</small></span>
              </button>
              {index === current ? (
                <div className="change-review-detail">
                  {change.before ? <div><span>原来</span><pre><InlineDiff after={change.after} before={change.before} side="before" /></pre></div> : null}
                  {change.after ? <div><span>现在</span><pre><InlineDiff after={change.after} before={change.before} side="after" /></pre></div> : null}
                  <Button icon={RotateCcw} onClick={() => onRevert(change)} size="small">撤回这处</Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {changes.length > 0 ? <footer><Button icon={RotateCcw} onClick={onRevertAll} size="small" variant="danger">撤回全部</Button></footer> : null}
    </aside>
  );
}
