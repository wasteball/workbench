import { defineConfig } from 'wxt';

import { APP_META } from './src/app/meta';

const OPTIONAL_HOST_PERMISSIONS = ['https://*/*', 'http://*/*'];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: APP_META.name,
    short_name: APP_META.shortName,
    description: APP_META.description,
    permissions: ['storage', 'downloads'],
    optional_permissions: ['clipboardWrite'],
    optional_host_permissions: OPTIONAL_HOST_PERMISSIONS,
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: APP_META.name,
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
  },
});
