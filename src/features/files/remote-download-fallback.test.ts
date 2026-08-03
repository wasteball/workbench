import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contains: vi.fn(),
  request: vi.fn(),
  createTab: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: {
      contains: mocks.contains,
      request: mocks.request,
    },
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
    mocks.contains.mockResolvedValue(true);
    mocks.request.mockResolvedValue(true);
    mocks.createTab.mockResolvedValue({ id: 1 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
