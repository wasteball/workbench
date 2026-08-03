import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import {
  createSettingsExport,
  createWorkbenchBackup,
  parseSettingsImport,
  parseWorkbenchImport,
} from '@/shared/settings/settings-transfer';
import type { AppSettings } from '@/shared/types';

describe('settings transfer', () => {
  it('fills newly added browser preferences when importing an older v1 file', () => {
    const legacySettings = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete legacySettings.markdownRailOpen;
    delete legacySettings.markdownFilesOpen;
    delete legacySettings.markdownOutlineOpen;
    delete legacySettings.reviewShowMarks;

    expect(parseSettingsImport({ settings: legacySettings })).toMatchObject({
      markdownRailOpen: true,
      markdownFilesOpen: true,
      markdownOutlineOpen: true,
      reviewShowMarks: true,
    });
  });

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

  it('backs up preferences and file-library records without credentials', () => {
    const settings: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      readingWidth: 1040,
      storageProfiles: [{
        id: 'gateway',
        provider: 'gateway',
        name: 'API 方式',
        apiUrl: 'https://example.com/upload',
        bucket: 'documents',
        userCode: 'private-user',
        cdn: false,
        publicRead: false,
        headers: [],
      }],
      activeStorageProfileId: 'gateway',
    };
    const backup = createWorkbenchBackup(settings, [{
      id: 'share-1',
      fileName: '手册.md',
      displayName: '手册.md',
      size: 120,
      contentType: 'text/markdown',
      url: 'https://example.com/files/manual.md',
      objectKey: null,
      access: 'public',
      expiresAt: null,
      category: '文档',
      relativePath: '项目/手册.md',
      storageProfileId: 'gateway',
      storageProvider: 'gateway',
      createdAt: 123,
    }], [{ name: '文档', createdAt: 100, updatedAt: 100 }]);

    expect(JSON.stringify(backup)).not.toContain('private-user');
    const restored = parseWorkbenchImport(backup);
    expect(restored.settings.readingWidth).toBe(1040);
    expect(restored.fileLibrary?.shares[0]?.displayName).toBe('手册.md');
    expect(restored.fileLibrary?.categories[0]?.name).toBe('文档');
  });

  it('keeps old settings-only files importable', () => {
    const restored = parseWorkbenchImport(createSettingsExport(DEFAULT_SETTINGS));
    expect(restored.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(restored.fileLibrary).toBeNull();
  });
});
