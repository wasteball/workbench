import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareDocumentDialog } from '@/features/markdown/components/ShareDocumentDialog';
import type { GatewayProfile } from '@/shared/types';

const profile: GatewayProfile = {
  id: 'gateway-profile',
  provider: 'gateway',
  name: 'API 方式',
  apiUrl: 'https://example.com/upload',
  bucket: 'documents',
  userCode: 'user',
  cdn: false,
  publicRead: false,
  headers: [],
};

function props(overrides: Partial<Parameters<typeof ShareDocumentDialog>[0]> = {}) {
  return {
    open: true,
    title: '当前阅读文档.md',
    format: 'html' as const,
    access: 'provider-managed' as const,
    profile,
    storageReady: true,
    busy: false,
    error: '',
    generatedUrl: '',
    onFormatChange: vi.fn(),
    onAccessChange: vi.fn(),
    onConfirm: vi.fn(),
    onCopyGenerated: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShareDocumentDialog', () => {
  it('keeps the current document context while choosing a format and confirming', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const handlers = props();
    const result = render(<ShareDocumentDialog {...handlers} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'HTML 网页' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Word 文档' }));
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));

    expect(handlers.onFormatChange).toHaveBeenCalledWith('docx');
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');

    result.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps a failed automatic copy recoverable and respects the busy state', () => {
    const handlers = props({
      busy: true,
      error: '浏览器没有允许自动复制。',
      generatedUrl: 'https://example.com/%E5%BD%93%E5%89%8D%E6%96%87%E6%A1%A3.html',
    });
    const result = render(<ShareDocumentDialog {...handlers} />);

    expect(screen.getByLabelText('已生成的分享链接')).toHaveValue('https://example.com/%E5%BD%93%E5%89%8D%E6%96%87%E6%A1%A3.html');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handlers.onClose).not.toHaveBeenCalled();

    result.rerender(<ShareDocumentDialog {...handlers} busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: '复制分享内容' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handlers.onCopyGenerated).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
