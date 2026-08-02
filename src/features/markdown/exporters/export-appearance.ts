import type { ExportAppearance } from '@/features/markdown/exporters/contract';
import type { AppSettings } from '@/shared/types';

export function exportAppearanceFromSettings(settings: AppSettings): ExportAppearance {
  return {
    theme: settings.theme,
    accentColor: settings.accentColor,
    readingFont: settings.readingFont,
    readingFontSize: settings.readingFontSize,
    readingWidth: settings.readingWidth,
  };
}
