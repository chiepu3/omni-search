import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OmniSearch',
    description: 'PowerToys Run-like quick launcher with site search, history, and dictionary',
    version: '0.1.0',
    permissions: ['storage', 'history', 'tabs', 'bookmarks'],
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-search': {
        suggested_key: {
          default: 'Alt+Shift+K',
          mac: 'Alt+Shift+K',
        },
        description: 'Toggle OmniSearch',
      },
    },
  },
  vite: () => ({
    build: {
      target: 'esnext',
    },
  }),
});
