import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OmniSearch',
    description: 'PowerToys Run-like quick launcher with site search, history, and dictionary',
    version: '1.1.0',
    permissions: ['storage', 'history', 'tabs', 'bookmarks', 'offscreen', 'unlimitedStorage', 'favicon'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
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
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
    build: {
      target: 'esnext',
    },
  }),
});
