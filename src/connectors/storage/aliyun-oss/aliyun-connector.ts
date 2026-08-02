import OSS from 'ali-oss';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import {
  type ConnectorSession,
  type RemoteFile,
  type StorageCapability,
  type StorageConnector,
  StorageConnectorError,
} from '@/connectors/storage/contract';
import {
  endpointUrl,
  endpointValidationIssue,
  publicObjectUrl,
} from '@/connectors/storage/aliyun-oss/aliyun-endpoint';
import { ensureWebsitePermission } from '@/platform/permissions/website-permission';
import type { AliyunProfile } from '@/shared/types';

const stsResponseSchema = z.object({
  accessKeyId: z.string().min(1),
  accessKeySecret: z.string().min(1),
  securityToken: z.string().min(1),
  expiration: z.union([z.string(), z.number()]),
  capabilities: z.array(z.enum(['upload', 'list', 'remove', 'rename', 'signed-link', 'public-link'])),
});

interface AliyunSessionClient {
  oss: OSS;
}

function asAliyunProfile(profile: Parameters<StorageConnector['validate']>[0]): AliyunProfile | null {
  return profile.provider === 'aliyun-oss' ? profile : null;
}

function safeObjectName(value: string): string {
  return [...value]
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .replace(/[\\?#%]/g, '-')
    .replace(/^\.+/, '')
    .slice(-180) || 'file';
}

function objectKey(profile: AliyunProfile, fileName: string): string {
  const date = new Date();
  const path = [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0')].join('/');
  const prefix = profile.prefix.trim().replace(/^\/+|\/+$/g, '');
  return [prefix, path, `${nanoid(10)}-${safeObjectName(fileName)}`].filter(Boolean).join('/');
}

function sessionClient(session: ConnectorSession): OSS {
  const value = session.client as AliyunSessionClient | undefined;
  if (!value?.oss) throw new StorageConnectorError('阿里云连接会话已失效。', 'expired');
  return value.oss;
}

async function requestSts(profile: AliyunProfile) {
  if (!await ensureWebsitePermission(profile.stsUrl)) throw new StorageConnectorError('未获得 STS 服务的网站权限。', 'permission-denied');
  let response: Response;
  try {
    response = await fetch(profile.stsUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'content-type': 'application/json',
        ...Object.fromEntries(profile.stsHeaders.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value])),
      },
      body: JSON.stringify({ region: profile.region, bucket: profile.bucket, prefix: profile.prefix }),
    });
  } catch {
    throw new StorageConnectorError('无法连接 STS 服务。', 'network');
  }
  if (!response.ok) throw new StorageConnectorError(`STS 服务拒绝了请求（HTTP ${response.status}）。`, response.status === 401 || response.status === 403 ? 'permission-denied' : 'provider-error');
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw new StorageConnectorError('STS 服务返回了无法识别的内容。', 'provider-error');
  }
  const parsed = stsResponseSchema.safeParse(payload);
  if (!parsed.success) throw new StorageConnectorError('STS 响应缺少临时凭证、有效期或能力列表。', 'provider-error');
  const expiration = typeof parsed.data.expiration === 'number' ? parsed.data.expiration : Date.parse(parsed.data.expiration);
  if (!Number.isFinite(expiration) || expiration - Date.now() < 5 * 60_000) throw new StorageConnectorError('STS 凭证有效期不足 5 分钟。', 'expired');
  return { ...parsed.data, expiration };
}

async function createSession(profile: AliyunProfile): Promise<ConnectorSession> {
  const endpoint = endpointUrl(profile);
  if (!await ensureWebsitePermission(endpoint)) throw new StorageConnectorError('未获得阿里云 OSS 网站权限。', 'permission-denied');
  let accessKeyId = profile.accessKeyId;
  let accessKeySecret = profile.accessKeySecret;
  let stsToken: string | undefined;
  let credentialsExpireAt: number | undefined;
  let capabilities: StorageCapability[] = ['upload', 'signed-link', 'public-link'];

  if (profile.credentialMode === 'sts') {
    const sts = await requestSts(profile);
    accessKeyId = sts.accessKeyId;
    accessKeySecret = sts.accessKeySecret;
    stsToken = sts.securityToken;
    credentialsExpireAt = sts.expiration;
    capabilities = sts.capabilities;
  }

  const oss = new OSS({
    region: profile.region || undefined,
    endpoint: profile.endpoint || undefined,
    bucket: profile.bucket,
    accessKeyId,
    accessKeySecret,
    stsToken,
    secure: true,
  });

  let verified = false;
  let message = profile.credentialMode === 'sts' ? 'STS 临时凭证有效。' : '凭据已读取；上传权限会在首次上传时确认。';
  if (capabilities.includes('list') || profile.credentialMode === 'access-key') {
    try {
      await oss.list({ prefix: profile.prefix || undefined, 'max-keys': 1 }, { timeout: 10_000 });
      verified = true;
      if (!capabilities.includes('list')) capabilities = [...capabilities, 'list'];
      message = '连接成功，已验证读取权限；写入权限会在首次上传时确认。';
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'AccessDenied' && code !== 'NoSuchBucket') {
        message = '已建立连接，但无法验证文件列表权限；上传权限会在首次上传时确认。';
      } else if (code === 'NoSuchBucket') {
        throw new StorageConnectorError('找不到这个 Bucket，请检查地域和名称。', 'invalid-config');
      }
    }
  }

  return {
    profileId: profile.id,
    provider: 'aliyun-oss',
    capabilities: [...new Set(capabilities)],
    defaultAccess: profile.defaultAccess,
    ...(credentialsExpireAt ? { credentialsExpireAt } : {}),
    verified,
    message,
    client: { oss } satisfies AliyunSessionClient,
  };
}

function mapProviderError(error: unknown): never {
  if (error instanceof StorageConnectorError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
  const code = (error as { code?: string }).code;
  if (code === 'AccessDenied' || code === 'InvalidAccessKeyId') throw new StorageConnectorError('阿里云拒绝了操作，请检查 RAM 权限和 AccessKey。', 'permission-denied');
  if (code === 'SecurityTokenExpired' || code === 'InvalidSecurityToken') throw new StorageConnectorError('STS 临时凭证已经失效，请重新连接。', 'expired');
  throw new StorageConnectorError('阿里云 OSS 操作失败，请检查网络、地域和 Bucket。', 'provider-error');
}

export const aliyunConnector: StorageConnector = {
  id: 'aliyun-oss',
  validate(profile) {
    const aliyun = asAliyunProfile(profile);
    if (!aliyun) return ['连接器类型不匹配。'];
    const issues: string[] = [];
    if (!aliyun.region.trim() && !aliyun.endpoint.trim()) issues.push('请填写地域或 Endpoint。');
    const endpointIssue = endpointValidationIssue(aliyun.endpoint);
    if (endpointIssue) issues.push(endpointIssue);
    if (!aliyun.bucket.trim()) issues.push('请填写 Bucket。');
    if (aliyun.credentialMode === 'access-key' && !aliyun.accessKeyId.trim()) issues.push('请填写 AccessKey ID。');
    if (aliyun.credentialMode === 'access-key' && !aliyun.accessKeySecret.trim()) issues.push('请填写 AccessKey Secret。');
    if (aliyun.credentialMode === 'sts') {
      try {
        const url = new URL(aliyun.stsUrl);
        if (url.protocol !== 'https:') issues.push('STS 服务必须使用 HTTPS。');
      } catch {
        issues.push('请填写有效的 STS 服务地址。');
      }
    }
    return issues;
  },

  async connect(profile) {
    const aliyun = asAliyunProfile(profile);
    const issues = this.validate(profile);
    if (!aliyun || issues.length > 0) throw new StorageConnectorError(issues[0] ?? '连接配置不完整。', 'invalid-config');
    try {
      return await createSession(aliyun);
    } catch (error) {
      mapProviderError(error);
    }
  },

  async upload(input, profile, session) {
    const aliyun = asAliyunProfile(profile);
    if (!aliyun) throw new StorageConnectorError('阿里云连接配置已失效。', 'invalid-config');
    const oss = sessionClient(session);
    const key = objectKey(aliyun, input.fileName);
    const headers: Record<string, string> = {
      'Content-Type': input.contentType || 'application/octet-stream',
      'x-oss-object-acl': input.access === 'public' ? 'public-read' : 'private',
    };
    try {
      if (input.signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
      if (input.blob.size > 5 * 1024 * 1024) {
        await oss.multipartUpload(key, input.blob as File, {
          headers,
          progress: (value: number) => { input.onProgress?.(value); },
        });
      } else {
        await oss.put(key, input.blob as File, { headers });
        input.onProgress?.(1);
      }
      const access = input.access === 'public' ? 'public' : 'signed';
      const maxExpiry = session.credentialsExpireAt ? Math.max(60, Math.floor((session.credentialsExpireAt - Date.now()) / 1000)) : aliyun.signedUrlExpiresInSeconds;
      const expires = Math.min(aliyun.signedUrlExpiresInSeconds, maxExpiry);
      const url = access === 'public' ? publicObjectUrl(aliyun, key) : oss.signatureUrl(key, { expires });
      return {
        objectKey: key,
        url,
        size: input.blob.size,
        access,
        expiresAt: access === 'signed' ? Date.now() + expires * 1000 : null,
      };
    } catch (error) {
      mapProviderError(error);
    }
  },

  async list(profile, session, prefix) {
    const aliyun = asAliyunProfile(profile);
    if (!aliyun) throw new StorageConnectorError('阿里云连接配置已失效。', 'invalid-config');
    try {
      const response = await sessionClient(session).list({ prefix: prefix ?? aliyun.prefix, 'max-keys': 100 }, {});
      return (response.objects ?? []).map((object): RemoteFile => ({
        objectKey: object.name,
        name: object.name.split('/').pop() || object.name,
        size: Number(object.size) || 0,
        updatedAt: object.lastModified ? Date.parse(object.lastModified) : null,
        url: aliyun.defaultAccess === 'public' ? publicObjectUrl(aliyun, object.name) : null,
      }));
    } catch (error) {
      mapProviderError(error);
    }
  },

  async remove(profile, session, key) {
    if (!asAliyunProfile(profile)) throw new StorageConnectorError('阿里云连接配置已失效。', 'invalid-config');
    try {
      await sessionClient(session).delete(key);
    } catch (error) {
      mapProviderError(error);
    }
  },

  async rename(profile, session, key, nextKey) {
    if (!asAliyunProfile(profile)) throw new StorageConnectorError('阿里云连接配置已失效。', 'invalid-config');
    const oss = sessionClient(session);
    try {
      await oss.copy(nextKey, key);
      await oss.delete(key);
    } catch (error) {
      mapProviderError(error);
    }
  },
};
