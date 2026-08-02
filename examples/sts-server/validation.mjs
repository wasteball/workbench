const REQUEST_FIELDS = new Set(['region', 'bucket', 'prefix']);

export class InvalidRequestError extends Error {}

export function normalizePrefix(value) {
  const normalized = value.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  const hasUnsafeCharacter = [...normalized].some(
    (character) => character.charCodeAt(0) <= 0x1f || '\\?#'.includes(character),
  );
  if (!normalized || normalized.includes('..') || hasUnsafeCharacter) {
    throw new Error('OSS_PREFIX must be a non-empty safe object prefix.');
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

export function parseAllowedOrigins(value) {
  const origins = [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean))];
  if (origins.length === 0) throw new Error('ALLOWED_ORIGINS must contain at least one extension origin.');
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      !['chrome-extension:', 'safari-web-extension:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname ||
      url.search ||
      url.hash
    ) {
      throw new Error(`ALLOWED_ORIGINS contains an invalid extension origin: ${origin}`);
    }
  }
  return new Set(origins);
}

export function parseBearerToken(value) {
  if (value.length < 32) throw new Error('WORKBENCH_STS_TOKEN must contain at least 32 characters.');
  return value;
}

export function parseDurationSeconds(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 900 || duration > 3600) {
    throw new Error('STS_DURATION_SECONDS must be an integer from 900 to 3600.');
  }
  return duration;
}

export function parseRequestInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidRequestError();
  if (Object.keys(value).some((field) => !REQUEST_FIELDS.has(field))) throw new InvalidRequestError();
  if (
    typeof value.region !== 'string' ||
    typeof value.bucket !== 'string' ||
    typeof value.prefix !== 'string' ||
    !value.region ||
    !value.bucket ||
    !value.prefix
  ) {
    throw new InvalidRequestError();
  }
  try {
    return { region: value.region, bucket: value.bucket, prefix: normalizePrefix(value.prefix) };
  } catch {
    throw new InvalidRequestError();
  }
}
