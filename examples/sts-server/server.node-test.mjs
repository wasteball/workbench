import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidRequestError,
  normalizePrefix,
  parseAllowedOrigins,
  parseBearerToken,
  parseDurationSeconds,
  parseRequestInput,
} from './validation.mjs';

test('normalizes safe object prefixes', () => {
  assert.equal(normalizePrefix('/workbench//documents'), 'workbench/documents/');
  assert.throws(() => normalizePrefix('../private/'));
  assert.throws(() => normalizePrefix('workbench\\private/'));
});

test('accepts only exact browser extension origins', () => {
  const origins = parseAllowedOrigins(
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop,safari-web-extension://com.example.workbench',
  );
  assert.equal(origins.size, 2);
  assert.throws(() => parseAllowedOrigins('*'));
  assert.throws(() => parseAllowedOrigins('https://example.com'));
  assert.throws(() => parseAllowedOrigins('chrome-extension://extension-id/path'));
});

test('requires strong tokens and bounded STS durations', () => {
  assert.equal(parseBearerToken('x'.repeat(32)), 'x'.repeat(32));
  assert.throws(() => parseBearerToken('too-short'));
  assert.equal(parseDurationSeconds('900'), 900);
  assert.equal(parseDurationSeconds('3600'), 3600);
  assert.throws(() => parseDurationSeconds('899'));
  assert.throws(() => parseDurationSeconds('3601'));
  assert.throws(() => parseDurationSeconds('not-a-number'));
});

test('rejects malformed requests and unknown fields', () => {
  const input = parseRequestInput({
    region: 'oss-cn-hangzhou',
    bucket: 'example-bucket',
    prefix: '/workbench//',
  });
  assert.deepEqual(input, {
    region: 'oss-cn-hangzhou',
    bucket: 'example-bucket',
    prefix: 'workbench/',
  });
  assert.throws(() => parseRequestInput(null), InvalidRequestError);
  assert.throws(() => parseRequestInput([]), InvalidRequestError);
  assert.throws(
    () => parseRequestInput({ ...input, unexpectedCapability: 'remove' }),
    InvalidRequestError,
  );
  assert.throws(() => parseRequestInput({ ...input, prefix: '../private/' }), InvalidRequestError);
});
