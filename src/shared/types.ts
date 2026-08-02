export type ThemePreference = 'system' | 'light' | 'dark';

export type AccentColor = 'indigo' | 'amber' | 'blue' | 'green' | 'pink' | 'cyan';

export type ReadingFont = 'serif' | 'sans';

export type StorageProviderId = 'gateway' | 'aliyun-oss';

export type AliyunCredentialMode = 'access-key' | 'sts';

export type ShareCopyFormat = 'name-and-link' | 'markdown' | 'single-line' | 'link-only';

export type FileDestination =
  | 'browser-draft'
  | 'original-file'
  | 'downloaded-copy'
  | 'online-share';

export interface CustomTool {
  id: string;
  name: string;
  url: string;
  icon: string;
  createdAt: number;
}

export interface GatewayProfile {
  id: string;
  provider: 'gateway';
  name: string;
  apiUrl: string;
  bucket: string;
  userCode: string;
  cdn: boolean;
  publicRead: boolean;
  headers: Array<{ key: string; value: string }>;
}

export interface AliyunProfile {
  id: string;
  provider: 'aliyun-oss';
  name: string;
  credentialMode: AliyunCredentialMode;
  region: string;
  endpoint: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  accessKeySecret: string;
  rememberAccessKey: boolean;
  stsUrl: string;
  stsHeaders: Array<{ key: string; value: string }>;
  defaultAccess: 'private' | 'public';
  signedUrlExpiresInSeconds: number;
}

export type StorageProfile = GatewayProfile | AliyunProfile;

export interface AppSettings {
  schemaVersion: 1;
  theme: ThemePreference;
  accentColor: AccentColor;
  readingFont: ReadingFont;
  readingFontSize: number;
  readingWidth: number;
  menuOrder: string[];
  hiddenCapabilities: string[];
  pinnedCapabilities: string[];
  customTools: CustomTool[];
  storageProfiles: StorageProfile[];
  activeStorageProfileId: string | null;
  defaultExportFormat: 'html' | 'docx' | 'markdown';
  defaultShareFormat: 'html' | 'docx' | 'markdown';
  autoCopyShareLink: boolean;
  uploadConcurrency: 1 | 2 | 3 | 5;
  shareCopyFormat: ShareCopyFormat;
}

export interface RecentDocument {
  id: string;
  title: string;
  source: 'new' | 'file' | 'url';
  sourceLabel: string;
  updatedAt: number;
  hasRecoveryDraft: boolean;
}
