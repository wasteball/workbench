import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      create: mocks.createTab,
    },
  },
}));

vi.mock('@/platform/files/download-blob', () => ({
  downloadBlob: mocks.downloadBlob,
}));

import { downloadRemoteFile } from '@/features/files/remote-download';

describe('remote download fallback', () => {
  beforeEach(() => {
    mocks.createTab.mockResolvedValue({ id: 1 });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('downloads a CORS-enabled file without an extra website-permission gate', async () => {
    const blob = new Blob(['<h1>Workbench</h1>'], { type: 'text/html' });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      url: 'https://files.example.com/generated-name.html',
      blob: async () => blob,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'content-disposition') return 'filename="原始文件名.html"';
          if (name.toLowerCase() === 'content-type') return 'text/html; charset=UTF-8';
          return null;
        },
      } as Headers,
    } as Response);

    await expect(downloadRemoteFile({
      url: 'https://gateway.example.com/download/hash.html',
    })).resolves.toEqual({
      fileName: '原始文件名.html',
      size: blob.size,
      delivery: 'downloaded',
    });

    expect(mocks.downloadBlob).toHaveBeenCalledWith(blob, '原始文件名.html');
    expect(mocks.createTab).not.toHaveBeenCalled();
  });

  it('opens a valid file URL when CORS prevents a direct download', async () => {
    await expect(downloadRemoteFile({
      url: 'https://files.example.com/%E8%AF%B4%E6%98%8E.md',
      preferredFileName: '说明.md',
    })).resolves.toEqual({
      fileName: '说明.md',
      size: 0,
      delivery: 'opened',
    });

    expect(mocks.createTab).toHaveBeenCalledWith({
      url: 'https://files.example.com/%E8%AF%B4%E6%98%8E.md',
    });
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  it('does not open many tabs when batch download disables the fallback', async () => {
    await expect(downloadRemoteFile({
      url: 'https://files.example.com/report.md',
      fallbackToOpen: false,
    })).rejects.toThrow('Failed to fetch');

    expect(mocks.createTab).not.toHaveBeenCalled();
  });
});
