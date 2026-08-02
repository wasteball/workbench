export interface PickedMarkdownFile {
  file?: File;
  handle?: FileSystemFileHandle;
  name: string;
  relativePath: string;
}

type OpenFilePicker = (options: {
  multiple: boolean;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<FileSystemFileHandle[]>;

type OpenDirectoryPicker = () => Promise<FileSystemDirectoryHandle>;

type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<FileSystemFileHandle>;

type WritableFileHandle = FileSystemFileHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

const MARKDOWN_TYPES = [{
  description: 'Markdown 文档',
  accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] },
}];

const MAX_DIRECTORY_DOCUMENTS = 2_000;
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.output',
  'build',
  'dist',
  'node_modules',
  'vendor',
]);

function isMarkdownName(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}

function isIgnoredRelativePath(path: string): boolean {
  const directories = path.split(/[\\/]+/).slice(0, -1);
  return directories.some((name) => IGNORED_DIRECTORY_NAMES.has(name.toLocaleLowerCase()));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function inputFiles(directory = false): Promise<PickedMarkdownFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.multiple = true;
    if (directory) input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => {
      const selected = [...(input.files ?? [])]
        .filter((file) => isMarkdownName(file.name))
        .filter((file) => !isIgnoredRelativePath(file.webkitRelativePath || file.name))
        .slice(0, MAX_DIRECTORY_DOCUMENTS);
      resolve(
        selected.map((file) => ({
          file,
          name: file.name,
          relativePath: file.webkitRelativePath || file.name,
        })),
      );
    }, { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

async function readDirectory(
  directory: FileSystemDirectoryHandle,
  parentPath = '',
  files: PickedMarkdownFile[] = [],
  visited = { count: 0 },
): Promise<PickedMarkdownFile[]> {
  for await (const [name, handle] of directory.entries()) {
    if (files.length >= MAX_DIRECTORY_DOCUMENTS) break;
    visited.count += 1;
    if (visited.count % 120 === 0) await yieldToBrowser();
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === 'directory') {
      if (!IGNORED_DIRECTORY_NAMES.has(name.toLocaleLowerCase())) await readDirectory(handle, path, files, visited);
    } else if (isMarkdownName(name)) {
      files.push({ handle, name, relativePath: path });
    }
  }
  return files;
}

interface LegacyFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
}

interface LegacyDirectoryEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => {
    readEntries: (
      success: (entries: LegacyEntry[]) => void,
      failure?: (error: DOMException) => void,
    ) => void;
  };
}

type LegacyEntry = LegacyFileEntry | LegacyDirectoryEntry;

function legacyFile(entry: LegacyFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readLegacyEntry(
  entry: LegacyEntry,
  parentPath = '',
  files: PickedMarkdownFile[] = [],
  visited = { count: 0 },
): Promise<PickedMarkdownFile[]> {
  if (files.length >= MAX_DIRECTORY_DOCUMENTS) return files;
  visited.count += 1;
  if (visited.count % 120 === 0) await yieldToBrowser();
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (isMarkdownName(entry.name)) files.push({ file: await legacyFile(entry), name: entry.name, relativePath: path });
    return files;
  }

  if (IGNORED_DIRECTORY_NAMES.has(entry.name.toLocaleLowerCase())) return files;

  const reader = entry.createReader();
  const children: LegacyEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  for (const child of children) {
    if (files.length >= MAX_DIRECTORY_DOCUMENTS) break;
    await readLegacyEntry(child, path, files, visited);
  }
  return files;
}

export async function pickMarkdownFiles(): Promise<PickedMarkdownFile[]> {
  const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (!picker) return inputFiles(false);
  try {
    const handles = await picker({ multiple: true, types: MARKDOWN_TYPES });
    return handles.map((handle) => ({ handle, name: handle.name, relativePath: handle.name }));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    throw error;
  }
}

export async function pickMarkdownDirectory(): Promise<PickedMarkdownFile[]> {
  const picker = (window as unknown as { showDirectoryPicker?: OpenDirectoryPicker }).showDirectoryPicker;
  if (!picker) return inputFiles(true);
  try {
    const directory = await picker();
    return readDirectory(directory, directory.name);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    throw error;
  }
}

export async function markdownFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<PickedMarkdownFile[]> {
  const items = [...dataTransfer.items].filter((item) => item.kind === 'file');
  const modernHandles = await Promise.all(items.map(async (item) => {
    const withHandle = item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
    };
    try {
      return await withHandle.getAsFileSystemHandle?.() ?? null;
    } catch {
      return null;
    }
  }));

  if (modernHandles.some(Boolean)) {
    const picked = await Promise.all(modernHandles.map(async (handle) => {
      if (!handle) return [];
      if (handle.kind === 'directory') return readDirectory(handle as FileSystemDirectoryHandle, handle.name);
      if (!isMarkdownName(handle.name)) return [];
      const fileHandle = handle as FileSystemFileHandle;
      return [{ handle: fileHandle, name: fileHandle.name, relativePath: fileHandle.name }];
    }));
    return picked.flat();
  }

  const legacyEntries = items.map((item) => {
    const withEntry = item as unknown as { webkitGetAsEntry?: () => LegacyEntry | null };
    return withEntry.webkitGetAsEntry?.() ?? null;
  });
  if (legacyEntries.some(Boolean)) {
    const files: PickedMarkdownFile[] = [];
    const visited = { count: 0 };
    for (const entry of legacyEntries) {
      if (!entry || files.length >= MAX_DIRECTORY_DOCUMENTS) continue;
      await readLegacyEntry(entry, '', files, visited);
    }
    return files;
  }

  return [...dataTransfer.files]
    .filter((file) => isMarkdownName(file.name) && !isIgnoredRelativePath(file.webkitRelativePath || file.name))
    .slice(0, MAX_DIRECTORY_DOCUMENTS)
    .map((file) => ({ file, name: file.name, relativePath: file.webkitRelativePath || file.name }));
}

export async function resolvePickedMarkdownFile(picked: PickedMarkdownFile): Promise<File> {
  if (picked.file) return picked.file;
  if (picked.handle) return picked.handle.getFile();
  throw new Error(`无法读取 ${picked.name}。`);
}

export async function pickMarkdownSaveFile(suggestedName: string): Promise<FileSystemFileHandle | null | undefined> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) return undefined;
  try {
    return await picker({ suggestedName, types: MARKDOWN_TYPES });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function writeMarkdownFile(handle: FileSystemFileHandle, content: string): Promise<boolean> {
  const permissionHandle = handle as WritableFileHandle;
  let permission = await permissionHandle.queryPermission?.({ mode: 'readwrite' });
  if (permission !== 'granted' && permissionHandle.requestPermission) {
    try {
      permission = await permissionHandle.requestPermission({ mode: 'readwrite' });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) return false;
      throw error;
    }
  }
  if (permissionHandle.queryPermission && permission !== 'granted') return false;
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  return true;
}
