import type { StorageProfile } from '@/shared/types';

export function isStorageProfileConfigured(profile: StorageProfile | undefined): boolean {
  if (!profile) return false;
  if (profile.provider === 'gateway') {
    return Boolean(profile.apiUrl.trim() && profile.bucket.trim() && profile.userCode.trim());
  }
  const baseReady = Boolean(
    profile.bucket.trim() && (profile.region.trim() || profile.endpoint.trim()),
  );
  if (!baseReady) return false;
  if (profile.credentialMode === 'sts') return Boolean(profile.stsUrl.trim());
  return Boolean(profile.accessKeyId.trim() && profile.accessKeySecret.trim());
}

export function getActiveStorageProfile(
  profiles: StorageProfile[],
  activeId: string | null,
): StorageProfile | undefined {
  return profiles.find((profile) => profile.id === activeId);
}
