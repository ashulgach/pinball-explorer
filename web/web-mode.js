/**
 * web-mode.js — Web mode bootstrap for Pinball Explorer.
 *
 * This module is loaded BEFORE app.js in web mode. It:
 * 1. Sets up the web file picker (replacing Electron/server file picker)
 * 2. Intercepts fetch('/api/...') calls and routes them through the Web Worker
 * 3. Handles drag-and-drop with File objects instead of file paths
 *
 * The approach uses a fetch interceptor so the existing frontend code works
 * unchanged — no modifications needed to app.js, renderers.js, etc.
 */

import {
  isWebMode,
  setCurrentFile,
  getCurrentFile,
  clearBlobCache,
} from './api-bridge.js';

if (isWebMode) {
  console.log('[web-mode] Initializing browser-only mode');

  // Signal to app.js that we're in web mode
  window.__pinballWebFileInput = true;
  window.__pinballWebSetFile = (file) => setCurrentFile(file);

  // ---------------------------------------------------------------------------
  // Worker setup
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
          if (error) resolver.reject(new Error(error));
          else resolver.resolve(result);
        }
      };
      worker.onerror = (err) => console.error('[web-mode] Worker error:', err);
    }
    return worker;
  }

  function sendCommand(command, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, command, ...params });
    });
  }

  // ---------------------------------------------------------------------------
  // Blob URL management
  // ---------------------------------------------------------------------------

  const blobUrls = new Map();

  function createBlobUrl(arrayBuffer, contentType) {
    const blob = new Blob([arrayBuffer], { type: contentType });
    return URL.createObjectURL(blob);
  }

  function getCachedBlobUrl(key, arrayBuffer, contentType) {
    if (blobUrls.has(key)) return blobUrls.get(key);
    const url = createBlobUrl(arrayBuffer, contentType);
    blobUrls.set(key, url);
    return url;
  }

  // ---------------------------------------------------------------------------
  // File input wiring
  // ---------------------------------------------------------------------------

  // The web/index.html has a hidden <input type="file" id="webFileInput">
  // We wire up the load buttons to trigger it.
  window.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('webFileInput');
    const loadBtn = document.getElementById('loadBtn');
    const loadOverlayBtn = document.querySelector('.load-overlay-action');

    if (fileInput) {
      // Wire load button to file input
      if (loadBtn) {
        loadBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fileInput.click();
        });
      }
      if (loadOverlayBtn) {
        loadOverlayBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fileInput.click();
        });
      }

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        setCurrentFile(file);
        // Trigger the same flow as the existing code
        const targetInput = document.getElementById('targetInput');
        if (targetInput) targetInput.value = file.name;
        // Dispatch a custom event that app.js can listen to
        window.dispatchEvent(new CustomEvent('pinball-web-file-loaded', { detail: { file } }));
      });
    }

    // Fix drag-and-drop for web mode
    document.body.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.endsWith('.raw') || file.name.endsWith('.img') || file.name.endsWith('.iso'))) {
        e.preventDefault();
        e.stopPropagation();
        document.body.classList.remove('drag-over');
        setCurrentFile(file);
        const targetInput = document.getElementById('targetInput');
        if (targetInput) targetInput.value = file.name;
        window.dispatchEvent(new CustomEvent('pinball-web-file-loaded', { detail: { file } }));
      }
    }, true); // capture phase to run before app.js handler
  });

  // ---------------------------------------------------------------------------
  // Fetch interceptor
  // ---------------------------------------------------------------------------

  const originalFetch = window.fetch;

  window.fetch = async function(url, options) {
    // Only intercept string URLs starting with /api/
    if (typeof url !== 'string' || !url.startsWith('/api/')) {
      return originalFetch.call(this, url, options);
    }

    const urlObj = new URL(url, window.location.origin);
    const pathname = urlObj.pathname;
    const params = urlObj.searchParams;
    const file = getCurrentFile();

    try {
      switch (pathname) {
        case '/api/default-target': {
          return jsonResponse({ defaultTarget: '' });
        }

        case '/api/pick-file': {
          // Trigger the file input programmatically
          const fileInput = document.getElementById('webFileInput');
          if (fileInput) fileInput.click();
          return jsonResponse({ path: '' });
        }

        case '/api/inspect': {
          if (!file) return errorResponse(400, 'No file loaded');
          const result = await sendCommand('inspect', { file });
          return jsonResponse(result);
        }

        case '/api/asset':
        case '/api/asset-preview': {
          if (!file) return errorResponse(400, 'No file loaded');
          const assetPath = params.get('asset');
          const rangeHeader = options?.headers?.Range || options?.headers?.range;
          let start = 0, end = null;
          if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
              start = parseInt(match[1]);
              end = match[2] ? parseInt(match[2]) : null;
            }
          }
          const result = await sendCommand('readAsset', { file, assetPath, start, end });
          const blob = new Blob([result.buffer], { type: result.contentType });
          return new Response(blob, {
            status: 200,
            headers: { 'Content-Type': result.contentType },
          });
        }

        case '/api/scene-metadata': {
          if (!file) return errorResponse(400, 'No file loaded');
          const scenePath = params.get('scene');
          const result = await sendCommand('describeScene', { file, scenePath });
          return jsonResponse(result);
        }

        case '/api/scene-frame-preview': {
          if (!file) return errorResponse(400, 'No file loaded');
          const scenePath = params.get('scene');
          const assetPath = params.get('asset');
          const result = await sendCommand('sceneFramePreview', { file, scenePath, assetPath });
          const blob = new Blob([result.buffer], { type: result.contentType });
          return new Response(blob, {
            status: 200,
            headers: { 'Content-Type': result.contentType },
          });
        }

        case '/api/radium-scene': {
          if (!file) return errorResponse(400, 'No file loaded');
          const scenePath = params.get('scene');
          const result = await sendCommand('parseRadiumScene', { file, scenePath });
          return jsonResponse(result);
        }

        case '/api/radium-image': {
          if (!file) return errorResponse(400, 'No file loaded');
          const scenePath = params.get('scene');
          const imageId = params.get('image') || params.get('id');
          const result = await sendCommand('renderRadiumImage', { file, scenePath, imageId });
          const blob = new Blob([result.buffer], { type: result.contentType });
          return new Response(blob, {
            status: 200,
            headers: { 'Content-Type': result.contentType },
          });
        }

        case '/api/rule-graph': {
          return errorResponse(501, 'Rule graph not yet supported in web mode');
        }

        case '/api/sound-preview':
        case '/api/sound-export': {
          return errorResponse(501, 'Sound preview not yet supported in web mode');
        }

        case '/api/sound-replace':
        case '/api/video-replace':
        case '/api/radium-image-replace': {
          return errorResponse(501, 'Write operations not yet supported in web mode');
        }

        case '/api/asset-metadata': {
          // Use localStorage for metadata in web mode
          if (options?.method === 'POST') {
            const body = await new Response(options.body).json();
            localStorage.setItem('pinball-asset-metadata', JSON.stringify(body));
            return jsonResponse({ ok: true });
          }
          const stored = localStorage.getItem('pinball-asset-metadata');
          return jsonResponse(stored ? JSON.parse(stored) : {});
        }

        default:
          console.warn(`[web-mode] Unhandled API call: ${pathname}`);
          return errorResponse(404, `Not found: ${pathname}`);
      }
    } catch (err) {
      console.error(`[web-mode] Error handling ${pathname}:`, err);
      return errorResponse(500, err.message);
    }
  };

  function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function errorResponse(status, message) {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------------------------------------------------------------------------
  // Web-mode event listener for file loads
  // ---------------------------------------------------------------------------

  // app.js calls pickAndLoadFile() which triggers fetch('/api/pick-file').
  // After the file input fires, we dispatch pinball-web-file-loaded.
  // We need app.js to call inspectTargetPath when this happens.
  // Since we can't directly call into app.js, we use a global hook.

  window.__pinballWebInspectFile = null;

  window.addEventListener('pinball-web-file-loaded', async (e) => {
    const file = e.detail.file;
    if (!file) return;

    // The fetch interceptor will handle /api/inspect calls.
    // We just need to trigger the inspect flow.
    // app.js reads targetInput.value and calls inspectTargetPath.
    // Let's simulate the form submit or call the inspect function.
    const targetInput = document.getElementById('targetInput');
    if (targetInput) {
      targetInput.value = file.name;
      // Trigger the inspect by dispatching a change event
      targetInput.dispatchEvent(new Event('change'));
    }
  });
}
