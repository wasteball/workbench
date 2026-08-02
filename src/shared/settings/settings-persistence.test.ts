import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import { prepareSettingsForStorage } from '@/shared/settings/settings-persistence';
import type { AliyunProfile } from '@/shared/types';

function aliyunProfile(patch: Partial<AliyunProfile>): AliyunProfile {
  return {
    id: 'aliyun-session',
    provider: 'aliyun-oss',
    name: 'OSS',
    credentialMode: 'access-key',
    region: 'oss-cn-hangzhou',
    endpoint: '',
    bucket: 'example-bucket',
    prefix: 'workbench/',
    accessKeyId: 'access-key-id',
    accessKeySecret: 'session-secret',
    rememberAccessKey: false,
    stsUrl: '',
    stsHeaders: [],
    defaultAccess: 'private',
    signedUrlExpiresInSeconds: 3600,
    ...patch,
  };
}

describe('settings persistence', () => {
  it('keeps session secrets out of local settings', () => {
    const sessionProfile = aliyunProfile({});
    const rememberedProfile = aliyunProfile({
      id: 'aliyun-remembered',
      accessKeySecret: 'remembered-secret',
      rememberAccessKey: true,
    });
    const prepared = prepareSettingsForStorage({
      ...DEFAULT_SETTINGS,
      storageProfiles: [sessionProfile, rememberedProfile],
      activeStorageProfileId: sessionProfile.id,
    });

    expect(prepared.sessionSecrets).toEqual({ [sessionProfile.id]: 'session-secret' });
    expect(prepared.persistable.storageProfiles[0]).toMatchObject({ accessKeySecret: '' });
    expect(prepared.persistable.storageProfiles[1]).toMatchObject({ accessKeySecret: 'remembered-secret' });
  });

  it('does not retain removed, cleared, or STS profile secrets', () => {
    const stsProfile = aliyunProfile({
      id: 'aliyun-sts',
      credentialMode: 'sts',
      accessKeyId: 'must-be-cleared',
      accessKeySecret: 'must-be-cleared',
      stsUrl: 'https://sts.example.com/workbench/sts',
    });
    const prepared = prepareSettingsForStorage({
      ...DEFAULT_SETTINGS,
      storageProfiles: [aliyunProfile({ accessKeySecret: '' }), stsProfile],
      activeStorageProfileId: stsProfile.id,
    });

    expect(prepared.sessionSecrets).toEqual({});
    expect(prepared.persistable.storageProfiles[1]).toMatchObject({
      accessKeyId: '',
      accessKeySecret: '',
    });
  });
});
