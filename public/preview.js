// ---------------------------------------------------------------------------
// Preview loading, overlays, video surface, and transitions.
// ---------------------------------------------------------------------------

import {
  state,
  viewer,
  timers,
  scheduleRenderAll,
} from './state.js';

import {
  escapeHtml,
} from './utils.js';

import {
  isAudioView,
  getSelectedAsset,
  getSelectedSoundScript,
  getSceneDetailsForAsset,
  getScenePathForAsset,
  getSceneFrameForAsset,
  isSceneContainerAsset,
} from './data-accessors.js';

// --- Load specs ---

export function getPreviewLoadSpecForAsset(asset) {
  if (!asset) return null;

  const sceneDetails = getSceneDetailsForAsset(asset);
  const scenePath = getScenePathForAsset(asset);
  const sceneFrame = getSceneFrameForAsset(sceneDetails, asset);
  if (sceneFrame && sceneDetails?.scenePath) {
    return {
      key: `scene-frame:${sceneDetails.scenePath}:${sceneFrame.assetPath}`,
      title: 'Loading preview',
    };
  }
  if (isSceneContainerAsset(asset) && sceneDetails?.previewKind === 'flipbook' && sceneDetails.frames?.length === 1) {
    return {
      key: `scene-frame:${sceneDetails.scenePath}:${sceneDetails.frames[0].assetPath}`,
      title: 'Loading preview',
    };
  }
  if (isSceneContainerAsset(asset) && sceneDetails?.previewKind === 'video' && sceneDetails.previewAssetPath) {
    return {
      key: `scene-video:${sceneDetails.scenePath}:${sceneDetails.previewAssetPath}`,
      title: 'Loading video preview',
    };
  }
  if (isSceneContainerAsset(asset) && state.sceneLoadingByPath[scenePath]) {
    return null;
  }
  if (asset.previewKind === 'image') {
    return { key: `asset-preview:${asset.path}`, title: 'Loading preview' };
  }
  if (asset.previewKind === 'audio') {
    return { key: `asset-preview:${asset.path}`, title: 'Loading audio preview' };
  }
  if (asset.previewKind === 'video') {
    return { key: `asset-preview:${asset.path}`, title: 'Loading video preview' };
  }
  return null;
}

export function getSelectedPreviewLoadSpec() {
  if (!state.currentData || state.loading || state.error) return null;
  if (isAudioView()) {
    const script = getSelectedSoundScript();
    if (!script || script.byteLength <= 0 || !state.soundPreviewPreparedByScript[script.scriptIndex]) return null;
    return { key: `sound-media:${script.scriptIndex}`, title: 'Loading audio preview' };
  }
  return getPreviewLoadSpecForAsset(getSelectedAsset());
}

// --- Load tracking ---

export function markPreviewLoadPending(spec) {
  if (!spec?.key || state.previewLoadedByKey[spec.key] || state.previewLoadingByKey[spec.key]) return false;
  state.previewLoadingByKey[spec.key] = spec;
  return true;
}

export function markPreviewLoadComplete(key) {
  if (!key) return;
  state.previewLoadedByKey[key] = true;
  if (!state.previewLoadingByKey[key]) return;
  delete state.previewLoadingByKey[key];
  scheduleRenderAll();
}

export function queueSelectedPreviewSurfaceLoad() {
  const spec = getSelectedPreviewLoadSpec();
  if (!spec) return;
  if (markPreviewLoadPending(spec)) {
    scheduleRenderAll();
  }
}

// --- Rendering ---

export function renderPreviewLoadingOverlay(key) {
  const spec = state.previewLoadingByKey[key];
  if (!spec) return '';
  return `
    <div class="preview-loading-overlay" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <div class="placeholder-copy">
        <strong>${escapeHtml(spec.title)}</strong>
        <span>${escapeHtml(spec.detail)}</span>
      </div>
    </div>
  `;
}

export function wirePreviewSurfaceLoaders() {
  const media = viewer.querySelector('[data-preview-load-key]');
  if (!media) return;

  const key = media.dataset.previewLoadKey;
  if (!key || !state.previewLoadingByKey[key]) return;

  const finish = () => {
    markPreviewLoadComplete(key);
  };

  const tagName = media.tagName;
  if (tagName === 'IMG') {
    if (media.complete && media.naturalWidth > 0) {
      finish();
      return;
    }
    media.addEventListener('load', finish, { once: true });
    media.addEventListener('error', finish, { once: true });
    return;
  }

  if (tagName === 'AUDIO') {
    if (media.readyState >= 1) {
      finish();
      return;
    }
    media.addEventListener('loadedmetadata', finish, { once: true });
    media.addEventListener('error', finish, { once: true });
    return;
  }

  if (tagName === 'VIDEO') {
    if (media.readyState >= 2) {
      finish();
      return;
    }
    media.addEventListener('loadeddata', finish, { once: true });
    media.addEventListener('error', finish, { once: true });
  }
}

export function renderVideoSurface(previewUrl, label) {
  const spec = getSelectedPreviewLoadSpec();
  const overlay = spec ? renderPreviewLoadingOverlay(spec.key) : '';
  const pendingClass = overlay ? ' is-loading' : '';
  // Cache-bust if this video was just replaced
  let src = previewUrl;
  if (state.videoReplaceAssetPath && previewUrl.includes(encodeURIComponent(state.videoReplaceAssetPath))) {
    const sep = previewUrl.includes('?') ? '&' : '?';
    src = `${previewUrl}${sep}_t=${Date.now()}`;
  }
  return `
    <div class="preview-surface preview-surface-video${pendingClass}" data-preview-kind="video">
      <div class="preview-video-frame">
        <video class="preview-video" autoplay muted controls playsinline preload="metadata" src="${src}" aria-label="${escapeHtml(label)}" data-preview-load-key="${escapeHtml(spec?.key || '')}"></video>
      </div>
      ${overlay}
    </div>
  `;
}

// --- Transitions ---

export function captureVideoFrame(video) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function capturePreviewTransitionState() {
  const surface = viewer.querySelector('.preview-surface-video');
  const video = surface?.querySelector('.preview-video');
  if (!surface || !video) return null;

  const frameUrl = captureVideoFrame(video);
  const rect = surface.getBoundingClientRect();
  if (!frameUrl || rect.height <= 0) return null;

  return { frameUrl, height: Math.round(rect.height) };
}

export function releasePreviewSurface(surface) {
  if (!surface) return;
  surface.classList.remove('is-transitioning');
  surface.style.removeProperty('--preview-surface-fixed-height');
}

export function startPreviewOverlayFade(surface, overlay, video) {
  if (video) {
    video.classList.remove('is-pending');
    video.classList.add('is-ready');
  }

  requestAnimationFrame(() => {
    overlay.classList.add('is-fading');
  });

  window.setTimeout(() => {
    overlay.remove();
    releasePreviewSurface(surface);
  }, 180);
}

export function clearPreviewTransitionTimer() {
  if (timers.previewTransitionTimer !== null) {
    window.clearTimeout(timers.previewTransitionTimer);
    timers.previewTransitionTimer = null;
  }
}

export function applyPreviewTransition(previousPreview) {
  clearPreviewTransitionTimer();

  if (!previousPreview?.frameUrl) return;

  const surface = viewer.querySelector('.preview-surface-video');
  if (!surface) return;

  surface.classList.add('is-transitioning');
  surface.style.setProperty('--preview-surface-fixed-height', `${previousPreview.height}px`);

  const overlay = document.createElement('img');
  overlay.className = 'preview-transition-frame';
  overlay.alt = '';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.src = previousPreview.frameUrl;
  surface.appendChild(overlay);

  const video = surface.querySelector('.preview-video');
  const finishTransition = () => {
    if (!overlay.isConnected) return;
    if (video) {
      video.removeEventListener('loadeddata', finishTransition);
      video.removeEventListener('error', finishTransition);
    }
    clearPreviewTransitionTimer();
    startPreviewOverlayFade(surface, overlay, video);
  };

  if (video && video.readyState < 2) {
    video.classList.remove('is-ready');
    video.classList.add('is-pending');
    video.addEventListener('loadeddata', finishTransition, { once: true });
    video.addEventListener('error', finishTransition, { once: true });
    timers.previewTransitionTimer = window.setTimeout(finishTransition, 900);
    return;
  }

  finishTransition();
}
