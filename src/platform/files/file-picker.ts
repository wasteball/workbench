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
