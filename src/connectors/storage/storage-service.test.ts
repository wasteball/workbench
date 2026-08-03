import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageConnector } from '@/connectors/storage/contract';
import { storageService } from '@/connectors/storage/storage-service';
import type { GatewayProfile } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  connect: vi.fn<StorageConnector['connect']>(),
  upload: vi.fn<StorageConnector['upload']>(),
}));

vi.mock('@/connectors/storage/current-gateway/gateway-connector', () => ({
  gatewayConnector: {
    id: 'gateway',
    validate: () => [],
    connect: mocks.connect,
    upload: mocks.upload,
  } satisfies StorageConnector,
}));

const profile: GatewayProfile = {
  id: 'shared-session-profile',
  provider: 'gateway',
  name: 'API 方式',
  apiUrl: 'https://example.com/upload',
  bucket: 'documents',
  userCode: 'user',
  cdn: false,
  publicRead: false,
  headers: [],
};

describe('storageService sessions', () => {
  beforeEach(() => {
    storageService.forget(profile.id);
    mocks.connect.mockReset();
    mocks.upload.mockReset();
    mocks.connect.mockResolvedValue({
      profileId: profile.id,
      provider: 'gateway',
      capabilities: ['upload'],
      defaultAccess: 'provider-managed',
      verified: true,
      message: 'ready',
    });
    mocks.upload.mockResolvedValue({
      objectKey: null,
      url: 'https://example.com/file.md',
      size: 4,
      access: 'unknown',
      expiresAt: null,
    });
  });

  it('shares one connection handshake across concurrent uploads', async () => {
    const input = {
      blob: new Blob(['test']),
      fileName: 'file.md',
      contentType: 'text/markdown',
      access: 'provider-managed' as const,
    };

    await Promise.all([
      storageService.upload(profile, input),
      storageService.upload(profile, input),
      storageService.upload(profile, input),
    ]);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
  });
});
