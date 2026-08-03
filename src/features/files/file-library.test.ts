import { describe, expect, it } from 'vitest';

import {
  basename,
  fileKindForName,
  normalizeCategoryName,
  topFolder,
} from '@/features/files/file-library';

describe('file library helpers', () => {
  it('classifies common files by extension', () => {
    expect(fileKindForName('说明.md')).toBe('document');
    expect(fileKindForName('数据.XLSX')).toBe('sheet');
    expect(fileKindForName('照片.webp')).toBe('image');
    expect(fileKindForName('没有后缀')).toBe('other');
  });

  it('keeps folder paths separate from the visible file name', () => {
    expect(basename('项目资料/第二章/说明.md')).toBe('说明.md');
    expect(topFolder('项目资料/第二章/说明.md')).toBe('项目资料');
    expect(topFolder('说明.md')).toBeNull();
  });

  it('normalizes category names without losing Chinese text', () => {
    expect(normalizeCategoryName('  项目   资料  ')).toBe('项目 资料');
  });
});
