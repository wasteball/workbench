import type { AppSettings } from '@/shared/types';

export type SessionSecrets = Record<string, string>;

export function prepareSettingsForStorage(settings: AppSettings): {
  persistable: AppSettings;
  sessionSecrets: SessionSecrets;
} {
  const sessionSecrets: SessionSecrets = {};
  const storageProfiles = settings.storageProfiles.map((profile) => {
    if (profile.provider !== 'aliyun-oss') return profile;
    if (profile.credentialMode !== 'access-key') {
      return { ...profile, accessKeyId: '', accessKeySecret: '' };
    }
    if (profile.rememberAccessKey) return profile;
    if (profile.accessKeySecret) sessionSecrets[profile.id] = profile.accessKeySecret;
    return { ...profile, accessKeySecret: '' };
  });

  return {
    persistable: { ...settings, storageProfiles },
    sessionSecrets,
  };
}
