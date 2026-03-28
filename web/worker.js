/**
 * Web Worker for Pinball Explorer.
 *
 * Runs all heavy I/O and processing off the main thread.
 * Receives File objects and dispatches to the web backend.
 * Returns results (JSON or ArrayBuffer) via postMessage.
 */

// Must be imported before ext2fs — see that module for why.
import './fix-env.js';

import {
  inspectTarget,
  readAssetRange,
  describeScene,
  renderSceneFramePreview,
  parseRadiumSceneFull,
  renderRadiumImage,
  clearCaches,
} from './raw-image-backend-web.js';

// Keep a reference to the loaded file
let currentFile = null;

/**
 * Message handler — dispatches commands to backend functions.
 *
 * Protocol:
 *   Main → Worker: { id, command, file?, ...params }
 *   Worker → Main: { id, result } or { id, error }
 *   For binary results: { id, result: { contentType, buffer } }
 *     where buffer is transferred (zero-copy)
 */
self.onmessage = async (event) => {
  const { id, command, file, ...params } = event.data;

  // Update current file reference if provided
  if (file) {
    if (!currentFile || file.name !== currentFile.name || file.size !== currentFile.size) {
      clearCaches();
    }
    currentFile = file;
  }

  if (!currentFile && command !== 'ping') {
    self.postMessage({ id, error: 'No file loaded. Send a file with the command.' });
    return;
  }

  try {
    let result;
    const transferables = [];

    switch (command) {
      case 'ping':
        result = { ok: true };
        break;

      case 'inspect':
        console.log('[worker] inspect start, file:', currentFile?.name, currentFile?.size);
        try {
          result = await inspectTarget(currentFile);
          console.log('[worker] inspect done');
        } catch (inspectErr) {
          console.error('[worker] inspect error:', inspectErr);
          throw inspectErr;
        }
        break;

      case 'readAsset': {
        const buffer = await readAssetRange(currentFile, params.assetPath, params.start, params.end);
        // Transfer the underlying ArrayBuffer for zero-copy
        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        result = { contentType: params.contentType || 'application/octet-stream', buffer: ab };
        transferables.push(ab);
        break;
      }

      case 'describeScene':
        result = await describeScene(currentFile, params.scenePath);
        break;

      case 'sceneFramePreview': {
        const frame = await renderSceneFramePreview(currentFile, params.scenePath, params.assetPath);
        const ab = frame.buffer.buffer.slice(frame.buffer.byteOffset, frame.buffer.byteOffset + frame.buffer.byteLength);
        result = { contentType: frame.contentType, buffer: ab };
        transferables.push(ab);
        break;
      }

      case 'parseRadiumScene':
        result = await parseRadiumSceneFull(currentFile, params.scenePath);
        // Strip _parseResult (too large / not transferable) — send composition + manifests only
        result = {
          scenePath: result.scenePath,
          sceneDir: result.sceneDir,
          composition: result.composition,
          imageManifest: result.imageManifest,
          assetTree: result.assetTree,
        };
        break;

      case 'renderRadiumImage': {
        const img = await renderRadiumImage(currentFile, params.scenePath, params.imageId);
        const ab = img.buffer.buffer.slice(img.buffer.byteOffset, img.buffer.byteOffset + img.buffer.byteLength);
        result = { contentType: img.contentType, buffer: ab };
        transferables.push(ab);
        break;
      }

      case 'clearCaches':
        clearCaches();
        currentFile = null;
        result = { ok: true };
        break;

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    self.postMessage({ id, result }, transferables);
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
