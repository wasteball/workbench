export interface PickedMarkdownFile {
  file: File;
  handle?: FileSystemFileHandle;
  relativePath: string;
}

type OpenFilePicker = (options: {
  multiple: boolean;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<FileSystemFileHandle[]>;

type OpenDirectoryPicker = () => Promise<FileSystemDirectoryHandle>;

const MARKDOWN_TYPES = [{
  description: 'Markdown 文档',
  accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] },
}];

function inputFiles(directory = false): Promise<PickedMarkdownFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.multiple = true;
    if (directory) input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => {
      resolve(
        [...(input.files ?? [])].map((file) => ({
          file,
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
): Promise<PickedMarkdownFile[]> {
  const files: PickedMarkdownFile[] = [];
  for await (const [name, handle] of directory.entries()) {
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === 'directory') {
      files.push(...await readDirectory(handle, path));
    } else if (/\.(md|markdown|txt)$/i.test(name)) {
      files.push({ file: await handle.getFile(), handle, relativePath: path });
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

async function readLegacyEntry(entry: LegacyEntry, parentPath = ''): Promise<PickedMarkdownFile[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!/\.(md|markdown|txt)$/i.test(entry.name)) return [];
    return [{ file: await legacyFile(entry), relativePath: path }];
  }

  const reader = entry.createReader();
  const children: LegacyEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map((child) => readLegacyEntry(child, path)))).flat();
}

export async function pickMarkdownFiles(): Promise<PickedMarkdownFile[]> {
  const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (!picker) return inputFiles(false);
  try {
    const handles = await picker({ multiple: true, types: MARKDOWN_TYPES });
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle, relativePath: handle.name })));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    throw error;
  }
}

export async function pickMarkdownDirectory(): Promise<PickedMarkdownFile[]> {
  const picker = (window as unknown as { showDirectoryPicker?: OpenDirectoryPicker }).showDirectoryPicker;
  if (!picker) return inputFiles(true);
  try {
    return readDirectory(await picker());
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
      if (!/\.(md|markdown|txt)$/i.test(handle.name)) return [];
      const fileHandle = handle as FileSystemFileHandle;
      return [{ file: await fileHandle.getFile(), handle: fileHandle, relativePath: fileHandle.name }];
    }));
    return picked.flat();
  }

  const legacyEntries = items.map((item) => {
    const withEntry = item as unknown as { webkitGetAsEntry?: () => LegacyEntry | null };
    return withEntry.webkitGetAsEntry?.() ?? null;
  });
  if (legacyEntries.some(Boolean)) {
    return (await Promise.all(legacyEntries.map((entry) => entry ? readLegacyEntry(entry) : []))).flat();
  }

  return [...dataTransfer.files]
    .filter((file) => /\.(md|markdown|txt)$/i.test(file.name))
    .map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
}
