import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignoredDirectories = new Set([
  '.git',
  '.output',
  '.wxt',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);
const ignoredFiles = new Set(['scripts/release-scan.mjs']);

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolutePath));
    if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function portablePath(absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join('/');
}

function isText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return !sample.includes(0);
}

const retiredBrand = new RegExp(['an', 'nto'].join(''), 'i');
const forbiddenPatterns = [
  { label: 'retired company brand', pattern: retiredBrand },
  { label: 'private key material', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'Aliyun AccessKey ID', pattern: /\bLTAI[A-Za-z0-9]{12,}\b/ },
  { label: 'machine-specific absolute path', pattern: /(?:\b[A-Z]:\\(?:Users|04 Workbench)\\|\/mnt\/[a-z]\/[\w./ -]+)/i },
  { label: 'runtime public CDN or proxy', pattern: /\b(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|corsproxy\.io)\b/i },
  { label: 'wildcard postMessage target', pattern: /postMessage\s*\([^,\n]+,\s*['"]\*['"]/ },
];
const privateRuntimeUrl = /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/i;
const findings = [];

for (const absolutePath of collectFiles(projectRoot)) {
  const path = portablePath(absolutePath);
  if (ignoredFiles.has(path)) continue;
  if (basename(path) === '.env' || (/\.env\./.test(basename(path)) && basename(path) !== '.env.example')) {
    findings.push(`${path}: environment file must not be released`);
    continue;
  }
  if (statSync(absolutePath).size > 2 * 1024 * 1024) continue;
  const buffer = readFileSync(absolutePath);
  if (!isText(buffer)) continue;
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  for (const { label, pattern } of forbiddenPatterns) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) findings.push(`${path}:${index + 1}: ${label}`);
    });
  }
  if ((path.startsWith('src/') || path === 'wxt.config.ts') && privateRuntimeUrl.test(text)) {
    findings.push(`${path}: private or localhost runtime URL`);
  }
}

const defaultsPath = resolve(projectRoot, 'src/shared/settings/defaults.ts');
const defaults = readFileSync(defaultsPath, 'utf8');
const defaultsToNoStorage = /storageProfiles:\s*\[\s*\]/s.test(defaults);
if (defaultsToNoStorage) {
  if (!/activeStorageProfileId:\s*null/.test(defaults)) {
    findings.push('src/shared/settings/defaults.ts: active storage must be null when no storage is configured');
  }
} else {
  for (const field of ['apiUrl', 'bucket', 'userCode']) {
    if (!new RegExp(`${field}:\\s*''`).test(defaults)) {
      findings.push(`src/shared/settings/defaults.ts: ${field} must default to an empty string`);
    }
  }
}
for (const field of ['accessKeyId', 'accessKeySecret']) {
  if (new RegExp(`${field}:\\s*['"][^'"]+['"]`).test(defaults)) {
    findings.push(`src/shared/settings/defaults.ts: ${field} must not have a default value`);
  }
}

const manifestConfig = readFileSync(resolve(projectRoot, 'wxt.config.ts'), 'utf8');
if (/permissions:\s*\[[^\]]*<all_urls>/s.test(manifestConfig)) {
  findings.push('wxt.config.ts: <all_urls> must not be an install-time permission');
}

if (findings.length > 0) {
  console.error('Release scan failed:');
  for (const finding of [...new Set(findings)].sort()) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Release scan passed. No forbidden release content was found.');
}
