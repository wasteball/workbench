import { describe, expect, it } from 'vitest';

import {
  endpointUrl,
  endpointValidationIssue,
  publicObjectUrl,
} from '@/connectors/storage/aliyun-oss/aliyun-endpoint';
import type { AliyunProfile } from '@/shared/types';

const profile: AliyunProfile = {
  id: 'aliyun',
  provider: 'aliyun-oss',
  name: 'OSS',
  credentialMode: 'access-key',
  region: 'oss-cn-hangzhou',
  endpoint: '',
  bucket: 'example-bucket',
  prefix: 'workbench/',
  accessKeyId: '',
  accessKeySecret: '',
  rememberAccessKey: false,
  stsUrl: '',
  stsHeaders: [],
  defaultAccess: 'private',
  signedUrlExpiresInSeconds: 3600,
};

describe('Aliyun endpoint URLs', () => {
  it('builds standard and custom virtual-host URLs without duplicating the bucket', () => {
    expect(endpointUrl(profile)).toBe('https://example-bucket.oss-cn-hangzhou.aliyuncs.com/');
    expect(endpointUrl({ ...profile, endpoint: 'https://example-bucket.oss.example.com:8443' }))
      .toBe('https://example-bucket.oss.example.com:8443/');
    expect(publicObjectUrl(
      { ...profile, endpoint: 'https://example-bucket.oss.example.com' },
      'workbench/示例 文档.md',
    )).toBe('https://example-bucket.oss.example.com/workbench/%E7%A4%BA%E4%BE%8B%20%E6%96%87%E6%A1%A3.md');
  });

  it('rejects insecure or ambiguous custom endpoints', () => {
    expect(endpointValidationIssue('oss-cn-hangzhou.aliyuncs.com')).toBeNull();
    expect(endpointValidationIssue('http://oss-cn-hangzhou.aliyuncs.com')).toBe('Endpoint 必须使用 HTTPS。');
    expect(endpointValidationIssue('https://user@example.com/path')).not.toBeNull();
  });
});
