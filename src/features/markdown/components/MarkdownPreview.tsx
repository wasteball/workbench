import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  Code2,
  Copy,
  GripVertical,
  Italic,
  Link,
  Plus,
  RemoveFormatting,
  Strikethrough,
  Trash2,
  X,
} from 'lucide-react';

import { useSettings } from '@/app/settings-context';
import { enhanceMermaidDiagrams } from '@/features/markdown/components/enhance-mermaid';
import { findTextMatches } from '@/features/markdown/engine/find-replace';
import { renderMarkdown, type MarkdownBlock } from '@/features/markdown/engine/render-markdown';
import type { ReviewChange } from '@/features/markdown/engine/review-changes';
import {
  canEditBlockRichly,
  duplicateMarkdownBlock,
  insertMarkdownAfterBlock,
  markdownFromEditableBlock,
  moveMarkdownBlock,
  replaceMarkdownBlock,
  sourceLabelForBlock,
  updateMarkdownTableCell,
} from '@/features/markdown/engine/rich-edit';
import { IconButton } from '@/shared/ui/IconButton';
import 'katex/dist/katex.min.css';
import './markdown-preview.css';

interface MarkdownPreviewProps {
  html: string;
  markdown: string;
  blocks: MarkdownBlock[];
  editable?: boolean;
  onMarkdownChange?: (markdown: string) => void;
  onTaskToggle?: (taskIndex: number, checked: boolean) => void;
  search?: {
    query: string;
    matchCase: boolean;
    current: number;
  };
  review?: {
    changes: ReviewChange[];
    current: number;
    showMarks: boolean;
    showAll: boolean;
    showCurrent: boolean;
    onSelect: (index: number) => void;
    onStep: (direction: -1 | 1) => void;
    onRevert: (change: ReviewChange) => void;
    onCollapseInline: () => void;
  };
}

export interface MarkdownPreviewHandle {
  commitActiveEdit: () => void;
  cancelActiveEdit: () => boolean;
}

interface ActiveRichBlock {
  element: HTMLElement;
  block: MarkdownBlock;
  initialHtml: string;
  pending: boolean;
}

interface ActiveTableCell {
  element: HTMLTableCellElement;
  block: MarkdownBlock;
  row: number;
  column: number;
  initialValue: string;
}

interface SourceEditorState {
  element: HTMLElement;
  block: MarkdownBlock;
  value: string;
}

interface FloatingPosition {
  top: number;
  left: number;
}

interface BlockToolsState extends FloatingPosition {
  index: number;
}

const SEARCH_HIGHLIGHT = 'workbench-find-match';
const CURRENT_SEARCH_HIGHLIGHT = 'workbench-find-current';
const SEARCH_SKIP = 'button, .mermaid-figure__source, .inline-review-card, .block-source-editor, .markdown-block-tools, .rich-selection-toolbar';

const PreviewBody = memo(forwardRef<HTMLDivElement, { html: string }>(function PreviewBody({ html }, ref) {
  return <div className="markdown-preview__body" dangerouslySetInnerHTML={{ __html: html }} ref={ref} />;
}));

function unwrapSearchMarks(root: HTMLElement) {
  root.querySelectorAll('mark[data-workbench-search]').forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent ?? '')));
  root.normalize();
}

function findReviewTarget(body: HTMLElement, change: ReviewChange): HTMLElement | null {
  const blocks = [...body.querySelectorAll<HTMLElement>('.markdown-block')];
  const direct = blocks.find((block) => {
    const from = Number(block.dataset.sourceFrom);
    const to = Number(block.dataset.sourceTo);
    return change.currentFrom < to && Math.max(change.currentTo, change.currentFrom + 1) > from;
  });
  if (direct) return direct;
  return blocks.find((block) => Number(block.dataset.sourceFrom) >= change.currentFrom) ?? blocks.at(-1) ?? null;
}

function placeCaret(element: HTMLElement, x?: number, y?: number) {
  element.focus();
  try {
    let range: Range | null = null;
    if (x !== undefined && y !== undefined) {
      const pointRange = document.caretRangeFromPoint?.(x, y);
      if (pointRange && element.contains(pointRange.startContainer)) range = pointRange;
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // Some browsers do not expose caretRangeFromPoint inside extension pages.
  }
}

function formatInlineCode(range: Range) {
  const selection = window.getSelection();
  const host = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
  const existing = host?.closest('code');
  if (existing) {
    const text = document.createTextNode(existing.textContent ?? '');
    existing.replaceWith(text);
    const next = document.createRange();
    next.selectNodeContents(text);
    selection?.removeAllRanges();
    selection?.addRange(next);
    return;
  }
  const code = document.createElement('code');
  code.append(range.extractContents());
  range.insertNode(code);
  const next = document.createRange();
  next.selectNodeContents(code);
  selection?.removeAllRanges();
  selection?.addRange(next);
}

export const MarkdownPreview = memo(forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(function MarkdownPreview({
  html,
  markdown,
  blocks,
  editable = false,
  onMarkdownChange,
  onTaskToggle,
  search,
  review,
}, ref) {
  const { settings } = useSettings();
  const bodyRef = useRef<HTMLDivElement>(null);
  const activeRich = useRef<ActiveRichBlock | null>(null);
  const activeCell = useRef<ActiveTableCell | null>(null);
  const savedRange = useRef<Range | null>(null);
  const selectionToolsRef = useRef<FloatingPosition | null>(null);
  const markdownRef = useRef(markdown);
  const blocksRef = useRef(blocks);
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  const [sourceEditor, setSourceEditor] = useState<SourceEditorState | null>(null);
  const [blockTools, setBlockTools] = useState<BlockToolsState | null>(null);
  const [blockMenu, setBlockMenu] = useState<BlockToolsState | null>(null);
  const [selectionTools, setSelectionTools] = useState<FloatingPosition | null>(null);
  const [linkEditor, setLinkEditor] = useState<{ position: FloatingPosition; value: string } | null>(null);

  markdownRef.current = markdown;
  blocksRef.current = blocks;
  onMarkdownChangeRef.current = onMarkdownChange;
  selectionToolsRef.current = selectionTools;

  const searchQuery = search?.query ?? '';
  const searchMatchCase = search?.matchCase ?? false;
  const searchCurrent = search?.current ?? 0;

  const finishCellEdit = useCallback((commit: boolean) => {
    const active = activeCell.current;
    if (!active) return;
    activeCell.current = null;
    const value = (active.element.textContent ?? '').replace(/\s*\n+\s*/g, '<br>').trim();
    active.element.removeAttribute('contenteditable');
    active.element.classList.remove('markdown-table-cell--editing');
    if (!commit) {
      active.element.textContent = active.initialValue;
      return;
    }
    if (value === active.initialValue) return;
    const updatedTable = updateMarkdownTableCell(active.block.raw, active.row, active.column, value);
    if (!updatedTable) return;
    onMarkdownChangeRef.current?.(replaceMarkdownBlock(markdownRef.current, active.block, updatedTable));
  }, []);

  const finishRichEdit = useCallback((commit: boolean) => {
    const active = activeRich.current;
    if (!active) return;
    activeRich.current = null;
    setSelectionTools(null);
    setLinkEditor(null);
    const connected = active.element.isConnected;
    if (connected) {
      active.element.removeAttribute('contenteditable');
      active.element.classList.remove('markdown-block--editing');
    }
    if (!commit) {
      if (active.pending) active.element.remove();
      else if (connected) active.element.innerHTML = active.initialHtml;
      return;
    }
    const nextBlock = markdownFromEditableBlock(active.element);
    if (active.pending) {
      active.element.remove();
      if (nextBlock.trim()) onMarkdownChangeRef.current?.(insertMarkdownAfterBlock(markdownRef.current, active.block, nextBlock));
      return;
    }
    if (active.element.innerHTML === active.initialHtml) return;
    onMarkdownChangeRef.current?.(replaceMarkdownBlock(markdownRef.current, active.block, nextBlock));
  }, []);

  const finishSourceEdit = useCallback((commit: boolean) => {
    if (!sourceEditor) return;
    sourceEditor.element.classList.remove('markdown-block--source-editing');
    if (commit) {
      const next = replaceMarkdownBlock(markdownRef.current, sourceEditor.block, sourceEditor.value);
      if (next !== markdownRef.current) onMarkdownChangeRef.current?.(next);
    }
    setSourceEditor(null);
  }, [sourceEditor]);

  useImperativeHandle(ref, () => ({
    commitActiveEdit: () => {
      finishCellEdit(true);
      finishRichEdit(true);
      finishSourceEdit(true);
    },
    cancelActiveEdit: () => {
      const hasActiveEdit = Boolean(activeCell.current || activeRich.current || sourceEditor);
      finishCellEdit(false);
      finishRichEdit(false);
      finishSourceEdit(false);
      return hasActiveEdit;
    },
  }), [finishCellEdit, finishRichEdit, finishSourceEdit, sourceEditor]);

  const beginRichEdit = useCallback((element: HTMLElement, block: MarkdownBlock, x?: number, y?: number) => {
    if (activeRich.current?.element === element) return;
    finishCellEdit(true);
    finishRichEdit(true);
    setSourceEditor(null);
    element.setAttribute('contenteditable', 'true');
    element.classList.add('markdown-block--editing');
    activeRich.current = { element, block, initialHtml: element.innerHTML, pending: false };
    placeCaret(element, x, y);
  }, [finishCellEdit, finishRichEdit]);

  const beginPendingBlock = useCallback((block: MarkdownBlock) => {
    finishCellEdit(true);
    finishRichEdit(true);
    setSourceEditor(null);
    const current = bodyRef.current?.querySelector<HTMLElement>(`.markdown-block[data-block-index="${block.index}"]`);
    if (!current) return;
    const pending = document.createElement('div');
    pending.className = 'markdown-block markdown-block--pending markdown-block--editing';
    pending.dataset.blockType = 'paragraph';
    pending.setAttribute('contenteditable', 'true');
    pending.innerHTML = '<p><br></p>';
    current.insertAdjacentElement('afterend', pending);
    activeRich.current = { element: pending, block, initialHtml: pending.innerHTML, pending: true };
    placeCaret(pending);
  }, [finishCellEdit, finishRichEdit]);

  const beginCellEdit = useCallback((cell: HTMLTableCellElement, block: MarkdownBlock) => {
    if (activeCell.current?.element === cell) return;
    finishRichEdit(true);
    finishCellEdit(true);
    setSourceEditor(null);
    const rowElement = cell.parentElement as HTMLTableRowElement | null;
    const table = cell.closest('table');
    if (!rowElement || !table) return;
    const row = rowElement.parentElement?.tagName === 'THEAD'
      ? -1
      : [...(table.tBodies[0]?.rows ?? [])].indexOf(rowElement);
    const initialValue = cell.textContent?.trim() ?? '';
    activeCell.current = { element: cell, block, row, column: cell.cellIndex, initialValue };
    cell.textContent = initialValue;
    cell.setAttribute('contenteditable', 'true');
    cell.classList.add('markdown-table-cell--editing');
    placeCaret(cell);
  }, [finishCellEdit, finishRichEdit]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let active = true;
    const controller = new AbortController();
    const cleanups: Array<() => void> = [];
    const enhance = async () => {
      const diagramCleanups = await enhanceMermaidDiagrams(body, controller.signal);
      if (!active) {
        diagramCleanups.forEach((cleanup) => cleanup());
        return;
      }
      cleanups.push(...diagramCleanups);

      if (onTaskToggle) {
        body.querySelectorAll<HTMLInputElement>('li.task-list-item > input[type="checkbox"]').forEach((checkbox, taskIndex) => {
          checkbox.removeAttribute('disabled');
          checkbox.classList.add('markdown-task-checkbox');
          const updateLabel = () => checkbox.setAttribute('aria-label', checkbox.checked ? '标记任务为未完成' : '标记任务为已完成');
          const handleChange = () => {
            updateLabel();
            onTaskToggle(taskIndex, checkbox.checked);
          };
          updateLabel();
          checkbox.addEventListener('change', handleChange);
          cleanups.push(() => checkbox.removeEventListener('change', handleChange));
        });
      }

      body.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
        if (pre.closest('.mermaid-figure')) return;
        const button = document.createElement('button');
        button.className = 'code-copy-button';
        button.type = 'button';
        button.textContent = '复制';
        button.title = '复制代码';
        const handleCopy = () => {
          const source = pre.querySelector('code')?.textContent ?? '';
          void navigator.clipboard.writeText(source).then(() => {
            button.textContent = '已复制';
            window.setTimeout(() => { button.textContent = '复制'; }, 1_200);
          });
        };
        button.addEventListener('click', handleCopy);
        pre.append(button);
        cleanups.push(() => {
          button.removeEventListener('click', handleCopy);
          button.remove();
        });
      });
    };

    void enhance();
    return () => {
      active = false;
      controller.abort();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [html, onTaskToggle]);

  useEffect(() => {
    const body = bodyRef.current;
    const registry = CSS.highlights;
    registry?.delete(SEARCH_HIGHLIGHT);
    registry?.delete(CURRENT_SEARCH_HIGHLIGHT);
    if (!body) return;
    unwrapSearchMarks(body);
    if (!searchQuery) return;

    const matches: Array<{ node: Text; from: number; to: number }> = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue || parent.closest(SEARCH_SKIP)) return NodeFilter.FILTER_REJECT;
        if (parent.offsetParent === null) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      for (const match of findTextMatches(node.data, searchQuery, searchMatchCase)) matches.push({ node, from: match.from, to: match.to });
    }
    if (matches.length === 0) return;
    const currentIndex = ((searchCurrent % matches.length) + matches.length) % matches.length;

    if (registry && typeof Highlight !== 'undefined') {
      const ranges = matches.map((match) => {
        const range = document.createRange();
        range.setStart(match.node, match.from);
        range.setEnd(match.node, match.to);
        return range;
      });
      registry.set(SEARCH_HIGHLIGHT, new Highlight(...ranges));
      const current = ranges[currentIndex];
      if (current) {
        registry.set(CURRENT_SEARCH_HIGHLIGHT, new Highlight(current));
        window.requestAnimationFrame(() => current.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }
    } else {
      const byNode = new Map<Text, Array<{ from: number; to: number; index: number }>>();
      matches.forEach((match, index) => byNode.set(match.node, [...(byNode.get(match.node) ?? []), { from: match.from, to: match.to, index }]));
      for (const [node, nodeMatches] of byNode) {
        for (const match of [...nodeMatches].reverse()) {
          const selected = node.splitText(match.from);
          selected.splitText(match.to - match.from);
          const mark = document.createElement('mark');
          mark.dataset.workbenchSearch = '';
          mark.className = match.index === currentIndex ? 'workbench-search-mark workbench-search-mark--current' : 'workbench-search-mark';
          selected.replaceWith(mark);
          mark.append(selected);
        }
      }
      window.requestAnimationFrame(() => body.querySelector('.workbench-search-mark--current')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }

    return () => {
      registry?.delete(SEARCH_HIGHLIGHT);
      registry?.delete(CURRENT_SEARCH_HIGHLIGHT);
      unwrapSearchMarks(body);
    };
  }, [searchCurrent, searchMatchCase, searchQuery]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !review) return;
    let active = true;
    const inserted: HTMLElement[] = [];
    body.querySelectorAll<HTMLElement>('.markdown-block').forEach((block) => block.removeAttribute('data-review-kind'));

    review.changes.forEach((change) => {
      if (!review.showMarks) return;
      findReviewTarget(body, change)?.setAttribute('data-review-kind', change.kind);
    });

    const indexes = review.showAll
      ? review.changes.map((_, index) => index)
      : review.showCurrent && review.changes[review.current] ? [review.current] : [];
    void Promise.all(indexes.map(async (index) => {
      const change = review.changes[index];
      if (!change || !active) return;
      const target = findReviewTarget(body, change);
      const card = document.createElement('section');
      card.className = 'inline-review-card';
      card.dataset.kind = change.kind;
      card.dataset.reviewIndex = String(index);
      const header = document.createElement('header');
      const badge = change.kind === 'added' ? '新增' : change.kind === 'removed' ? '删除' : '原来';
      const context = change.kind === 'added' ? '原来没有这一块，下面是现在的内容' : change.kind === 'removed' ? '这里原来的内容已被删除' : '下面是现在的内容';
      header.innerHTML = `<strong>${badge}</strong><span>${context}</span>`;
      card.append(header);
      if (change.before) {
        const ghost = document.createElement('div');
        ghost.className = 'inline-review-card__ghost';
        ghost.innerHTML = (await renderMarkdown(change.before)).html;
        card.append(ghost);
      }
      const actions = document.createElement('footer');
      const revert = document.createElement('button');
      revert.type = 'button';
      revert.textContent = change.kind === 'removed' ? '恢复这处' : '撤回这处';
      revert.addEventListener('click', () => review.onRevert(change));
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.textContent = '↑';
      previous.title = '上一处改动';
      previous.setAttribute('aria-label', '上一处改动');
      previous.addEventListener('click', () => review.onStep(-1));
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = '↓';
      next.title = '下一处改动';
      next.setAttribute('aria-label', '下一处改动');
      next.addEventListener('click', () => review.onStep(1));
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '收起';
      close.addEventListener('click', review.onCollapseInline);
      actions.append(revert, previous, next, close);
      card.append(actions);
      if (!active) return;
      if (target) target.before(card);
      else body.append(card);
      inserted.push(card);
    }));

    const selected = review.showAll || review.showCurrent ? review.changes[review.current] : undefined;
    if (selected) {
      window.requestAnimationFrame(() => findReviewTarget(body, selected)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }

    return () => {
      active = false;
      inserted.forEach((element) => element.remove());
      body.querySelectorAll<HTMLElement>('.markdown-block').forEach((block) => block.removeAttribute('data-review-kind'));
    };
  }, [html, review]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !editable) {
      finishCellEdit(true);
      finishRichEdit(true);
      setSourceEditor(null);
      setBlockTools(null);
      return;
    }

    const blockForElement = (element: HTMLElement) => {
      const index = Number(element.dataset.blockIndex);
      return blocksRef.current.find((block) => block.index === index);
    };

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.block-source-editor, .rich-selection-toolbar, .markdown-block-tools')) return;
      const element = target.closest<HTMLElement>('.markdown-block');
      const block = element && blockForElement(element);
      if (!element || !block || element.classList.contains('markdown-block--pending')) return;
      const rect = element.getBoundingClientRect();
      setBlockTools({ index: block.index, top: Math.max(4, rect.top + 2), left: Math.max(4, rect.left - 62) });
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('a, button, input, .mermaid-figure__viewport, .mermaid-figure__actions, .block-source-editor, .rich-selection-toolbar, .markdown-block-tools, .inline-review-card')) return;
      const element = target.closest<HTMLElement>('.markdown-block');
      const block = element && blockForElement(element);
      if (!element || !block) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      const cell = target.closest<HTMLTableCellElement>('td, th');
      if (cell && element.contains(cell)) {
        beginCellEdit(cell, block);
        return;
      }
      if (canEditBlockRichly(element)) beginRichEdit(element, block, event.clientX, event.clientY);
      else {
        finishCellEdit(true);
        finishRichEdit(true);
        element.classList.add('markdown-block--source-editing');
        setSourceEditor({ element, block, value: block.raw });
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeCell.current) {
        if (event.key === 'Escape') {
          event.preventDefault();
          finishCellEdit(false);
        } else if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          finishCellEdit(true);
        }
        return;
      }
      if (!activeRich.current) return;
      const meta = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape') {
        event.preventDefault();
        finishRichEdit(false);
      } else if (meta && event.key.toLocaleLowerCase() === 'b') {
        event.preventDefault();
        document.execCommand('bold');
      } else if (meta && event.key.toLocaleLowerCase() === 'i') {
        event.preventDefault();
        document.execCommand('italic');
      } else if (meta && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        const selection = window.getSelection();
        if (selection?.rangeCount) savedRange.current = selection.getRangeAt(0).cloneRange();
        const position = selectionToolsRef.current;
        setLinkEditor(position ? { position, value: '' } : null);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as HTMLElement | null;
      if (next?.closest('.rich-selection-toolbar, .rich-link-editor, .markdown-block-tools, .block-source-editor')) return;
      if (activeCell.current && !activeCell.current.element.contains(next)) finishCellEdit(true);
      if (activeRich.current && !activeRich.current.element.contains(next)) finishRichEdit(true);
    };

    body.addEventListener('mouseover', handleMouseOver);
    body.addEventListener('click', handleClick);
    body.addEventListener('keydown', handleKeyDown);
    body.addEventListener('focusout', handleFocusOut);
    return () => {
      body.removeEventListener('mouseover', handleMouseOver);
      body.removeEventListener('click', handleClick);
      body.removeEventListener('keydown', handleKeyDown);
      body.removeEventListener('focusout', handleFocusOut);
    };
  }, [beginCellEdit, beginRichEdit, editable, finishCellEdit, finishRichEdit, html]);

  useEffect(() => {
    if (!editable) return;
    const handleSelectionChange = () => {
      const active = activeRich.current;
      const selection = window.getSelection();
      if (!active || !selection?.rangeCount || selection.isCollapsed || !active.element.contains(selection.anchorNode)) {
        setSelectionTools(null);
        if (!linkEditor) setLinkEditor(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      savedRange.current = range.cloneRange();
      setSelectionTools({ top: Math.max(6, rect.top - 44), left: Math.max(6, Math.min(window.innerWidth - 270, rect.left + rect.width / 2 - 132)) });
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [editable, linkEditor]);

  useEffect(() => {
    activeRich.current = null;
    activeCell.current = null;
    setSourceEditor(null);
    setSelectionTools(null);
    setLinkEditor(null);
    setBlockMenu(null);
  }, [html]);

  const restoreSelection = () => {
    const range = savedRange.current;
    if (!range || !activeRich.current) return null;
    activeRich.current.element.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return range;
  };

  const applyFormat = (command: 'bold' | 'italic' | 'strikeThrough' | 'removeFormat' | 'code') => {
    const range = restoreSelection();
    if (!range) return;
    if (command === 'code') formatInlineCode(range);
    else {
      document.execCommand(command);
      if (command === 'removeFormat') document.execCommand('unlink');
    }
  };

  const applyLink = () => {
    const range = restoreSelection();
    if (!range || !linkEditor) return;
    const value = linkEditor.value.trim();
    if (!value) document.execCommand('unlink');
    else document.execCommand('createLink', false, /^[a-z]+:|^\//i.test(value) ? value : `https://${value}`);
    setLinkEditor(null);
    setSelectionTools(null);
  };

  const runBlockAction = (action: 'up' | 'down' | 'copy' | 'delete') => {
    if (!blockMenu) return;
    finishCellEdit(true);
    finishRichEdit(true);
    const block = blocksRef.current.find((item) => item.index === blockMenu.index);
    if (!block) return;
    const current = markdownRef.current;
    const next = action === 'up'
      ? moveMarkdownBlock(current, blocksRef.current, block.index, -1)
      : action === 'down'
        ? moveMarkdownBlock(current, blocksRef.current, block.index, 1)
        : action === 'copy'
          ? duplicateMarkdownBlock(current, block)
          : replaceMarkdownBlock(current, block, '');
    setBlockMenu(null);
    setBlockTools(null);
    if (next !== current) onMarkdownChangeRef.current?.(next);
  };

  const previewStyle = {
    '--reading-font-size': `${settings.readingFontSize}px`,
    '--reading-width': `${settings.readingWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`markdown-preview__surface ${editable ? 'markdown-preview__surface--editable' : ''} ${settings.readingFont === 'sans' ? 'markdown-preview__surface--sans' : ''}`}
      style={previewStyle}
    >
      <PreviewBody html={html} ref={bodyRef} />

      {editable && blockTools && !sourceEditor ? (
        <div className="markdown-block-tools" style={{ left: blockTools.left, top: blockTools.top }}>
          <IconButton icon={Plus} label="在下面插入内容" onMouseDown={(event) => event.preventDefault()} onClick={() => {
            const block = blocksRef.current.find((item) => item.index === blockTools.index);
            if (block) beginPendingBlock(block);
          }} />
          <IconButton active={blockMenu?.index === blockTools.index} icon={GripVertical} label="这一块的操作" onMouseDown={(event) => event.preventDefault()} onClick={() => setBlockMenu((current) => current?.index === blockTools.index ? null : blockTools)} />
        </div>
      ) : null}

      {editable && blockMenu ? (
        <div className="markdown-block-menu" style={{ left: blockMenu.left, top: blockMenu.top + 34 }}>
          <button disabled={blocksRef.current[0]?.index === blockMenu.index} onClick={() => runBlockAction('up')} type="button"><ArrowUp size={15} />上移</button>
          <button disabled={blocksRef.current.at(-1)?.index === blockMenu.index} onClick={() => runBlockAction('down')} type="button"><ArrowDown size={15} />下移</button>
          <button onClick={() => runBlockAction('copy')} type="button"><Copy size={15} />复制这一块</button>
          <button className="markdown-block-menu__danger" onClick={() => runBlockAction('delete')} type="button"><Trash2 size={15} />删除</button>
        </div>
      ) : null}

      {editable && selectionTools && activeRich.current ? (
        <div className="rich-selection-toolbar" style={selectionTools}>
          <IconButton icon={Bold} label="加粗" onMouseDown={(event) => { event.preventDefault(); applyFormat('bold'); }} />
          <IconButton icon={Italic} label="斜体" onMouseDown={(event) => { event.preventDefault(); applyFormat('italic'); }} />
          <IconButton icon={Strikethrough} label="删除线" onMouseDown={(event) => { event.preventDefault(); applyFormat('strikeThrough'); }} />
          <IconButton icon={Code2} label="行内代码" onMouseDown={(event) => { event.preventDefault(); applyFormat('code'); }} />
          <IconButton icon={Link} label="添加链接" onMouseDown={(event) => {
            event.preventDefault();
            const range = restoreSelection();
            if (!range) return;
            const host = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
            setLinkEditor({ position: selectionTools, value: host?.closest('a')?.getAttribute('href') ?? '' });
          }} />
          <IconButton icon={RemoveFormatting} label="清除格式" onMouseDown={(event) => { event.preventDefault(); applyFormat('removeFormat'); }} />
        </div>
      ) : null}

      {editable && linkEditor ? (
        <form className="rich-link-editor" onSubmit={(event) => { event.preventDefault(); applyLink(); }} style={{ left: linkEditor.position.left, top: linkEditor.position.top + 42 }}>
          <input aria-label="链接地址" autoFocus onChange={(event) => setLinkEditor({ ...linkEditor, value: event.target.value })} placeholder="粘贴链接地址" value={linkEditor.value} />
          <IconButton icon={Check} label="应用链接" type="submit" />
          <IconButton icon={X} label="移除链接" onMouseDown={(event) => {
            event.preventDefault();
            if (restoreSelection()) document.execCommand('unlink');
            setLinkEditor(null);
            setSelectionTools(null);
          }} type="button" />
        </form>
      ) : null}

      {sourceEditor ? createPortal(
        <div className="block-source-editor">
          <header><strong>{sourceLabelForBlock(sourceEditor.block)}</strong><span><button onClick={() => finishSourceEdit(true)} type="button">完成</button><button onClick={() => finishSourceEdit(false)} type="button">取消</button></span></header>
          <textarea autoFocus onChange={(event) => setSourceEditor({ ...sourceEditor, value: event.target.value })} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              sourceEditor.element.classList.remove('markdown-block--source-editing');
              setSourceEditor(null);
            }
          }} spellCheck={false} value={sourceEditor.value} />
        </div>,
        sourceEditor.element,
      ) : null}
    </div>
  );
}));
