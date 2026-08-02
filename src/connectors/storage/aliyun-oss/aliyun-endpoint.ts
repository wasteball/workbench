import type { AliyunProfile } from '@/shared/types';

function parseEndpoint(value: string): URL {
  return new URL(value.includes('://') ? value : `https://${value}`);
}

export function endpointValidationIssue(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const endpoint = parseEndpoint(value);
    if (endpoint.protocol !== 'https:') return 'Endpoint 必须使用 HTTPS。';
    if (
      !endpoint.hostname ||
      endpoint.username ||
      endpoint.password ||
      (endpoint.pathname && endpoint.pathname !== '/') ||
      endpoint.search ||
      endpoint.hash
    ) {
      return 'Endpoint 只能填写 HTTPS 主机地址，不能包含凭据、路径或参数。';
    }
    return null;
  } catch {
    return '请填写有效的 Endpoint。';
  }
}

export function endpointUrl(profile: AliyunProfile): string {
  if (!profile.endpoint.trim()) {
    return `https://${profile.bucket}.${profile.region}.aliyuncs.com/`;
  }
  const endpoint = parseEndpoint(profile.endpoint);
  if (!endpoint.hostname.startsWith(`${profile.bucket}.`)) {
    endpoint.hostname = `${profile.bucket}.${endpoint.hostname}`;
  }
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function publicObjectUrl(profile: AliyunProfile, objectKey: string): string {
  const endpoint = new URL(endpointUrl(profile));
  endpoint.pathname = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  return endpoint.toString();
}
