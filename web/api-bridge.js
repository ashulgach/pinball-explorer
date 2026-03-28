/**
 * api-bridge.js — Unified API layer for Pinball Explorer.
 *
 * In Electron/server mode: routes calls through fetch('/api/...').
 * In web mode: routes calls through the Web Worker.
 *
 * The frontend imports from this module instead of calling fetch directly.
 */

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export const isWebMode = typeof window !== 'undefined'
  && !window.electronAPI
  && !window.__pinballServerMode;

// ---------------------------------------------------------------------------
// Worker management (web mode only)
// ---------------------------------------------------------------------------

let worker = null;
let messageId = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const resolver = pending.get(id);
      if (resolver) {
        pending.delete(id);
        if (error) {
          resolver.reject(new Error(error));
        } else {
          resolver.resolve(result);
        }
      }
    };
    worker.onerror = (err) => {
      console.error('Worker error:', err);
    };
  }
  return worker;
}

function sendCommand(command, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    const transferables = [];
    if (params.file && params.file instanceof File) {
      // File objects are not transferable but can be sent via postMessage
    }
    getWorker().postMessage({ id, command, ...params }, transferables);
  });
}

// ---------------------------------------------------------------------------
// Blob URL cache — maps request keys to ObjectURLs for binary assets
// ---------------------------------------------------------------------------

const blobUrlCache = new Map();

function makeBlobUrl(arrayBuffer, contentType) {
  const blob = new Blob([arrayBuffer], { type: contentType });
  return URL.createObjectURL(blob);
}

function getCachedBlobUrl(key) {
  return blobUrlCache.get(key);
}

function setCachedBlobUrl(key, url) {
  blobUrlCache.set(key, url);
  return url;
}

/**
 * Revoke all cached blob URLs (call when loading a new file).
 */
export function clearBlobCache() {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
}

// ---------------------------------------------------------------------------
// Current file reference (web mode)
// ---------------------------------------------------------------------------

let currentFile = null;

export function setCurrentFile(file) {
  if (currentFile && (file.name !== currentFile.name || file.size !== currentFile.size)) {
    clearBlobCache();
  }
  currentFile = file;
}

export function getCurrentFile() {
  return currentFile;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Inspect a target file.
 * @param {string|File} target — path (server mode) or File (web mode)
 */
export async function inspect(target) {
  if (isWebMode) {
    const file = target instanceof File ? target : currentFile;
    if (!file) throw new Error('No file loaded');
    setCurrentFile(file);
    return sendCommand('inspect', { file });
  }
  const res = await fetch(`/api/inspect?path=${encodeURIComponent(target)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Get a blob URL for an asset (image, video, font, etc.).
 * In server mode, returns a server URL.
 * In web mode, fetches via worker and returns a blob URL.
 */
export async function getAssetBlobUrl(assetPath, contentType, { start, end } = {}) {
  if (!isWebMode) {
    const params = new URLSearchParams({ path: assetPath });
    if (start != null) params.set('start', start);
    if (end != null) params.set('end', end);
    return `/api/asset?${params}`;
  }

  const cacheKey = `asset::${assetPath}::${start || 0}::${end || ''}`;
  const cached = getCachedBlobUrl(cacheKey);
  if (cached) return cached;

  const result = await sendCommand('readAsset', {
    file: currentFile,
    assetPath,
    contentType,
    start: start || 0,
    end: end || null,
  });

  return setCachedBlobUrl(cacheKey, makeBlobUrl(result.buffer, result.contentType));
}

/**
 * Get scene metadata.
 */
export async function getSceneMetadata(scenePath) {
  if (!isWebMode) {
    const res = await fetch(`/api/scene-metadata?path=${encodeURIComponent(scenePath)}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  return sendCommand('describeScene', { file: currentFile, scenePath });
}

/**
 * Get a blob URL for a scene frame preview (PNG).
 */
export async function getSceneFramePreviewUrl(scenePath, assetPath) {
  if (!isWebMode) {
    return `/api/scene-frame-preview?scene=${encodeURIComponent(scenePath)}&asset=${encodeURIComponent(assetPath)}`;
  }

  const cacheKey = `sceneFrame::${scenePath}::${assetPath}`;
  const cached = getCachedBlobUrl(cacheKey);
  if (cached) return cached;

  const result = await sendCommand('sceneFramePreview', { file: currentFile, scenePath, assetPath });
  return setCachedBlobUrl(cacheKey, makeBlobUrl(result.buffer, result.contentType));
}

/**
 * Parse a full Radium scene.
 */
export async function getRadiumScene(scenePath) {
  if (!isWebMode) {
    const res = await fetch(`/api/radium-scene?path=${encodeURIComponent(scenePath)}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  return sendCommand('parseRadiumScene', { file: currentFile, scenePath });
}

/**
 * Get a blob URL for a rendered Radium image (PNG).
 */
export async function getRadiumImageUrl(scenePath, imageId) {
  if (!isWebMode) {
    return `/api/radium-image?scene=${encodeURIComponent(scenePath)}&id=${encodeURIComponent(imageId)}`;
  }

  const cacheKey = `radiumImage::${scenePath}::${imageId}`;
  const cached = getCachedBlobUrl(cacheKey);
  if (cached) return cached;

  const result = await sendCommand('renderRadiumImage', { file: currentFile, scenePath, imageId });
  return setCachedBlobUrl(cacheKey, makeBlobUrl(result.buffer, result.contentType));
}

/**
 * Get sound preview URL.
 * Note: Sound export is not yet supported in web mode.
 */
export async function getSoundPreviewUrl(targetPath, scriptIndex) {
  if (!isWebMode) {
    return `/api/sound-preview?path=${encodeURIComponent(targetPath)}&script=${scriptIndex}`;
  }

  // TODO: Implement sound export in web mode (requires porting spike-sound-native.js)
  throw new Error('Sound preview not yet supported in web mode');
}

/**
 * Get rule graph.
 */
export async function getRuleGraph(targetPath) {
  if (!isWebMode) {
    const res = await fetch(`/api/rule-graph?path=${encodeURIComponent(targetPath)}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // TODO: Implement rule graph in web mode (requires porting rule-graph-extractor.js)
  throw new Error('Rule graph not yet supported in web mode');
}
