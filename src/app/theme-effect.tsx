import { useEffect } from 'react';

import { useSettings } from '@/app/settings-context';

export function ThemeEffect() {
  const { settings } = useSettings();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = settings.accentColor;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.accentColor, settings.theme]);

  return null;
}
