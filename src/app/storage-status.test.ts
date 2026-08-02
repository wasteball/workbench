import { describe, expect, it } from 'vitest';

import { isStorageProfileConfigured } from '@/app/storage-status';
import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';

describe('storage profile readiness', () => {
  it('starts with cloud sharing disabled and no setup required', () => {
    expect(DEFAULT_SETTINGS.storageProfiles).toEqual([]);
    expect(DEFAULT_SETTINGS.activeStorageProfileId).toBeNull();
  });

  it('requires all gateway fields', () => {
    expect(isStorageProfileConfigured({ id: 'g', provider: 'gateway', name: 'Gateway', apiUrl: 'https://example.com', bucket: '', userCode: 'u', cdn: false, publicRead: false, headers: [] })).toBe(false);
    expect(isStorageProfileConfigured({ id: 'g', provider: 'gateway', name: 'Gateway', apiUrl: 'https://example.com', bucket: 'b', userCode: 'u', cdn: false, publicRead: false, headers: [] })).toBe(true);
  });

  it('accepts both AccessKey and STS Aliyun modes', () => {
    const base = { id: 'a', provider: 'aliyun-oss' as const, name: 'OSS', region: 'oss-cn-hangzhou', endpoint: '', bucket: 'b', prefix: '', accessKeyId: '', accessKeySecret: '', rememberAccessKey: false, stsUrl: '', stsHeaders: [], defaultAccess: 'private' as const, signedUrlExpiresInSeconds: 3600 };
    expect(isStorageProfileConfigured({ ...base, credentialMode: 'access-key', accessKeyId: 'id', accessKeySecret: 'secret' })).toBe(true);
    expect(isStorageProfileConfigured({ ...base, credentialMode: 'sts', stsUrl: 'https://example.com/sts' })).toBe(true);
  });
});
