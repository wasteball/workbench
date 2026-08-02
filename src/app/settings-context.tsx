import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { DEFAULT_SETTINGS } from '@/shared/settings/defaults';
import { settingsService } from '@/shared/settings/settings-service';
import type { AppSettings } from '@/shared/types';

interface SettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void settingsService.read().then((value) => {
      if (!active) return;
      setSettings(value);
      setLoading(false);
    });
    const unsubscribe = settingsService.subscribe(setSettings);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await settingsService.patch(patch);
    setSettings(next);
  }, []);

  const value = useMemo(() => ({ settings, loading, update }), [loading, settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}
