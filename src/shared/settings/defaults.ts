import type { AppSettings } from '@/shared/types';

export const DEFAULT_CAPABILITY_ORDER = ['home', 'markdown', 'files', 'tools'];

export const DEFAULT_GATEWAY_PROFILE_ID = 'gateway-default';

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  theme: 'system',
  menuOrder: DEFAULT_CAPABILITY_ORDER,
  hiddenCapabilities: [],
  pinnedCapabilities: ['markdown', 'files'],
  customTools: [],
  storageProfiles: [
    {
      id: DEFAULT_GATEWAY_PROFILE_ID,
      provider: 'gateway',
      name: '上传网关',
      apiUrl: '',
      bucket: '',
      userCode: '',
      cdn: false,
      publicRead: false,
      headers: [],
    },
  ],
  activeStorageProfileId: DEFAULT_GATEWAY_PROFILE_ID,
  defaultExportFormat: 'html',
  defaultShareFormat: 'html',
  autoCopyShareLink: true,
  uploadConcurrency: 3,
  shareCopyFormat: 'name-and-link',
};
