import type { StorageProfile } from '@/shared/types';

export type StorageCapability =
  | 'upload'
  | 'returned-link'
  | 'list'
  | 'remove'
  | 'rename'
  | 'signed-link'
  | 'public-link';

export interface ConnectorSession {
  profileId: string;
  provider: StorageProfile['provider'];
  capabilities: StorageCapability[];
  defaultAccess: 'private' | 'public' | 'provider-managed';
  credentialsExpireAt?: number;
  verified: boolean;
  message: string;
  client?: unknown;
}

export interface UploadInput {
  blob: Blob;
  fileName: string;
  contentType: string;
  access: 'private' | 'public' | 'provider-managed';
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface UploadResult {
  objectKey: string | null;
  url: string;
  size: number;
  access: 'public' | 'signed' | 'authenticated' | 'unknown';
  expiresAt: number | null;
}

export interface StorageLink {
  url: string;
  access: 'public' | 'signed' | 'authenticated' | 'unknown';
  expiresAt: number | null;
}

export interface RemoteFile {
  objectKey: string;
  name: string;
  size: number;
  updatedAt: number | null;
  url: string | null;
}

export interface StorageConnector {
  id: StorageProfile['provider'];
  validate(profile: StorageProfile): string[];
  connect(profile: StorageProfile): Promise<ConnectorSession>;
  upload(input: UploadInput, profile: StorageProfile, session: ConnectorSession): Promise<UploadResult>;
  link?(profile: StorageProfile, session: ConnectorSession, objectKey: string, access: UploadResult['access']): Promise<StorageLink>;
  list?(profile: StorageProfile, session: ConnectorSession, prefix?: string): Promise<RemoteFile[]>;
  remove?(profile: StorageProfile, session: ConnectorSession, objectKey: string): Promise<void>;
  rename?(profile: StorageProfile, session: ConnectorSession, objectKey: string, nextKey: string): Promise<void>;
}

export class StorageConnectorError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-config' | 'permission-denied' | 'network' | 'expired' | 'provider-error',
  ) {
    super(message);
    this.name = 'StorageConnectorError';
  }
}
