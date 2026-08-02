import { ChevronsUpDown, ChevronDown, ChevronUp, RotateCcw, Save, X } from 'lucide-react';

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

export function ChangeReviewPanel({
  changes,
  current,
  onClose,
  onSelect,
  onStep,
  onRevert,
  onRevertAll,
  onSave,
  showMarks,
  showAll,
  onShowMarksChange,
  onShowAllChange,
  destinationLabel,
}: {
  changes: ReviewChange[];
  current: number;
  onClose: () => void;
  onSelect: (index: number) => void;
  onStep: (direction: -1 | 1) => void;
  onRevert: (change: ReviewChange) => void;
  onRevertAll: () => void;
  onSave: () => void;
  showMarks: boolean;
  showAll: boolean;
  onShowMarksChange: (value: boolean) => void;
  onShowAllChange: (value: boolean) => void;
  destinationLabel: string;
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
          <IconButton active={showAll} disabled={changes.length === 0} icon={ChevronsUpDown} label={showAll ? '收起正文中的全部改动' : '在正文中展开全部改动'} onClick={() => onShowAllChange(!showAll)} />
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
        <><p className="change-review-panel__destination">保存后：{destinationLabel}</p><div className="change-review-list">
          {changes.map((change, index) => (
            <div className={`change-review-item ${index === current ? 'change-review-item--active' : ''}`} data-kind={change.kind} key={change.id}>
              <button aria-current={index === current ? 'true' : undefined} className="change-review-item__trigger" onClick={() => onSelect(index)} type="button">
                <span className="change-review-item__badge">{change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : '~'}</span>
                <span><strong>第 {change.newStartLine} 行 · {CHANGE_LABELS[change.kind]}</strong><small>{excerpt(change.after || change.before)}</small></span>
              </button>
              <button className="change-review-item__undo" onClick={() => onRevert(change)} title="把这一处恢复到上次保存的样子" type="button">撤回</button>
            </div>
          ))}
        </div></>
      )}

      <footer>
        <label><input checked={showMarks} onChange={(event) => onShowMarksChange(event.target.checked)} type="checkbox" /><span>正文里显示标记</span></label>
        {changes.length > 0 ? <><Button icon={RotateCcw} onClick={onRevertAll} size="small" variant="danger">撤回全部</Button><Button icon={Save} onClick={onSave} size="small" variant="primary">保存（接受全部）</Button></> : null}
      </footer>
    </aside>
  );
}
