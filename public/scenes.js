// ---------------------------------------------------------------------------
// Scene loading, flipbook, radium player, scene rendering.
// ---------------------------------------------------------------------------

import {
  state,
  targetInput,
  sceneTypeFilter,
  timers,
  players,
  RADIUM_CLIENT_SCENE_CACHE_MAX,
  scheduleRenderAll,
} from './state.js';

import {
  escapeHtml,
  formatNumber,
  sceneNodeMetadataKey,
} from './utils.js';

import {
  getAssets,
  getAssetDisplayName,
  getAssetPreviewUrl,
  getScenePathForAsset,
  getSceneDetailsForAsset,
  getSceneFrameForAsset,
  getResolvedSceneType,
  getResolvedSceneTypeForAsset,
  isSceneContainerAsset,
  isAudioView,
  getSelectedAsset,
  getSceneFramePreviewUrl,
  getAssetUrl,
  getSceneNodeAlias,
  getAssetMetadataDraft,
  getAssetAlias,
  getSceneTypeOptions,
  getCompactSceneAssetLabel,
  renderSidebarInlineAssetEditor,
} from './data-accessors.js';

import {
  getSelectedPreviewLoadSpec,
  renderPreviewLoadingOverlay,
  renderVideoSurface,
} from './preview.js';

import { stopAnimationPreview } from './sound.js';

// --- Scene loading ---

export async function loadSceneDetails(scenePath) {
  if (!scenePath || state.sceneLoadingByPath[scenePath]) return;
  state.sceneLoadingByPath[scenePath] = true;

  try {
    const res = await fetch(`/api/scene-metadata?path=${encodeURIComponent(targetInput.value.trim())}&scene=${encodeURIComponent(scenePath)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Scene decode failed');
    }
    state.sceneDetailsByPath[scenePath] = data;

    const selectedAsset = getAssets().find((asset) => asset.path === scenePath);
    if (selectedAsset) {
      selectedAsset.sceneType = data.sceneType || selectedAsset.sceneType;
    }
  } catch (error) {
    state.sceneDetailsByPath[scenePath] = {
      scenePath,
      sceneType: 'RawScene',
      previewKind: null,
      error: error.message,
    };
  } finally {
    delete state.sceneLoadingByPath[scenePath];
    populateSceneTypeFilter();
    scheduleRenderAll();
  }
}

export function queueSelectedSceneDetailsLoad() {
  if (isAudioView()) return;
  if (state.loading || state.error) return;
  const selected = getSelectedAsset();
  const scenePath = getScenePathForAsset(selected);
  if (!scenePath) return;
  if (state.sceneDetailsByPath[scenePath] || state.sceneLoadingByPath[scenePath]) return;
  loadSceneDetails(scenePath);
}

// --- Radium scene loading ---

export async function loadRadiumScene(scenePath) {
  if (!scenePath || state.radiumSceneLoadingByPath?.[scenePath]) return;
  state.radiumSceneLoadingByPath = state.radiumSceneLoadingByPath || {};
  state.radiumSceneLoadingByPath[scenePath] = true;

  const target = targetInput.value.trim();
  try {
    const resp = await fetch(`/api/radium-scene?path=${encodeURIComponent(target)}&scene=${encodeURIComponent(scenePath)}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const keys = Object.keys(state.radiumScenesByPath);
    while (keys.length >= RADIUM_CLIENT_SCENE_CACHE_MAX) {
      const oldest = keys.shift();
      delete state.radiumScenesByPath[oldest];
    }

    state.radiumScenesByPath[scenePath] = data;
  } catch (error) {
    console.error('Failed to load radium scene:', scenePath, error);
    state.radiumScenesByPath[scenePath] = { error: error.message };
  } finally {
    delete state.radiumSceneLoadingByPath[scenePath];
  }
  scheduleRenderAll();
}

// --- Flipbook ---

export function buildStreamingFlipbookPreview(asset) {
  if (asset?.sceneType !== 'StreamingFlipbook' || !asset.clipFrames?.length || asset.clipFrames.length < 2) {
    return '';
  }

  return `
    <div class="clip-preview">
      <div class="preview-surface">
        <img id="clipPlayerImage" class="preview-image" alt="${escapeHtml(asset.sceneLabel || asset.path)}">
      </div>
      <div class="clip-controls">
        <button type="button" id="clipPlayToggle">Pause</button>
        <label class="checkline" for="clipFps">
          <span>FPS</span>
          <input id="clipFps" type="range" min="2" max="24" step="1" value="12">
          <strong id="clipFpsValue">12</strong>
        </label>
      </div>
      <p id="clipFrameStatus" class="muted"></p>
    </div>
  `;
}

export function buildSceneFlipbookPreview(sceneDetails) {
  if (sceneDetails?.previewKind !== 'flipbook' || !sceneDetails.frames?.length) {
    return '';
  }

  return `
    <div class="clip-preview">
      <div class="preview-surface">
        <img id="clipPlayerImage" class="preview-image" alt="${escapeHtml(getAssetDisplayName(sceneDetails.scenePath))}">
      </div>
      <div class="clip-controls">
        <button type="button" id="clipPlayToggle">Pause</button>
        <label class="checkline" for="clipFps">
          <span>FPS</span>
          <input id="clipFps" type="range" min="2" max="24" step="1" value="12">
          <strong id="clipFpsValue">12</strong>
        </label>
      </div>
      <p id="clipFrameStatus" class="muted"></p>
    </div>
  `;
}

export function wireStreamingFlipbookPreview(asset) {
  stopAnimationPreview();

  const image = document.getElementById('clipPlayerImage');
  const toggle = document.getElementById('clipPlayToggle');
  const fpsInput = document.getElementById('clipFps');
  const fpsValue = document.getElementById('clipFpsValue');
  const status = document.getElementById('clipFrameStatus');
  if (!image || !toggle || !fpsInput || !fpsValue || !status) return;

  const frames = asset.clipFrames
    .map((framePath) => getAssets().find((entry) => entry.path === framePath))
    .filter(Boolean);
  if (!frames.length) return;

  let frameIndex = Math.min(asset.clipFrameIndex || 0, frames.length - 1);
  let playing = true;

  const renderFrame = () => {
    const frame = frames[frameIndex];
    image.src = getAssetPreviewUrl(frame);
    status.textContent = `${asset.sceneLabel || 'Clip'} frame ${frameIndex + 1} of ${frames.length} (${getAssetDisplayName(frame.path)})`;
  };

  const start = () => {
    stopAnimationPreview();
    timers.activeAnimationTimer = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      renderFrame();
    }, Math.max(40, Math.round(1000 / Number(fpsInput.value || 12))));
    toggle.textContent = 'Pause';
    playing = true;
  };

  const stop = () => {
    stopAnimationPreview();
    toggle.textContent = 'Play';
    playing = false;
  };

  fpsInput.addEventListener('input', () => {
    fpsValue.textContent = fpsInput.value;
    if (playing) start();
  });

  toggle.addEventListener('click', () => {
    if (playing) { stop(); return; }
    start();
  });

  renderFrame();
  start();
}

export function wireSceneFlipbookPreview(sceneDetails) {
  stopAnimationPreview();

  const image = document.getElementById('clipPlayerImage');
  const toggle = document.getElementById('clipPlayToggle');
  const fpsInput = document.getElementById('clipFps');
  const fpsValue = document.getElementById('clipFpsValue');
  const status = document.getElementById('clipFrameStatus');
  if (!image || !toggle || !fpsInput || !fpsValue || !status) return;

  const frames = sceneDetails.frames || [];
  if (!frames.length) return;

  let frameIndex = 0;
  let playing = true;

  const renderFrame = () => {
    const frame = frames[frameIndex];
    image.src = getSceneFramePreviewUrl(sceneDetails.scenePath, frame.assetPath);
    status.textContent = `${getAssetDisplayName(sceneDetails.scenePath)} frame ${frameIndex + 1} of ${frames.length} (${getAssetDisplayName(frame.assetPath)})`;
  };

  const start = () => {
    stopAnimationPreview();
    timers.activeAnimationTimer = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      renderFrame();
    }, Math.max(40, Math.round(1000 / Number(fpsInput.value || 12))));
    toggle.textContent = 'Pause';
    playing = true;
  };

  const stop = () => {
    stopAnimationPreview();
    toggle.textContent = 'Play';
    playing = false;
  };

  fpsInput.addEventListener('input', () => {
    fpsValue.textContent = fpsInput.value;
    if (playing) start();
  });

  toggle.addEventListener('click', () => {
    if (playing) { stop(); return; }
    start();
  });

  renderFrame();
  start();
}

// --- Radium player ---

export function buildRadiumPlayerSurface(scenePath) {
  const sceneData = state.radiumScenesByPath[scenePath];
  if (!sceneData || sceneData.error) {
    return `
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>Radium scene error</strong>
          <span>${escapeHtml(sceneData?.error || 'Unknown error')}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="radium-player-container" data-radium-scene="${escapeHtml(scenePath)}">
      <canvas id="radiumCanvas"></canvas>
      <div class="radium-controls">
        <button id="radiumPlayPause" type="button" title="Play / Pause">Play</button>
        <button id="radiumStepBack" type="button" title="Step back">&lt;</button>
        <button id="radiumStepFwd" type="button" title="Step forward">&gt;</button>
        <input id="radiumTimeline" type="range" min="0" max="1" step="1" value="0" title="Timeline">
        <span class="radium-frame-display" id="radiumFrameDisplay">Frame 0 / 0</span>
        <div class="radium-speed">
          <span>Speed</span>
          <input id="radiumSpeed" type="range" min="1" max="30" step="1" value="10" title="Playback speed">
          <span class="radium-speed-value" id="radiumSpeedValue">1.0x</span>
        </div>
        <label><input id="radiumLoop" type="checkbox" checked> Loop</label>
      </div>
    </div>
  `;
}

export function destroyRadiumPlayer() {
  if (players.activeRadiumPlayer) {
    players.activeRadiumPlayer.destroy();
    players.activeRadiumPlayer = null;
  }
}

export async function wireRadiumPlayer() {
  const container = document.querySelector('.radium-player-container[data-radium-scene]');
  if (!container) return;

  const scenePath = container.dataset.radiumScene;
  const sceneData = state.radiumScenesByPath[scenePath];
  if (!sceneData || sceneData.error) return;

  const canvas = document.getElementById('radiumCanvas');
  const playPauseBtn = document.getElementById('radiumPlayPause');
  const stepBackBtn = document.getElementById('radiumStepBack');
  const stepFwdBtn = document.getElementById('radiumStepFwd');
  const timeline = document.getElementById('radiumTimeline');
  const frameDisplay = document.getElementById('radiumFrameDisplay');
  const speedSlider = document.getElementById('radiumSpeed');
  const speedValue = document.getElementById('radiumSpeedValue');
  const loopCheckbox = document.getElementById('radiumLoop');

  if (!canvas || !playPauseBtn) return;

  destroyRadiumPlayer();

  const target = targetInput.value.trim();
  const imageBaseUrl = `/api/radium-image?path=${encodeURIComponent(target)}&scene=${encodeURIComponent(scenePath)}`;
  const player = new window.RadiumPlayer(canvas, sceneData.composition, sceneData.imageManifest, imageBaseUrl);
  players.activeRadiumPlayer = player;

  timeline.max = String(Math.max(0, player.frameCount - 1));
  frameDisplay.textContent = `Frame 0 / ${player.frameCount}`;

  player.onFrameChange = (frame) => {
    timeline.value = String(frame);
    frameDisplay.textContent = `Frame ${frame + 1} / ${player.frameCount}`;
    playPauseBtn.textContent = player.playing ? 'Pause' : 'Play';
  };

  playPauseBtn.addEventListener('click', () => {
    if (player.playing) {
      player.pause();
      playPauseBtn.textContent = 'Play';
    } else {
      player.play();
      playPauseBtn.textContent = 'Pause';
    }
  });

  stepBackBtn.addEventListener('click', () => {
    player.pause();
    player.step(-1);
    playPauseBtn.textContent = 'Play';
  });

  stepFwdBtn.addEventListener('click', () => {
    player.pause();
    player.step(1);
    playPauseBtn.textContent = 'Play';
  });

  timeline.addEventListener('input', () => {
    player.seekFrame(Number(timeline.value));
  });

  speedSlider.addEventListener('input', () => {
    const speed = Number(speedSlider.value) / 10;
    player.speedFactor = speed;
    speedValue.textContent = `${speed.toFixed(1)}x`;
  });

  loopCheckbox.addEventListener('change', () => {
    player.loop = loopCheckbox.checked;
  });

  await player.loadImages();
  player.seekFrame(0);
}

// --- Main surface rendering ---

export function renderAssetSurface(asset) {
  if (!asset) {
    return `
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>No asset selected</strong>
          <span>Inspect a target and choose an asset from the left rail.</span>
        </div>
      </div>
    `;
  }

  const sceneDetails = getSceneDetailsForAsset(asset);
  const sceneFrame = getSceneFrameForAsset(sceneDetails, asset);
  const previewSpec = getSelectedPreviewLoadSpec();
  const previewOverlay = previewSpec ? renderPreviewLoadingOverlay(previewSpec.key) : '';
  const previewLoadingClass = previewOverlay ? ' is-loading' : '';
  if (isSceneContainerAsset(asset) && sceneDetails?.previewKind === 'flipbook' && sceneDetails.frames?.length > 1) {
    return buildSceneFlipbookPreview(sceneDetails);
  }
  if (sceneFrame) {
    return `<div class="preview-surface${previewLoadingClass}"><img class="preview-image" src="${getSceneFramePreviewUrl(sceneDetails.scenePath, sceneFrame.assetPath)}" alt="${escapeHtml(sceneFrame.assetPath)}" data-preview-load-key="${escapeHtml(previewSpec?.key || '')}">${previewOverlay}</div>`;
  }
  if (isSceneContainerAsset(asset) && sceneDetails?.previewKind === 'flipbook' && sceneDetails.frames?.length === 1) {
    return `<div class="preview-surface${previewLoadingClass}"><img class="preview-image" src="${getSceneFramePreviewUrl(sceneDetails.scenePath, sceneDetails.frames[0].assetPath)}" alt="${escapeHtml(sceneDetails.scenePath)}" data-preview-load-key="${escapeHtml(previewSpec?.key || '')}">${previewOverlay}</div>`;
  }
  if (isSceneContainerAsset(asset) && sceneDetails?.previewKind === 'video' && sceneDetails.previewAssetPath) {
    return renderVideoSurface(getAssetUrl(sceneDetails.previewAssetPath), sceneDetails.scenePath);
  }
  if (isSceneContainerAsset(asset) && state.sceneLoadingByPath[getScenePathForAsset(asset)]) {
    return `
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>Decoding scene</strong>
        </div>
      </div>
    `;
  }

  // Scene tree node preview
  if (isSceneContainerAsset(asset) && state.selectedSceneNodeId && state.selectedSceneNodeScenePath) {
    const nodeScenePath = state.selectedSceneNodeScenePath;
    const nodeId = state.selectedSceneNodeId;
    const sceneData = state.radiumScenesByPath[nodeScenePath];
    const backBtn = `<div class="scene-tree-back"><button class="link-button" type="button" data-back-to-scene="1">\u2190 Back to scene player</button></div>`;
    const metaKey = sceneNodeMetadataKey(nodeScenePath, nodeId);

    function sceneNodeNameHeader(node) {
      const alias = getSceneNodeAlias(nodeScenePath, nodeId);
      const displayName = alias || node.label;
      const isEditingName = state.inlineAssetEditorPath === metaKey;
      if (isEditingName) {
        const draft = state.assetMetadataDraftByPath[metaKey] || {};
        const val = draft.alias !== undefined ? draft.alias : displayName;
        const pending = state.assetMetadataPendingPath === metaKey;
        return `
          <form class="scene-node-rename-form" data-scene-node-rename-form data-scene-node-rename-path="${escapeHtml(metaKey)}">
            <input
              class="scene-node-rename-input"
              type="text"
              spellcheck="false"
              value="${escapeHtml(val)}"
              data-scene-node-rename-input
              ${pending ? 'disabled' : ''}
              autofocus
            >
            <button class="link-button" type="submit" ${pending ? 'disabled' : ''}>Save</button>
            <button class="link-button" type="button" data-scene-node-rename-cancel="${escapeHtml(metaKey)}">Cancel</button>
          </form>
          ${alias ? `<span class="muted" style="font-size:11px">Original: ${escapeHtml(node.label)}</span>` : ''}
        `;
      }
      return `
        <div class="scene-node-name-row">
          <strong>${escapeHtml(displayName)}</strong>
          <button class="asset-edit-button asset-edit-button-compact" type="button" data-scene-node-rename-start="${escapeHtml(metaKey)}" title="Rename">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>
        ${alias ? `<span class="muted" style="font-size:11px">Original: ${escapeHtml(node.label)}</span>` : ''}
      `;
    }

    if (sceneData && !sceneData.error) {
      const tree = sceneData.assetTree;
      const imageNode = tree?.images?.find((img) => img.id === nodeId);
      if (imageNode) {
        const imgUrl = `/api/radium-image?path=${encodeURIComponent(targetInput.value.trim())}&scene=${encodeURIComponent(nodeScenePath)}&image=${encodeURIComponent(nodeId)}`;
        const replaceSuccess = state.imageReplaceSuccess === nodeId;
        const imageMeta = `
          <div class="scene-tree-replace-controls">
            <span class="badge kind-badge">${escapeHtml(imageNode.format)}, ${imageNode.width}\u00D7${imageNode.height}${imageNode.isExternal ? ', external' : ', embedded'}</span>
          </div>
        `;
        return `${backBtn}<div class="scene-node-detail">${sceneNodeNameHeader(imageNode)}</div>${imageMeta}<div class="preview-surface"><img class="preview-image" src="${imgUrl}${replaceSuccess ? `&_t=${Date.now()}` : ''}" alt="${escapeHtml(imageNode.label)}"></div>`;
      }
      const soundNode = tree?.sounds?.find((s) => s.id === nodeId);
      if (soundNode) {
        return `${backBtn}<div class="scene-node-detail">${sceneNodeNameHeader(soundNode)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Sample rate: ${formatNumber(soundNode.sampleRate)} Hz</span><span>Channels: ${soundNode.channels === 2 ? 'Stereo' : 'Mono'}</span><span>Sample size: ${soundNode.sampleSize}-bit</span><span>Compression: ${soundNode.compression}</span></div></div>`;
      }
      const videoNode = tree?.videoClips?.find((v) => v.id === nodeId);
      if (videoNode) {
        return `${backBtn}<div class="scene-node-detail">${sceneNodeNameHeader(videoNode)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Dimensions: ${escapeHtml(videoNode.dimensions)}</span><span>Frames: ${formatNumber(videoNode.frameCount)}</span>${videoNode.fileName ? `<span>File: ${escapeHtml(videoNode.fileName)}</span>` : ''}</div></div>`;
      }
      const fontNode = tree?.fonts?.find((f) => f.id === nodeId);
      if (fontNode) {
        return `${backBtn}<div class="scene-node-detail">${sceneNodeNameHeader(fontNode)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Style: ${fontNode.bold ? 'Bold' : ''}${fontNode.italic ? ' Italic' : ''}${!fontNode.bold && !fontNode.italic ? 'Regular' : ''}</span><span>Glyphs: ${formatNumber(fontNode.glyphCount)}</span></div></div>`;
      }
      const spineNode = tree?.spineAssets?.find((s) => s.id === nodeId);
      if (spineNode) {
        return `${backBtn}<div class="scene-node-detail">${sceneNodeNameHeader(spineNode)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Type: Spine character</span><span>Images: ${formatNumber(spineNode.imageCount)}</span></div></div>`;
      }
      const textNode = tree?.texts?.find((t) => t.id === nodeId);
      if (textNode) {
        return `${backBtn}<div class="scene-node-detail">${sceneNodeNameHeader(textNode)}</div><div class="preview-surface"><div class="placeholder-copy"><span>${escapeHtml(textNode.text || '(empty)')}</span></div></div>`;
      }
    }
    return `${backBtn}<div class="preview-surface"><div class="placeholder-copy"><strong>Asset preview unavailable</strong></div></div>`;
  }

  // Radium scene animation player
  if (isSceneContainerAsset(asset)) {
    const scenePath = getScenePathForAsset(asset);
    if (scenePath) {
      const radiumScene = state.radiumScenesByPath[scenePath];
      if (radiumScene) {
        return buildRadiumPlayerSurface(scenePath);
      }
      if (!state.radiumSceneLoadingByPath?.[scenePath]) {
        loadRadiumScene(scenePath);
      }
      return `
        <div class="preview-surface">
          <div class="placeholder-copy">
            <strong>Loading Radium scene</strong>
          </div>
        </div>
      `;
    }
  }

  if (asset.sceneType === 'StreamingFlipbook' && asset.clipFrames?.length > 1) {
    return buildStreamingFlipbookPreview(asset);
  }

  const previewUrl = getAssetPreviewUrl(asset);
  if (asset.previewKind === 'image') {
    return `<div class="preview-surface${previewLoadingClass}"><img class="preview-image" src="${previewUrl}" alt="${escapeHtml(asset.path)}" data-preview-load-key="${escapeHtml(previewSpec?.key || '')}">${previewOverlay}</div>`;
  }
  if (asset.previewKind === 'audio') {
    return `<div class="preview-surface${previewLoadingClass}"><audio controls preload="metadata" src="${previewUrl}" data-preview-load-key="${escapeHtml(previewSpec?.key || '')}"></audio>${previewOverlay}</div>`;
  }
  if (asset.previewKind === 'video') {
    return renderVideoSurface(previewUrl, asset.path);
  }
  if (asset.kind === 'font') {
    const fontFamily = `preview-${Math.random().toString(36).slice(2)}`;
    return `
      <style>
        @font-face {
          font-family: '${fontFamily}';
          src: url('${previewUrl}');
        }
      </style>
      <div class="preview-surface">
        <div class="font-preview" style="font-family: '${fontFamily}', serif;">Stern Spike Preview 0123456789</div>
      </div>
    `;
  }

  return `
    <div class="preview-surface">
      <div class="placeholder-copy">
        <strong>No inline preview</strong>
        <span>${escapeHtml(asset.format || asset.kind || 'Unknown type')} is available as raw data only.</span>
      </div>
    </div>
  `;
}

// --- Sidebar rendering ---

export function renderSceneRows(rows) {
  return rows.map((row) => {
    const { scene, asset } = row;
    if (!asset) return '';

    if (row.rowType === 'asset') {
      const isSelected = asset.path === state.selectedAssetPath;
      const compactPath = getCompactSceneAssetLabel(asset.path, scene.scenePath);
      const isEditing = state.sidebarInlineAssetEditorPath === asset.path;
      if (isEditing) {
        return `
          <div class="scene-row${isSelected ? ' is-selected' : ''} is-editing">
            ${renderSidebarInlineAssetEditor(
              asset.path,
              getAssetDisplayName(asset),
              `<div class="scene-subtitle">${escapeHtml(compactPath)}</div>`,
            )}
          </div>
        `;
      }

      return `
        <button class="scene-row${isSelected ? ' is-selected' : ''}" type="button" data-scene-asset="${escapeHtml(asset.path)}" data-edit-sidebar-asset-path="${escapeHtml(asset.path)}" title="${escapeHtml(asset.path)}">
          <div class="scene-row-top">
            <span class="scene-title">${escapeHtml(getAssetDisplayName(asset))}</span>
            <span class="badge kind-badge">${escapeHtml(scene.sceneType)}</span>
          </div>
          <div class="scene-subtitle">${escapeHtml(compactPath)}</div>
        </button>
      `;
    }

    const isSelected = asset.path === state.selectedAssetPath || scene.scenePath === getSelectedAsset()?.scenePath;
    const subtitle = scene.assets.length
      ? `${formatNumber(scene.assets.length)} previewable assets${scene.clipLabels.length ? `, ${formatNumber(scene.clipLabels.length)} clips` : ''}`
      : 'Raw scene file';
    const isEditing = state.sidebarInlineAssetEditorPath === scene.scenePath;
    const isExpanded = !!state.expandedScenePaths[scene.scenePath];
    const chevron = isExpanded ? '\u25BE' : '\u25B8';
    if (isEditing) {
      return `
        <div class="scene-row${isSelected ? ' is-selected' : ''} is-editing">
          ${renderSidebarInlineAssetEditor(
            scene.scenePath,
            getAssetDisplayName(scene.scenePath),
            `<div class="scene-subtitle">${escapeHtml(subtitle)}</div>`,
          )}
        </div>
      `;
    }

    return `
      <div class="scene-row-wrapper">
        <div class="scene-row-header">
          <button class="scene-tree-toggle" type="button" data-scene-tree-toggle="${escapeHtml(scene.scenePath)}" title="Expand asset tree">${chevron}</button>
          <button class="scene-row${isSelected ? ' is-selected' : ''}" type="button" data-scene-asset="${escapeHtml(asset.path)}" data-edit-sidebar-asset-path="${escapeHtml(scene.scenePath)}">
            <div class="scene-row-top">
              <span class="scene-title">${escapeHtml(getAssetDisplayName(scene.scenePath))}</span>
              <span class="badge kind-badge">${escapeHtml(scene.sceneType)}</span>
            </div>
            <div class="scene-subtitle">${subtitle}</div>
          </button>
        </div>
        ${isExpanded ? renderSceneAssetTree(scene.scenePath) : ''}
      </div>
    `;
  }).join('');
}

export function renderSceneAssetTree(scenePath) {
  const sceneData = state.radiumScenesByPath[scenePath];
  if (!sceneData) {
    if (state.radiumSceneLoadingByPath?.[scenePath]) {
      return '<div class="scene-tree"><div class="scene-tree-loading muted">Loading asset tree\u2026</div></div>';
    }
    return '<div class="scene-tree"><div class="scene-tree-loading muted">Expanding\u2026</div></div>';
  }
  if (sceneData.error) {
    return `<div class="scene-tree"><div class="scene-tree-loading muted">Error: ${escapeHtml(sceneData.error)}</div></div>`;
  }

  const tree = sceneData.assetTree;
  if (!tree) {
    return '<div class="scene-tree"><div class="scene-tree-loading muted">No asset tree available</div></div>';
  }

  function nodeLabel(item) {
    return getSceneNodeAlias(scenePath, item.id) || item.label;
  }

  const groups = [
    ['Images', tree.images, (item) =>
      `<span class="scene-tree-label">${escapeHtml(nodeLabel(item))}</span><span class="badge kind-badge">${escapeHtml(item.format)}, ${item.width}\u00D7${item.height}</span>`
    ],
    ['Sounds', tree.sounds, (item) =>
      `<span class="scene-tree-label">${escapeHtml(nodeLabel(item))}</span><span class="badge kind-badge">${formatNumber(item.sampleRate)}Hz, ${item.channels === 2 ? 'stereo' : 'mono'}</span>`
    ],
    ['Video Clips', tree.videoClips, (item) =>
      `<span class="scene-tree-label">${escapeHtml(nodeLabel(item))}</span><span class="badge kind-badge">${escapeHtml(item.dimensions)}, ${formatNumber(item.frameCount)} frames</span>`
    ],
    ['Fonts', tree.fonts, (item) =>
      `<span class="scene-tree-label">${escapeHtml(nodeLabel(item))}${item.bold ? ' Bold' : ''}${item.italic ? ' Italic' : ''}</span><span class="badge kind-badge">${formatNumber(item.glyphCount)} glyphs</span>`
    ],
    ['Spine', tree.spineAssets, (item) =>
      `<span class="scene-tree-label">${escapeHtml(nodeLabel(item))}</span><span class="badge kind-badge">${formatNumber(item.imageCount)} images</span>`
    ],
    ['Text Fields', tree.texts, (item) =>
      `<span class="scene-tree-label">${escapeHtml(nodeLabel(item))}</span><span class="badge kind-badge">${escapeHtml(item.text || '(empty)')}</span>`
    ],
  ];

  const hasAny = groups.some(([, items]) => items.length > 0);
  if (!hasAny) {
    return '<div class="scene-tree"><div class="scene-tree-loading muted">No assets found in scene</div></div>';
  }

  return `<div class="scene-tree">${groups.map(([groupLabel, items, renderItem]) => {
    if (!items.length) return '';
    return `
      <div class="scene-tree-group">
        <div class="scene-tree-group-header">${escapeHtml(groupLabel)} <span class="count-pill">${formatNumber(items.length)}</span></div>
        ${items.map((item) => {
          const metaKey = sceneNodeMetadataKey(scenePath, item.id);
          const isEditing = state.sidebarInlineAssetEditorPath === metaKey;
          if (isEditing) {
            return `
              <div class="scene-tree-node is-editing">
                ${renderSidebarInlineAssetEditor(metaKey, item.label)}
              </div>
            `;
          }
          return `
            <button class="scene-tree-node${state.selectedSceneNodeId === item.id ? ' is-selected' : ''}" type="button" data-scene-tree-node="${escapeHtml(item.id)}" data-scene-tree-node-scene="${escapeHtml(scenePath)}" data-edit-sidebar-asset-path="${escapeHtml(metaKey)}">
              ${renderItem(item)}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }).join('')}</div>`;
}

export function renderScenesView() {
  const selected = getSelectedAsset();
  return `
    <div class="viewer-stack">
      <section class="preview-stage preview-stage-seamless">
        <div class="preview-header">
          <div class="preview-header-main">
            ${renderEditableAssetTitle(selected, 'Radium scenes')}
          </div>
          ${renderSceneHeaderActions(selected)}
        </div>
        ${renderAssetSurface(selected)}
      </section>
    </div>
  `;
}

function renderSceneHeaderActions(asset) {
  const nodeScenePath = state.selectedSceneNodeScenePath;
  const nodeId = state.selectedSceneNodeId;
  const sceneData = nodeScenePath ? state.radiumScenesByPath[nodeScenePath] : null;
  const imageNode = sceneData?.assetTree?.images?.find((img) => img.id === nodeId);

  if (imageNode) {
    const downloadUrl = `/api/radium-image?path=${encodeURIComponent(targetInput.value.trim())}&scene=${encodeURIComponent(nodeScenePath)}&image=${encodeURIComponent(nodeId)}`;
    const replacePending = state.imageReplacePending;
    const replaceError = state.imageReplaceError;
    const replaceSuccess = state.imageReplaceSuccess === nodeId;
    return `
      <div class="preview-header-actions">
        <a class="link-button" href="${downloadUrl}" download>Download</a>
        <button class="link-button" type="button" data-radium-image-replace="${escapeHtml(nodeId)}" data-radium-image-replace-scene="${escapeHtml(nodeScenePath)}" ${replacePending ? 'disabled' : ''}>${replacePending ? 'Replacing\u2026' : 'Replace'}</button>
        <input id="radiumImageReplaceInput" type="file" accept=".png,image/png" hidden ${replacePending ? 'disabled' : ''}>
        ${replaceError ? `<span class="error-text">${escapeHtml(replaceError)}</span>` : ''}
        ${replaceSuccess ? '<span class="success-text">Replaced successfully</span>' : ''}
      </div>
    `;
  }

  if (!asset) return '';

  // Scene container with a video preview — show video replace button
  const sceneDetails = getSceneDetailsForAsset(asset);
  if (isSceneContainerAsset(asset) && sceneDetails?.previewKind === 'video' && sceneDetails.previewAssetPath) {
    const videoReplacePending = state.videoReplacePending;
    const videoReplaceError = state.videoReplaceError;
    const videoReplaceSuccess = state.videoReplaceAssetPath === sceneDetails.previewAssetPath;
    return `
      <div class="preview-header-actions">
        <a class="link-button" href="${getAssetUrl(sceneDetails.previewAssetPath)}" download>Download</a>
        <button class="link-button" type="button" data-video-replace="${escapeHtml(sceneDetails.previewAssetPath)}" ${videoReplacePending ? 'disabled' : ''}>${videoReplacePending ? 'Replacing\u2026' : 'Replace'}</button>
        <input id="videoReplaceInput" type="file" accept=".mp4,.mov,.webm,video/*" hidden ${videoReplacePending ? 'disabled' : ''}>
        ${videoReplaceError ? `<span class="error-text">${escapeHtml(videoReplaceError)}</span>` : ''}
        ${videoReplaceSuccess ? '<span class="success-text">Replaced successfully</span>' : ''}
      </div>
    `;
  }

  return `
    <div class="preview-header-actions">
      <a class="link-button" href="${getAssetUrl(asset.path)}" download>Download</a>
    </div>
  `;
}

export function populateSceneTypeFilter() {
  const previous = sceneTypeFilter.value;
  const options = getSceneTypeOptions();
  sceneTypeFilter.innerHTML = [
    '<option value="">All scene types</option>',
    ...options.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`),
  ].join('');
  if (options.includes(previous)) sceneTypeFilter.value = previous;
}

// Forward declaration — will be set by renderers.js to avoid circular dep
let renderEditableAssetTitle = (asset, fallback) => `<h2>${escapeHtml(fallback)}</h2>`;
export function setRenderEditableAssetTitle(fn) {
  renderEditableAssetTitle = fn;
}
