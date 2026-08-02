import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import {
  InvalidRequestError,
  normalizePrefix,
  parseAllowedOrigins,
  parseBearerToken,
  parseDurationSeconds,
  parseRequestInput,
} from './validation.mjs';

const ALLOWED_CAPABILITIES = new Set([
  'upload',
  'list',
  'remove',
  'rename',
  'signed-link',
  'public-link',
]);
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = {
  port: Number(process.env.PORT || 8787),
  allowedOrigins: parseAllowedOrigins(required('ALLOWED_ORIGINS')),
  bearerToken: parseBearerToken(required('WORKBENCH_STS_TOKEN')),
  accessKeyId: required('ALIYUN_ACCESS_KEY_ID'),
  accessKeySecret: required('ALIYUN_ACCESS_KEY_SECRET'),
  roleArn: required('ALIYUN_ROLE_ARN'),
  region: required('OSS_REGION'),
  bucket: required('OSS_BUCKET'),
  prefix: normalizePrefix(process.env.OSS_PREFIX || 'workbench/'),
  capabilities: parseCapabilities(process.env.OSS_CAPABILITIES || 'upload,list,signed-link'),
  durationSeconds: parseDurationSeconds(process.env.STS_DURATION_SECONDS || 3600),
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

function parseCapabilities(value) {
  const capabilities = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (!capabilities.includes('upload')) throw new Error('OSS_CAPABILITIES must include upload.');
  for (const capability of capabilities) {
    if (!ALLOWED_CAPABILITIES.has(capability)) throw new Error(`Unknown capability: ${capability}`);
  }
  return capabilities;
}

function secureTokenEquals(received, expected) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sessionPolicy() {
  const objectResource = `acs:oss:*:*:${config.bucket}/${config.prefix}*`;
  const statements = [];
  const objectActions = new Set();

  if (config.capabilities.includes('upload')) {
    [
      'oss:PutObject',
      'oss:InitiateMultipartUpload',
      'oss:UploadPart',
      'oss:CompleteMultipartUpload',
      'oss:AbortMultipartUpload',
    ].forEach((action) => objectActions.add(action));
  }
  if (config.capabilities.includes('signed-link') || config.capabilities.includes('rename')) {
    objectActions.add('oss:GetObject');
  }
  if (config.capabilities.includes('remove') || config.capabilities.includes('rename')) {
    objectActions.add('oss:DeleteObject');
  }
  if (config.capabilities.includes('public-link')) objectActions.add('oss:PutObjectAcl');

  statements.push({ Effect: 'Allow', Action: [...objectActions], Resource: [objectResource] });
  if (config.capabilities.includes('list')) {
    statements.push({
      Effect: 'Allow',
      Action: ['oss:ListObjects'],
      Resource: [`acs:oss:*:*:${config.bucket}`],
      Condition: { StringLike: { 'oss:Prefix': [`${config.prefix}*`] } },
    });
  }

  return JSON.stringify({ Version: '1', Statement: statements });
}

async function assumeRole() {
  const parameters = {
    AccessKeyId: config.accessKeyId,
    Action: 'AssumeRole',
    DurationSeconds: String(config.durationSeconds),
    Format: 'JSON',
    Policy: sessionPolicy(),
    RoleArn: config.roleArn,
    RoleSessionName: `workbench-${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2015-04-01',
  };
  const canonicalQuery = Object.keys(parameters)
    .sort()
    .map((key) => `${encode(key)}=${encode(parameters[key])}`)
    .join('&');
  const stringToSign = `POST&${encode('/')}&${encode(canonicalQuery)}`;
  const signature = createHmac('sha1', `${config.accessKeySecret}&`).update(stringToSign).digest('base64');
  const body = `${canonicalQuery}&Signature=${encode(signature)}`;
  const response = await fetch('https://sts.aliyuncs.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.Credentials) throw new Error(`AssumeRole failed with HTTP ${response.status}`);
  return payload.Credentials;
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  if (!config.allowedOrigins.has(origin)) {
    sendJson(response, 403, { code: 'origin_not_allowed', message: 'This origin is not allowed.' }, 'null');
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/workbench/sts') {
    sendJson(response, 404, { code: 'not_found', message: 'Not found.' }, origin);
    return;
  }
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ') || !secureTokenEquals(authorization.slice(7), config.bearerToken)) {
    sendJson(response, 401, { code: 'not_authorized', message: 'Authentication failed.' }, origin);
    return;
  }

  try {
    const input = parseRequestInput(await readJson(request));
    if (
      input.region !== config.region ||
      input.bucket !== config.bucket ||
      input.prefix !== config.prefix
    ) {
      sendJson(response, 403, { code: 'target_not_allowed', message: 'The requested storage target is not allowed.' }, origin);
      return;
    }
    const credentials = await assumeRole();
    sendJson(response, 200, {
      accessKeyId: credentials.AccessKeyId,
      accessKeySecret: credentials.AccessKeySecret,
      securityToken: credentials.SecurityToken,
      expiration: credentials.Expiration,
      capabilities: config.capabilities,
    }, origin);
  } catch (error) {
    const invalidJson = error instanceof SyntaxError;
    const invalidRequest = error instanceof InvalidRequestError;
    const status = invalidJson || invalidRequest ? 400 : error?.message === 'request_too_large' ? 413 : 503;
    sendJson(response, status, {
      code: invalidJson
        ? 'invalid_json'
        : invalidRequest
          ? 'invalid_request'
          : status === 413
            ? 'request_too_large'
            : 'sts_unavailable',
      message: status === 503 ? 'Temporary credentials are unavailable.' : 'The request is invalid.',
    }, origin);
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Workbench STS example listening on http://127.0.0.1:${config.port}`);
});
