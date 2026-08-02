import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderTree, ListTree, Search, Trash2, X } from 'lucide-react';

import type { MarkdownHeading } from '@/features/markdown/engine/render-markdown';
import type { DocumentRecord } from '@/shared/persistence/database';
import { IconButton } from '@/shared/ui/IconButton';

import './document-rail.css';

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  documents: DocumentRecord[];
}

const FILE_RENDER_BATCH = 250;

function documentPath(document: DocumentRecord): string[] {
  if (document.source !== 'file') return [document.title];
  const parts = document.sourceLabel.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts : [document.title];
}

function buildTree(documents: DocumentRecord[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: new Map(), documents: [] };
  for (const document of documents) {
    const parts = documentPath(document);
    let node = root;
    for (const folder of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${folder}` : folder;
      let child = node.folders.get(folder);
      if (!child) {
        child = { name: folder, path, folders: new Map(), documents: [] };
        node.folders.set(folder, child);
      }
      node = child;
    }
    node.documents.push(document);
  }
  return root;
}

function DocumentButton({
  document,
  active,
  nested,
  onOpen,
  onRemove,
}: {
  document: DocumentRecord;
  active: boolean;
  nested: boolean;
  onOpen: (document: DocumentRecord) => void;
  onRemove: (document: DocumentRecord) => void;
}) {
  return (
    <div className={`document-tree__row ${active ? 'document-tree__row--active' : ''} ${nested ? 'document-tree__row--nested' : ''}`}>
      <button onClick={() => onOpen(document)} title={document.sourceLabel} type="button">
        <FileText aria-hidden="true" size={14} />
        <span>{document.source === 'file' ? documentPath(document).at(-1) : document.title}</span>
        {document.draftUpdatedAt ? <i aria-label="有未保存草稿" title="有未保存草稿" /> : null}
      </button>
      <IconButton icon={Trash2} label={`移除 ${document.title}`} onClick={() => onRemove(document)} />
    </div>
  );
}

function FolderBranch({
  node,
  activeId,
  depth,
  onOpen,
  onRemove,
}: {
  node: FolderNode;
  activeId?: string;
  depth: number;
  onOpen: (document: DocumentRecord) => void;
  onRemove: (document: DocumentRecord) => void;
}) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const documents = [...node.documents].sort((a, b) => documentPath(a).at(-1)?.localeCompare(documentPath(b).at(-1) ?? '', 'zh-CN') ?? 0);
  return (
    <>
      {documents.map((document) => (
        <DocumentButton active={activeId === document.id} document={document} key={document.id} nested={depth > 0} onOpen={onOpen} onRemove={onRemove} />
      ))}
      {folders.map((folder) => (
        <details className="document-tree__folder" key={folder.path} open>
          <summary title={folder.path}>
            <ChevronRight aria-hidden="true" className="document-tree__caret" size={13} />
            <Folder aria-hidden="true" size={14} />
            <span>{folder.name}</span>
          </summary>
          <div className="document-tree__children"><FolderBranch activeId={activeId} depth={depth + 1} node={folder} onOpen={onOpen} onRemove={onRemove} /></div>
        </details>
      ))}
    </>
  );
}

export function DocumentRail({
  documents,
  activeId,
  headings,
  activeHeadingId,
  onOpen,
  onRemove,
  onHeading,
}: {
  documents: DocumentRecord[];
  activeId?: string;
  headings: MarkdownHeading[];
  activeHeadingId: string;
  onOpen: (document: DocumentRecord) => void;
  onRemove: (document: DocumentRecord) => void;
  onHeading: (heading: MarkdownHeading) => void;
}) {
  const [filesOpen, setFilesOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [fileQuery, setFileQuery] = useState('');
  const [visibleFileLimit, setVisibleFileLimit] = useState(FILE_RENDER_BATCH);
  const deferredFileQuery = useDeferredValue(fileQuery.trim().toLocaleLowerCase());
  const filteredDocuments = useMemo(() => {
    if (!deferredFileQuery) return documents;
    return documents.filter((document) => documentPath(document).join('/').toLocaleLowerCase().includes(deferredFileQuery));
  }, [deferredFileQuery, documents]);
  useEffect(() => setVisibleFileLimit(FILE_RENDER_BATCH), [deferredFileQuery, documents.length]);
  useEffect(() => {
    if (!activeId) return;
    const activeIndex = filteredDocuments.findIndex((document) => document.id === activeId);
    if (activeIndex >= visibleFileLimit) {
      setVisibleFileLimit(Math.ceil((activeIndex + 1) / FILE_RENDER_BATCH) * FILE_RENDER_BATCH);
    }
  }, [activeId, filteredDocuments, visibleFileLimit]);
  const visibleDocuments = useMemo(() => filteredDocuments.slice(0, visibleFileLimit), [filteredDocuments, visibleFileLimit]);
  const tree = useMemo(() => buildTree(visibleDocuments), [visibleDocuments]);

  return (
    <aside className="document-rail">
      <section className={`document-rail__section document-rail__section--files ${filesOpen ? '' : 'document-rail__section--collapsed'}`}>
        <button aria-expanded={filesOpen} className="document-rail__section-heading" onClick={() => setFilesOpen((value) => !value)} type="button">
          {filesOpen ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
          <FolderTree aria-hidden="true" size={14} />
          <strong>文件</strong>
          <span>{documents.length}</span>
        </button>
        {filesOpen ? <>
          {documents.length > 0 ? <label className="document-search">
            <Search aria-hidden="true" size={14} />
            <span className="sr-only">搜索文件</span>
            <input onChange={(event) => setFileQuery(event.target.value)} placeholder="搜索文件" type="search" value={fileQuery} />
            {fileQuery ? <button aria-label="清空文件搜索" onClick={() => setFileQuery('')} type="button"><X aria-hidden="true" size={13} /></button> : null}
          </label> : null}
          <div className="document-rail__section-body document-tree">
            {filteredDocuments.length > 0 ? <>
              <FolderBranch activeId={activeId} depth={0} node={tree} onOpen={onOpen} onRemove={onRemove} />
              {visibleDocuments.length < filteredDocuments.length ? <button className="document-tree__more" onClick={() => setVisibleFileLimit((value) => value + FILE_RENDER_BATCH)} type="button">显示更多文件（{visibleDocuments.length}/{filteredDocuments.length}）</button> : null}
            </> : <p className="document-rail__empty">{documents.length > 0 ? `没有找到“${fileQuery.trim()}”` : '打开的文件会列在这里。'}</p>}
          </div>
        </> : null}
      </section>

      <section className={`document-rail__section document-rail__section--outline ${outlineOpen ? '' : 'document-rail__section--collapsed'}`}>
        <button aria-expanded={outlineOpen} className="document-rail__section-heading" onClick={() => setOutlineOpen((value) => !value)} type="button">
          {outlineOpen ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
          <ListTree aria-hidden="true" size={14} />
          <strong>目录</strong>
          <span>{headings.length}</span>
        </button>
        {outlineOpen ? <nav aria-label="文档目录" className="document-outline">
          {headings.length > 0 ? headings.map((heading) => (
            <button
              aria-current={activeHeadingId === heading.id ? 'location' : undefined}
              className={`document-outline__level-${heading.level}`}
              key={heading.id}
              onClick={() => onHeading(heading)}
              title={heading.text}
              type="button"
            >{heading.text}</button>
          )) : <p className="document-rail__empty">当前文档没有标题。</p>}
        </nav> : null}
      </section>
    </aside>
  );
}
