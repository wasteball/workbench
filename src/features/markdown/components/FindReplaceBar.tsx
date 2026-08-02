import { useEffect, useRef } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Replace, X } from 'lucide-react';

import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';

import './find-replace-bar.css';

export function FindReplaceBar({
  open,
  replaceOpen,
  query,
  replacement,
  matchCase,
  current,
  total,
  onClose,
  onQueryChange,
  onReplacementChange,
  onMatchCaseChange,
  onReplaceOpenChange,
  onStep,
  onReplaceOne,
  onReplaceAll,
}: {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  current: number;
  total: number;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onReplacementChange: (value: string) => void;
  onMatchCaseChange: (value: boolean) => void;
  onReplaceOpenChange: (value: boolean) => void;
  onStep: (direction: -1 | 1) => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [open]);

  if (!open) return null;

  return (
    <section aria-label="查找和替换" className="find-replace-bar" role="search">
      <div className="find-replace-bar__line">
        <IconButton active={replaceOpen} icon={Replace} label={replaceOpen ? '隐藏替换' : '显示替换'} onClick={() => onReplaceOpenChange(!replaceOpen)} />
        <label className="find-replace-bar__input">
          <span className="sr-only">查找</span>
          <input
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onStep(event.shiftKey ? -1 : 1);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="查找"
            ref={inputRef}
            value={query}
          />
          <small aria-live="polite">{total > 0 ? `${current + 1} / ${total}` : '0 / 0'}</small>
        </label>
        <IconButton active={matchCase} aria-pressed={matchCase} icon={CaseSensitive} label="区分大小写" onClick={() => onMatchCaseChange(!matchCase)} />
        <IconButton disabled={total === 0} icon={ChevronUp} label="上一处" onClick={() => onStep(-1)} />
        <IconButton disabled={total === 0} icon={ChevronDown} label="下一处" onClick={() => onStep(1)} />
        <IconButton icon={X} label="关闭查找" onClick={onClose} />
      </div>
      {replaceOpen ? (
        <div className="find-replace-bar__line find-replace-bar__replace">
          <span aria-hidden="true" className="find-replace-bar__indent" />
          <label className="find-replace-bar__input">
            <span className="sr-only">替换为</span>
            <input
              onChange={(event) => onReplacementChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (event.ctrlKey || event.metaKey) onReplaceAll();
                  else onReplaceOne();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onClose();
                }
              }}
              placeholder="替换为"
              value={replacement}
            />
          </label>
          <Button disabled={total === 0} onClick={onReplaceOne} size="small">替换</Button>
          <Button disabled={total === 0} onClick={onReplaceAll} size="small" variant="primary">全部替换</Button>
        </div>
      ) : null}
    </section>
  );
}
