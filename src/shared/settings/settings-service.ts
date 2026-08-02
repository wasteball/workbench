import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import {
  prepareSettingsForStorage,
  type SessionSecrets,
} from '@/shared/settings/settings-persistence';
import { appSettingsSchema } from '@/shared/settings/schema';
import type { AppSettings } from '@/shared/types';

const SETTINGS_KEY = 'workbench:settings:v1';
const SESSION_SECRETS_KEY = 'workbench:session-secrets:v1';

let memorySessionSecrets: SessionSecrets = {};

function mergeDefaults(value: unknown): AppSettings {
  const candidate = {
    ...DEFAULT_SETTINGS,
    ...(value && typeof value === 'object' ? value : {}),
  };
  const parsed = appSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

async function readSessionSecrets(): Promise<SessionSecrets> {
  try {
    const stored = await browser.storage.session?.get(SESSION_SECRETS_KEY);
    const value = stored?.[SESSION_SECRETS_KEY];
    if (value && typeof value === 'object') {
      memorySessionSecrets = value as SessionSecrets;
    }
  } catch {
    // Safari versions without storage.session keep secrets in memory for this run.
  }
  return memorySessionSecrets;
}

async function writeSessionSecrets(secrets: SessionSecrets): Promise<void> {
  memorySessionSecrets = secrets;
  try {
    await browser.storage.session?.set({ [SESSION_SECRETS_KEY]: secrets });
  } catch {
    // The in-memory fallback is intentionally not persisted.
  }
}

async function hydrateSessionSecrets(settings: AppSettings): Promise<AppSettings> {
  const secrets = await readSessionSecrets();
  return {
    ...settings,
    storageProfiles: settings.storageProfiles.map((profile) => {
      if (
        profile.provider !== 'aliyun-oss' ||
        profile.credentialMode !== 'access-key' ||
        profile.rememberAccessKey
      ) {
        return profile;
      }
      return { ...profile, accessKeySecret: secrets[profile.id] ?? '' };
    }),
  };
}

async function prepareForStorage(settings: AppSettings): Promise<AppSettings> {
  const { persistable, sessionSecrets } = prepareSettingsForStorage(settings);
  await writeSessionSecrets(sessionSecrets);
  return persistable;
}

export const settingsService = {
  async read(): Promise<AppSettings> {
    const stored = await browser.storage.local.get(SETTINGS_KEY);
    return hydrateSessionSecrets(mergeDefaults(stored[SETTINGS_KEY]));
  },

  async write(settings: AppSettings): Promise<void> {
    const parsed = appSettingsSchema.parse(settings);
    const persistable = await prepareForStorage(parsed);
    await browser.storage.local.set({ [SETTINGS_KEY]: persistable });
  },

  async patch(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = mergeDefaults({ ...(await this.read()), ...patch });
    await this.write(next);
    return next;
  },

  async reset(): Promise<AppSettings> {
    await writeSessionSecrets({});
    await browser.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    return DEFAULT_SETTINGS;
  },

  subscribe(listener: (settings: AppSettings) => void): () => void {
    const handler = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
      void hydrateSessionSecrets(mergeDefaults(changes[SETTINGS_KEY].newValue)).then(listener);
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  },
};
