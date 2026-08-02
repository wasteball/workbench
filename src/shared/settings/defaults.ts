import type { AppSettings } from '@/shared/types';

export const DEFAULT_CAPABILITY_ORDER = ['home', 'markdown', 'files', 'tools'];

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  theme: 'system',
  accentColor: 'indigo',
  readingFont: 'serif',
  readingFontSize: 18,
  readingWidth: 860,
  markdownRailOpen: true,
  markdownFilesOpen: true,
  markdownOutlineOpen: true,
  reviewShowMarks: true,
  menuOrder: DEFAULT_CAPABILITY_ORDER,
  hiddenCapabilities: [],
  pinnedCapabilities: ['markdown', 'files'],
  customTools: [],
  storageProfiles: [],
  activeStorageProfileId: null,
  defaultExportFormat: 'html',
  defaultShareFormat: 'html',
  autoCopyShareLink: true,
  uploadConcurrency: 3,
  shareCopyFormat: 'name-and-link',
};
