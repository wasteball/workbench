import { APP_META } from '@/app/meta';
import type { FileCategoryRecord, ShareRecord } from '@/shared/persistence/database';
import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import { appSettingsSchema } from '@/shared/settings/schema';
import type { AppSettings } from '@/shared/types';
import { z } from 'zod';

export interface SettingsExportFile {
  product: typeof APP_META.name;
  formatVersion: 1;
  exportedAt: string;
  secretsIncluded: false;
  settings: AppSettings;
}

export interface WorkbenchBackupFile extends Omit<SettingsExportFile, 'formatVersion'> {
  formatVersion: 2;
  fileLibrary: {
    shares: ShareRecord[];
    categories: FileCategoryRecord[];
  };
}

export interface WorkbenchImport {
  settings: AppSettings;
  fileLibrary: WorkbenchBackupFile['fileLibrary'] | null;
}

const shareRecordSchema = z.object({
  id: z.string().min(1).max(200),
  fileName: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  size: z.number().nonnegative(),
  contentType: z.string().max(300),
  url: z.string().min(1).max(8_000),
  objectKey: z.string().max(2_000).nullable(),
  access: z.enum(['public', 'signed', 'authenticated', 'unknown']),
  expiresAt: z.number().nullable(),
  category: z.string().min(1).max(200),
  relativePath: z.string().max(2_000),
  storageProfileId: z.string().max(200),
  storageProvider: z.enum(['gateway', 'aliyun-oss']),
  createdAt: z.number().nonnegative(),
});

const fileCategorySchema = z.object({
  name: z.string().min(1).max(200),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
});

function isWebUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function createSettingsExport(settings: AppSettings): SettingsExportFile {
  return {
    product: APP_META.name,
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    secretsIncluded: false,
    settings: {
      ...settings,
      storageProfiles: settings.storageProfiles.map((profile) => {
        if (profile.provider === 'gateway') {
          return {
            ...profile,
            userCode: '',
            headers: profile.headers.map((header) => ({ ...header, value: '' })),
          };
        }
        return {
          ...profile,
          accessKeyId: '',
          accessKeySecret: '',
          rememberAccessKey: false,
          stsHeaders: profile.stsHeaders.map((header) => ({ ...header, value: '' })),
        };
      }),
    },
  };
}

export function createWorkbenchBackup(
  settings: AppSettings,
  shares: ShareRecord[],
  categories: FileCategoryRecord[],
): WorkbenchBackupFile {
  const settingsExport = createSettingsExport(settings);
  return {
    ...settingsExport,
    formatVersion: 2,
    fileLibrary: {
      shares: shares.map((record) => ({ ...record })),
      categories: categories.map((category) => ({ ...category })),
    },
  };
}

export function parseSettingsImport(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') throw new Error('配置文件格式不正确。');
  const record = value as Record<string, unknown>;
  const candidate = record.settings ?? record;
  if (!candidate || typeof candidate !== 'object' || (candidate as Record<string, unknown>).schemaVersion !== 1) {
    throw new Error('配置文件缺少必需字段或版本不受支持。');
  }
  const parsed = appSettingsSchema.safeParse({
    ...DEFAULT_SETTINGS,
    ...(candidate as Record<string, unknown>),
  });
  if (!parsed.success) throw new Error('配置文件缺少必需字段或版本不受支持。');
  return {
    ...parsed.data,
    storageProfiles: parsed.data.storageProfiles.map((profile) => {
      if (profile.provider === 'gateway') {
        return { ...profile, headers: profile.headers.map((header) => ({ ...header, value: '' })) };
      }
      return {
        ...profile,
        accessKeyId: '',
        accessKeySecret: '',
        rememberAccessKey: false,
        stsHeaders: profile.stsHeaders.map((header) => ({ ...header, value: '' })),
      };
    }),
  };
}

export function parseWorkbenchImport(value: unknown): WorkbenchImport {
  const settings = parseSettingsImport(value);
  if (!value || typeof value !== 'object') return { settings, fileLibrary: null };
  const record = value as Record<string, unknown>;
  if (record.formatVersion !== 2 || !record.fileLibrary || typeof record.fileLibrary !== 'object') {
    return { settings, fileLibrary: null };
  }
  const fileLibrary = record.fileLibrary as Record<string, unknown>;
  const sharesResult = z.array(shareRecordSchema).max(20_000).safeParse(fileLibrary.shares);
  const categoriesResult = z.array(fileCategorySchema).max(2_000).safeParse(fileLibrary.categories);
  if (!sharesResult.success || !categoriesResult.success || sharesResult.data.some((item) => !isWebUrl(item.url))) {
    throw new Error('备份中的文件库记录格式不正确。');
  }
  return {
    settings,
    fileLibrary: {
      shares: [...new Map(sharesResult.data.map((item) => [item.id, item])).values()],
      categories: [...new Map(categoriesResult.data.map((item) => [item.name, item])).values()],
    },
  };
}
