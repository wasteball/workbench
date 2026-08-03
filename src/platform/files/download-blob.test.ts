import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from '@/platform/files/download-blob';

const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor);
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor);
    else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('clicks a connected anchor and keeps the blob URL alive long enough for Chrome', () => {
    vi.useFakeTimers();
    const createObjectUrl = vi.fn(() => 'blob:workbench-download');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    let connectedWhenClicked = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      connectedWhenClicked = this.isConnected;
    });

    downloadBlob(new Blob(['content']), '中文手册.md');

    expect(connectedWhenClicked).toBe(true);
    expect(document.querySelector('a[download="中文手册.md"]')).toBeNull();
    vi.advanceTimersByTime(59_999);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:workbench-download');
  });
});
