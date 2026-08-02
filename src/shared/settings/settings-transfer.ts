import { APP_META } from '@/app/meta';
import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import { appSettingsSchema } from '@/shared/settings/schema';
import type { AppSettings } from '@/shared/types';

export interface SettingsExportFile {
  product: typeof APP_META.name;
  formatVersion: 1;
  exportedAt: string;
  secretsIncluded: false;
  settings: AppSettings;
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
