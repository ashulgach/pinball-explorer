/**
 * Patch ext2fs for browser/Vite compatibility. Runs via postinstall.
 *
 * 1. fs.js: Fixes `const` reassignment that esbuild rejects
 * 2. libext2fs.js: Fixes Emscripten environment detection for Vite ES module workers
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- Patch 1: fs.js const → let ---
const fsPath = resolve(root, 'node_modules/ext2fs/lib/fs.js');
if (existsSync(fsPath)) {
  const src = readFileSync(fsPath, 'utf8');
  if (src.includes("const path = require('path')")) {
    const patched = src
      .replace("const path = require('path');", "let path = require('path');")
      .replace(/const toRead = Math\.min\(pool\.length/g, 'let toRead = Math.min(pool.length');
    writeFileSync(fsPath, patched, 'utf8');
    console.log('[patch-ext2fs] Patched fs.js: const → let');
  }
}

// --- Patch 2: libext2fs.js environment detection ---
const libPath = resolve(root, 'node_modules/ext2fs/lib/libext2fs.js');
if (existsSync(libPath)) {
  let src = readFileSync(libPath, 'utf8');
  let changed = false;

  // Force ENVIRONMENT_IS_NODE=false (polyfilled process.versions.node fools Emscripten)
  const nodeDetect = 'ENVIRONMENT_IS_NODE=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string"';
  if (src.includes(nodeDetect)) {
    src = src.replace(nodeDetect, 'ENVIRONMENT_IS_NODE=false');
    changed = true;
  }

  // Fix ENVIRONMENT_IS_WORKER for ES module workers (no importScripts in module workers)
  const workerDetect = 'ENVIRONMENT_IS_WORKER=typeof importScripts=="function"';
  if (src.includes(workerDetect)) {
    src = src.replace(workerDetect, 'ENVIRONMENT_IS_WORKER=typeof importScripts=="function"||typeof WorkerGlobalScope!="undefined"');
    changed = true;
  }

  if (changed) {
    writeFileSync(libPath, src, 'utf8');
    console.log('[patch-ext2fs] Patched libext2fs.js: environment detection');
  }
}
