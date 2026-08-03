import type { GatewayProfile } from '@/shared/types';
import { ensureWebsitePermission } from '@/platform/permissions/website-permission';
import {
  type StorageConnector,
  StorageConnectorError,
  type UploadInput,
  type UploadResult,
} from '@/connectors/storage/contract';

function asGatewayProfile(profile: Parameters<StorageConnector['validate']>[0]): GatewayProfile | null {
  return profile.provider === 'gateway' ? profile : null;
}

/** Keep the legacy gateway's form contract behind the simple boolean UI. */
export function gatewayFormFlags(profile: Pick<GatewayProfile, 'cdn' | 'publicRead'>): {
  cdn: 'true' | 'false';
  publicRead: '1' | '0';
} {
  return {
    cdn: profile.cdn ? 'true' : 'false',
    publicRead: profile.publicRead ? '1' : '0',
  };
}

function responseLink(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : null;
  const candidate = data?.downUrl ?? record.downUrl;
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function uploadWithProgress(
  profile: GatewayProfile,
  input: UploadInput,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    const flags = gatewayFormFlags(profile);
    form.append('file', input.blob, input.fileName);
    form.append('bucket', profile.bucket);
    form.append('cdn', flags.cdn);
    form.append('publicRead', flags.publicRead);
    form.append('userCode', profile.userCode);
    request.open('POST', profile.apiUrl, true);
    request.timeout = 120_000;
    for (const header of profile.headers) {
      if (header.key.trim()) request.setRequestHeader(header.key.trim(), header.value);
    }
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        payload = null;
      }
      if (request.status < 200 || request.status >= 300) {
        const detail = payload && typeof payload === 'object'
          ? [
            (payload as Record<string, unknown>).message,
            (payload as Record<string, unknown>).msg,
            (payload as Record<string, unknown>).errMsg,
          ].find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
          : request.responseText.trim().replace(/\s+/g, ' ').slice(0, 180);
        reject(new StorageConnectorError(
          `上传失败（HTTP ${request.status}）${detail ? `：${detail}` : '。'}`,
          request.status === 401 || request.status === 403 ? 'permission-denied' : 'provider-error',
        ));
        return;
      }
      if (!payload) {
        reject(new StorageConnectorError('上传服务返回了无法识别的内容。', 'provider-error'));
        return;
      }
      const url = responseLink(payload);
      if (!url) {
        reject(new StorageConnectorError('上传服务没有返回有效的文件链接。', 'provider-error'));
        return;
      }
      resolve({ objectKey: null, url, size: input.blob.size, access: 'unknown', expiresAt: null });
    });
    request.addEventListener('error', () => reject(new StorageConnectorError('无法连接上传服务，请检查网络、地址和 CORS 设置（服务端需要允许当前 Workbench 扩展来源）。', 'network')));
    request.addEventListener('timeout', () => reject(new StorageConnectorError('上传在 120 秒内没有完成。', 'network')));
    request.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')));
    input.signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(form);
  });
}

export const gatewayConnector: StorageConnector = {
  id: 'gateway',
  validate(profile) {
    const gateway = asGatewayProfile(profile);
    if (!gateway) return ['连接器类型不匹配。'];
    const issues: string[] = [];
    try {
      const url = new URL(gateway.apiUrl);
      if (!['http:', 'https:'].includes(url.protocol)) issues.push('API 地址必须使用 http 或 https。');
    } catch {
      issues.push('请填写有效的 API 地址。');
    }
    if (!gateway.bucket.trim()) issues.push('请填写 Bucket。');
    if (!gateway.userCode.trim()) issues.push('请填写用户标识。');
    return issues;
  },

  async connect(profile) {
    const gateway = asGatewayProfile(profile);
    const issues = this.validate(profile);
    if (!gateway || issues.length > 0) throw new StorageConnectorError(issues[0] ?? '连接配置不完整。', 'invalid-config');
    if (!await ensureWebsitePermission(gateway.apiUrl)) throw new StorageConnectorError('未获得上传服务的网站权限。', 'permission-denied');
    return {
      profileId: gateway.id,
      provider: 'gateway',
      capabilities: ['upload', 'returned-link'],
      defaultAccess: 'provider-managed',
      verified: false,
      message: '配置格式有效；网关没有提供无副作用的测试接口，实际权限会在首次上传时确认。',
    };
  },

  async upload(input, profile, session) {
    const gateway = asGatewayProfile(profile);
    if (!gateway || session.provider !== 'gateway') throw new StorageConnectorError('上传连接已失效。', 'invalid-config');
    return uploadWithProgress(gateway, input);
  },
};
