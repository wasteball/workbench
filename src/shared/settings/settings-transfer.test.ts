import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import { createSettingsExport, parseSettingsImport } from '@/shared/settings/settings-transfer';
import type { AppSettings } from '@/shared/types';

describe('settings transfer', () => {
  it('removes all stored credentials from exports and imports', () => {
    const settings: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      storageProfiles: [
        {
          id: 'gateway',
          provider: 'gateway',
          name: 'Gateway',
          apiUrl: 'https://example.com/upload',
          bucket: 'bucket',
          userCode: 'private-user',
          cdn: false,
          publicRead: false,
          headers: [{ key: 'Authorization', value: 'secret-token' }],
        },
        {
          id: 'aliyun',
          provider: 'aliyun-oss',
          name: 'OSS',
          credentialMode: 'access-key',
          region: 'oss-cn-hangzhou',
          endpoint: '',
          bucket: 'bucket',
          prefix: 'workbench/',
          accessKeyId: 'id-value',
          accessKeySecret: 'secret-value',
          rememberAccessKey: true,
          stsUrl: '',
          stsHeaders: [{ key: 'Authorization', value: 'sts-secret' }],
          defaultAccess: 'private',
          signedUrlExpiresInSeconds: 3600,
        },
      ],
      activeStorageProfileId: 'aliyun',
    };

    const exported = createSettingsExport(settings);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('private-user');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('id-value');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('sts-secret');
    expect(exported.secretsIncluded).toBe(false);

    const imported = parseSettingsImport(exported);
    const aliyun = imported.storageProfiles.find((profile) => profile.provider === 'aliyun-oss');
    expect(aliyun?.accessKeySecret).toBe('');
    expect(aliyun?.rememberAccessKey).toBe(false);
  });
});
