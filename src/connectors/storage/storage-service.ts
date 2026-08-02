import {
  type ConnectorSession,
  type RemoteFile,
  type StorageConnector,
  StorageConnectorError,
  type UploadInput,
  type UploadResult,
} from '@/connectors/storage/contract';
import type { StorageProfile } from '@/shared/types';

const connectorLoaders: Record<StorageProfile['provider'], () => Promise<StorageConnector>> = {
  gateway: async () => (await import('@/connectors/storage/current-gateway/gateway-connector')).gatewayConnector,
  'aliyun-oss': async () => (await import('@/connectors/storage/aliyun-oss/aliyun-connector')).aliyunConnector,
};

const connectorCache = new Map<StorageProfile['provider'], StorageConnector>();
const sessions = new Map<string, ConnectorSession>();

async function connectorFor(profile: StorageProfile): Promise<StorageConnector> {
  const cached = connectorCache.get(profile.provider);
  if (cached) return cached;
  const loader = connectorLoaders[profile.provider];
  if (!loader) throw new StorageConnectorError('不支持这个存储连接器。', 'invalid-config');
  const connector = await loader();
  connectorCache.set(profile.provider, connector);
  return connector;
}

function sessionNeedsRefresh(session: ConnectorSession): boolean {
  return Boolean(session.credentialsExpireAt && session.credentialsExpireAt - Date.now() < 5 * 60_000);
}

async function ensureSession(profile: StorageProfile, force = false): Promise<ConnectorSession> {
  const current = sessions.get(profile.id);
  if (!force && current && !sessionNeedsRefresh(current)) return current;
  const connector = await connectorFor(profile);
  const session = await connector.connect(profile);
  sessions.set(profile.id, session);
  return session;
}

export const storageService = {
  async validate(profile: StorageProfile): Promise<string[]> {
    return (await connectorFor(profile)).validate(profile);
  },

  async test(profile: StorageProfile): Promise<ConnectorSession> {
    return ensureSession(profile, true);
  },

  async upload(profile: StorageProfile, input: UploadInput): Promise<UploadResult> {
    const session = await ensureSession(profile);
    if (!session.capabilities.includes('upload')) throw new StorageConnectorError('当前凭据没有上传能力。', 'permission-denied');
    return (await connectorFor(profile)).upload(input, profile, session);
  },

  async list(profile: StorageProfile, prefix?: string): Promise<RemoteFile[]> {
    const connector = await connectorFor(profile);
    const session = await ensureSession(profile);
    if (!session.capabilities.includes('list') || !connector.list) throw new StorageConnectorError('当前连接不支持查看云端文件。', 'permission-denied');
    return connector.list(profile, session, prefix);
  },

  async remove(profile: StorageProfile, objectKey: string): Promise<void> {
    const connector = await connectorFor(profile);
    const session = await ensureSession(profile);
    if (!session.capabilities.includes('remove') || !connector.remove) throw new StorageConnectorError('当前连接不支持删除云端文件。', 'permission-denied');
    await connector.remove(profile, session, objectKey);
  },

  forget(profileId: string): void {
    sessions.delete(profileId);
  },
};
