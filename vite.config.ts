import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';



const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'binaa-offline-shell',
      apply: 'build',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle).filter(name => !name.endsWith('.map'));
        const hash = createHash('sha256');
        for (const item of Object.values(bundle)) {
          hash.update(item.fileName);
          hash.update(item.type === 'chunk' ? item.code : item.source);
        }
        const version = hash.digest('hex').slice(0, 12);
        const files = ['index.html', ...assets, 'logo.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
        this.emitFile({
          type: 'asset', fileName: 'sw.js',
          source: `
const CACHE = 'binaa-shell-${version}';
const SCOPE = self.registration.scope;
const FILES = ${JSON.stringify([...new Set(files)])}.map(p => new URL(p, SCOPE).href);
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('binaa-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (!url.startsWith(SCOPE)) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.open(CACHE).then(c => c.match(new URL('index.html', SCOPE).href))));
    return;
  }
  if (!FILES.includes(url)) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request))));
});
`,
        });
      },
    },

  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'docs'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
