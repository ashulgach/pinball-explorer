import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

// Patch ext2fs on disk before esbuild runs:
// 1. fs.js: reassigns `const path` and `const toRead` — esbuild rejects this
// 2. libext2fs.js: Emscripten detects Node via process.versions.node (set by
//    vite-plugin-node-polyfills), then tries fs.readFileSync which is shimmed
//    to empty, causing ext2fs.mount() to hang silently.
function patchExt2fsOnDisk() {
  // Patch fs.js: const → let for reassigned variables
  const fsPath = resolve(__dirname, 'node_modules/ext2fs/lib/fs.js');
  if (existsSync(fsPath)) {
    const src = readFileSync(fsPath, 'utf8');
    if (src.includes("const path = require('path')")) {
      const patched = src
        .replace("const path = require('path');", "let path = require('path');")
        .replace(/const toRead = Math\.min\(pool\.length/g, 'let toRead = Math.min(pool.length');
      writeFileSync(fsPath, patched, 'utf8');
    }
  }

  // Patch libext2fs.js: force ENVIRONMENT_IS_NODE=false so Emscripten uses
  // browser/worker code paths (fetch, XHR) instead of Node.js (fs, __dirname)
  const libPath = resolve(__dirname, 'node_modules/ext2fs/lib/libext2fs.js');
  if (existsSync(libPath)) {
    let src = readFileSync(libPath, 'utf8');
    let changed = false;
    // Force ENVIRONMENT_IS_NODE=false
    const nodeDetect = 'ENVIRONMENT_IS_NODE=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string"';
    if (src.includes(nodeDetect)) {
      src = src.replace(nodeDetect, 'ENVIRONMENT_IS_NODE=false');
      changed = true;
    }
    // Force ENVIRONMENT_IS_WORKER=true — Vite ES module workers don't have
    // importScripts, so Emscripten's detection fails. But we ARE in a worker.
    const workerDetect = 'ENVIRONMENT_IS_WORKER=typeof importScripts=="function"';
    if (src.includes(workerDetect)) {
      src = src.replace(workerDetect, 'ENVIRONMENT_IS_WORKER=typeof importScripts=="function"||typeof WorkerGlobalScope!="undefined"');
      changed = true;
    }
    if (changed) writeFileSync(libPath, src, 'utf8');
  }
}

// Run the patch immediately when this config is loaded (before esbuild)
patchExt2fsOnDisk();

// Copy non-module scripts to dist on build
function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist/web/public');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      // Copy radium-player.js (non-module script loaded via <script> tag)
      copyFileSync(
        resolve(__dirname, 'public/radium-player.js'),
        resolve(outDir, 'radium-player.js'),
      );
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: false,

  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'stream', 'events', 'path', 'util', 'assert'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
    copyStaticAssets(),
    // Rewrite root URL to web/index.html in dev mode
    {
      name: 'web-entry-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            req.url = '/web/index.html';
          }
          next();
        });
      },
    },
  ],

  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'web/index.html'),
    },
    // Increase chunk size limit — ext2fs WASM is large
    chunkSizeWarningLimit: 1000,
  },

  resolve: {
    alias: {
      // Redirect Node-only imports to browser shims when bundling
      'node:fs/promises': resolve(__dirname, 'web/shims/empty.js'),
      'node:fs': resolve(__dirname, 'web/shims/empty.js'),
      'node:events': resolve(__dirname, 'web/shims/events.js'),
      'node:path': resolve(__dirname, 'web/path-posix.js'),
      'node:zlib': resolve(__dirname, 'web/shims/empty.js'),
      'node:process': resolve(__dirname, 'web/shims/empty.js'),
      'node:crypto': resolve(__dirname, 'web/shims/crypto.js'),
      // These native modules should never be imported in web builds
      'balena-image-fs': resolve(__dirname, 'web/shims/empty.js'),
      'partitioninfo': resolve(__dirname, 'web/shims/empty.js'),
      'file-disk': resolve(__dirname, 'web/shims/empty.js'),
    },
  },

  worker: {
    format: 'es',
    plugins: () => [
      nodePolyfills({
        include: ['buffer', 'process', 'stream', 'events', 'path', 'util', 'assert'],
        globals: {
          Buffer: true,
          process: true,
        },
      }),
    ],
  },

  // Pre-bundle ext2fs and fflate so Vite doesn't re-optimize mid-session
  // (which causes a page reload and drops in-flight worker requests)
  optimizeDeps: {
    include: ['ext2fs', 'fflate', 'buffer'],
  },

  server: {
    port: parseInt(process.env.PORT || '5174', 10),
    strictPort: true,
  },

});
