import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import remarkParse from 'remark-parse';
import { unified } from 'unified';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignoredDirectories = new Set([
  '.git',
  '.output',
  '.wxt',
  'coverage',
  'node_modules',
]);

function collectMarkdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(absolutePath));
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(absolutePath);
  }
  return files;
}

function portablePath(absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join('/');
}

function visit(node, callback) {
  callback(node);
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) visit(child, callback);
}

function localTarget(url) {
  if (!url || url.startsWith('#') || url.startsWith('//')) return null;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(url)) return null;
  return url.split('#', 1)[0].split('?', 1)[0];
}

const processor = unified().use(remarkParse);
const findings = [];

for (const markdownPath of collectMarkdownFiles(projectRoot)) {
  const tree = processor.parse(readFileSync(markdownPath, 'utf8'));
  visit(tree, (node) => {
    if (!['definition', 'image', 'link'].includes(node.type)) return;
    const rawTarget = localTarget(node.url);
    if (rawTarget === null || rawTarget === '') return;
    const source = portablePath(markdownPath);
    const line = node.position?.start?.line ?? 1;
    if (rawTarget.startsWith('/')) {
      findings.push(`${source}:${line}: root-relative link is not portable: ${node.url}`);
      return;
    }

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(rawTarget);
    } catch {
      findings.push(`${source}:${line}: link contains invalid percent encoding: ${node.url}`);
      return;
    }

    const absoluteTarget = resolve(dirname(markdownPath), decodedTarget);
    const relativeTarget = relative(projectRoot, absoluteTarget);
    if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)) {
      findings.push(`${source}:${line}: link leaves the project: ${node.url}`);
      return;
    }
    if (!existsSync(absoluteTarget)) {
      findings.push(`${source}:${line}: target does not exist: ${node.url}`);
    }
  });
}

if (findings.length > 0) {
  console.error('Markdown link check failed:');
  for (const finding of findings.sort()) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Markdown link check passed. All local targets exist.');
}
