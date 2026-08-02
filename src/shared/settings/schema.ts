import { z } from 'zod';

const headerSchema = z.object({ key: z.string(), value: z.string() });

const gatewayProfileSchema = z.object({
  id: z.string(),
  provider: z.literal('gateway'),
  name: z.string(),
  apiUrl: z.string(),
  bucket: z.string(),
  userCode: z.string(),
  cdn: z.boolean(),
  publicRead: z.boolean(),
  headers: z.array(headerSchema),
});

const aliyunProfileSchema = z.object({
  id: z.string(),
  provider: z.literal('aliyun-oss'),
  name: z.string(),
  credentialMode: z.enum(['access-key', 'sts']),
  region: z.string(),
  endpoint: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  accessKeyId: z.string(),
  accessKeySecret: z.string(),
  rememberAccessKey: z.boolean(),
  stsUrl: z.string(),
  stsHeaders: z.array(headerSchema),
  defaultAccess: z.enum(['private', 'public']),
  signedUrlExpiresInSeconds: z.number().int().min(60).max(86400),
});

export const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  theme: z.enum(['system', 'light', 'dark']),
  menuOrder: z.array(z.string()),
  hiddenCapabilities: z.array(z.string()),
  pinnedCapabilities: z.array(z.string()),
  customTools: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      icon: z.string(),
      createdAt: z.number(),
    }),
  ),
  storageProfiles: z.array(z.discriminatedUnion('provider', [gatewayProfileSchema, aliyunProfileSchema])),
  activeStorageProfileId: z.string().nullable(),
  defaultExportFormat: z.enum(['html', 'docx', 'markdown']),
  defaultShareFormat: z.enum(['html', 'docx', 'markdown']),
  autoCopyShareLink: z.boolean(),
  uploadConcurrency: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)]),
  shareCopyFormat: z.enum(['name-and-link', 'markdown', 'single-line', 'link-only']),
});
