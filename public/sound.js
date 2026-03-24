// ---------------------------------------------------------------------------
// Audio playback, sound preview preparation, sound UI rendering.
// ---------------------------------------------------------------------------

import {
  state,
  targetInput,
  assetList,
  timers,
  players,
  soundPreviewPrepareInflight,
  inspectionGeneration,
  soundPlaybackRequestId,
  bumpSoundPlaybackRequestId,
  scheduleRenderAll,
  scheduleAudioSelectionRefresh,
} from './state.js';

import {
  escapeHtml,
  formatNumber,
  formatDurationMs,
  getSoundChannelLabel,
  renderRowActionIcon,
  renderKeyValue,
} from './utils.js';

import {
  isAudioView,
  getSoundScripts,
  getSoundScriptByIndex,
  getSelectedSoundScript,
  getSoundScriptMetadataKey,
  getSoundScriptDisplayName,
  getSoundScriptBaseLabel,
  getSoundSystem,
  renderSidebarInlineAssetEditor,
} from './data-accessors.js';

import {
  markPreviewLoadPending,
  markPreviewLoadComplete,
  getSelectedPreviewLoadSpec,
  renderPreviewLoadingOverlay,
} from './preview.js';

// --- URL/spec helpers ---

export function getSoundScriptPreviewUrl(scriptIndex) {
  const revision = state.soundPreviewRevisionByScript[scriptIndex] || 0;
  return `/api/sound-preview?path=${encodeURIComponent(targetInput.value.trim())}&script=${encodeURIComponent(scriptIndex)}&rev=${encodeURIComponent(revision)}`;
}

export function getSoundScriptExportUrl(scriptIndex) {
  return `/api/sound-export?path=${encodeURIComponent(targetInput.value.trim())}&script=${encodeURIComponent(scriptIndex)}`;
}

export function getSoundPreviewLoadSpec(script) {
  if (!script || script.byteLength <= 0) return null;
  const revision = state.soundPreviewRevisionByScript[script.scriptIndex] || 0;
  return {
    key: `sound-preview:${script.scriptIndex}:${revision}`,
    title: 'Loading Audio...',
  };
}

export function invalidateSoundScriptPreview(scriptIndex) {
  const nextRevision = (state.soundPreviewRevisionByScript[scriptIndex] || 0) + 1;
  state.soundPreviewRevisionByScript[scriptIndex] = nextRevision;
  delete state.soundPreviewPreparedByScript[scriptIndex];
  delete state.soundPreviewLoadingByScript[scriptIndex];
  delete state.previewLoadingByKey[`sound-preview:${scriptIndex}:${nextRevision - 1}`];
  delete state.previewLoadedByKey[`sound-preview:${scriptIndex}:${nextRevision - 1}`];

  if (soundPreviewPrepareInflight.has(scriptIndex)) {
    soundPreviewPrepareInflight.delete(scriptIndex);
  }

  if (players.soundRowPlayerScriptIndex === scriptIndex) {
    stopSoundRowPlayback({ clearSource: true });
  }
}

// --- Playback ---

function cancelPendingSoundPlayback() {
  bumpSoundPlaybackRequestId();
}

export { cancelPendingSoundPlayback };

export function stopSoundRowPlayback({ clearSource = false } = {}) {
  players.soundRowPlayer.pause();
  players.soundRowPlayer.currentTime = 0;
  players.soundRowPlayerScriptIndex = null;
  state.playingSoundScriptIndex = null;
  if (clearSource) {
    players.soundRowPlayer.removeAttribute('src');
    players.soundRowPlayer.load();
  }
}

export function syncSoundRowPlaybackState() {
  const nextPlayingScriptIndex = !players.soundRowPlayer.paused && players.soundRowPlayerScriptIndex !== null
    ? players.soundRowPlayerScriptIndex
    : null;
  if (state.playingSoundScriptIndex === nextPlayingScriptIndex) return;
  state.playingSoundScriptIndex = nextPlayingScriptIndex;
  if (!syncAudioSidebarSelectionState()) {
    scheduleRenderAll();
  }
}

// --- UI sync ---

export function syncAudioSidebarSelectionState() {
  if (!assetList || !isAudioView()) return false;

  const scripts = new Map(getSoundScripts().map((script) => [script.scriptIndex, script]));
  for (const row of assetList.querySelectorAll('.sound-row')) {
    const selectButton = row.querySelector('[data-sound-script]');
    const playButton = row.querySelector('[data-sound-play]');
    const stopButton = row.querySelector('[data-sound-stop]');
    const scriptIndex = Number(selectButton?.dataset.soundScript ?? row.dataset.soundScriptRow);
    const script = scripts.get(scriptIndex);
    const isSelected = scriptIndex === state.selectedSoundScriptIndex;
    const isPlaying = scriptIndex === state.playingSoundScriptIndex;
    const isLoading = Boolean(state.soundPreviewLoadingByScript[scriptIndex]);
    const hasPayload = (script?.byteLength || 0) > 0;

    row.classList.toggle('is-selected', isSelected);
    row.classList.toggle('is-playing', isPlaying);
    row.classList.toggle('is-loading', isLoading);
    selectButton?.classList.toggle('is-selected', isSelected);

    if (playButton) {
      const label = script?.label || `Script ${scriptIndex}`;
      const actionLabel = isLoading ? `Preparing ${label}` : `Play ${label}`;
      playButton.disabled = !hasPayload || isLoading;
      playButton.setAttribute('aria-label', actionLabel);
      playButton.title = actionLabel;
      const iconKind = isLoading ? 'spinner' : 'play';
      if (playButton.dataset.iconKind !== iconKind) {
        playButton.dataset.iconKind = iconKind;
        playButton.innerHTML = renderRowActionIcon(iconKind);
      }
    }

    if (stopButton) {
      stopButton.disabled = !isPlaying;
    }
  }

  return true;
}

export function refreshAudioSelectionPanels() {
  if (!state.currentData || state.loading || state.error || !isAudioView()) return false;
  syncAudioSidebarSelectionState();
  // Use scheduleRenderAll instead of directly calling render functions
  // to break the circular dependency with renderers.js
  scheduleRenderAll();
  return true;
}

// --- Preview preparation ---

export async function prepareSoundPreview(scriptIndex) {
  const script = getSoundScriptByIndex(scriptIndex);
  if (!script || script.byteLength <= 0) return false;
  if (state.soundPreviewPreparedByScript[scriptIndex]) return true;
  if (soundPreviewPrepareInflight.has(scriptIndex)) {
    return soundPreviewPrepareInflight.get(scriptIndex);
  }

  const sessionId = inspectionGeneration;
  const soundSpec = getSoundPreviewLoadSpec(script);
  if (soundSpec) {
    markPreviewLoadPending(soundSpec);
  }
  state.soundPreviewLoadingByScript[scriptIndex] = true;
  if (!refreshAudioSelectionPanels()) {
    scheduleRenderAll();
  }

  const promise = fetch(getSoundScriptPreviewUrl(scriptIndex), {
    method: 'HEAD',
    cache: 'no-store',
  })
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Sound preview prepare failed (${res.status})`);
      }
      if (sessionId !== inspectionGeneration) return false;
      state.soundPreviewPreparedByScript[scriptIndex] = true;
      return true;
    })
    .catch((error) => {
      if (sessionId === inspectionGeneration) {
        state.soundActionError = error.message || 'Sound preview prepare failed';
      }
      return false;
    })
    .finally(() => {
      soundPreviewPrepareInflight.delete(scriptIndex);
      if (sessionId !== inspectionGeneration) return;
      delete state.soundPreviewLoadingByScript[scriptIndex];
      markPreviewLoadComplete(soundSpec?.key);
      if (!refreshAudioSelectionPanels()) {
        scheduleRenderAll();
      }
    });

  soundPreviewPrepareInflight.set(scriptIndex, promise);
  return promise;
}

export function queueSelectedSoundPreviewPrepare() {
  if (!isAudioView() || state.loading || state.error) return;
  const script = getSelectedSoundScript();
  if (!script || script.byteLength <= 0) return;
  if (state.soundPreviewPreparedByScript[script.scriptIndex] || state.soundPreviewLoadingByScript[script.scriptIndex]) return;
  void prepareSoundPreview(script.scriptIndex);
}

export async function playSoundScript(scriptIndex) {
  const script = getSoundScriptByIndex(scriptIndex);
  if (!script || script.byteLength <= 0) return;

  cancelPendingSoundPlayback();
  const requestId = soundPlaybackRequestId;
  state.selectedSoundScriptIndex = scriptIndex;
  state.soundActionError = '';
  syncAudioSidebarSelectionState();
  scheduleAudioSelectionRefresh();

  const prepared = await prepareSoundPreview(scriptIndex);
  if (!prepared || requestId !== soundPlaybackRequestId || state.selectedSoundScriptIndex !== scriptIndex) return;

  const previewUrl = getSoundScriptPreviewUrl(scriptIndex);
  const resolvedPreviewUrl = new URL(previewUrl, window.location.href).href;
  const shouldReloadSource = players.soundRowPlayerScriptIndex !== scriptIndex || players.soundRowPlayer.currentSrc !== resolvedPreviewUrl;

  players.soundRowPlayerScriptIndex = scriptIndex;
  if (shouldReloadSource) {
    players.soundRowPlayer.src = previewUrl;
  }
  players.soundRowPlayer.currentTime = 0;

  try {
    await players.soundRowPlayer.play();
    if (requestId !== soundPlaybackRequestId || state.selectedSoundScriptIndex !== scriptIndex) {
      stopSoundRowPlayback();
      scheduleRenderAll();
      return;
    }
  } catch (error) {
    players.soundRowPlayerScriptIndex = null;
    state.playingSoundScriptIndex = null;
    state.soundActionError = error.message || 'Sound playback failed';
    scheduleRenderAll();
  }
}

export function stopSoundScript(scriptIndex) {
  cancelPendingSoundPlayback();
  if (players.soundRowPlayerScriptIndex !== scriptIndex && state.playingSoundScriptIndex !== scriptIndex) return;
  stopSoundRowPlayback();
  if (!syncAudioSidebarSelectionState()) {
    scheduleRenderAll();
  }
}

// --- Sound replace ---

export async function replaceSelectedSound(file) {
  const script = getSelectedSoundScript();
  if (!script || !file) return;

  state.soundActionPending = true;
  state.soundActionError = '';
  scheduleRenderAll();

  try {
    const res = await fetch(`/api/sound-replace?path=${encodeURIComponent(targetInput.value.trim())}&script=${encodeURIComponent(script.scriptIndex)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'audio/wav' },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Sound replace failed');
    }

    invalidateSoundScriptPreview(script.scriptIndex);
  } catch (error) {
    state.soundActionError = error.message;
  } finally {
    state.soundActionPending = false;
    scheduleRenderAll();
  }
}

export function stopAnimationPreview() {
  if (timers.activeAnimationTimer !== null) {
    window.clearInterval(timers.activeAnimationTimer);
    timers.activeAnimationTimer = null;
  }
}

// --- Rendering ---

function renderEditableSoundTitle(script) {
  const scriptKey = getSoundScriptMetadataKey(script);
  const title = escapeHtml(getSoundScriptDisplayName(script) || 'Decoded sound scripts');
  if (!script || !scriptKey) return `<h2>${title}</h2>`;

  const isEditing = state.inlineAssetEditorPath === scriptKey;
  if (isEditing) {
    const draft = state.assetMetadataDraftByPath[scriptKey] || {};
    const pending = state.assetMetadataPendingPath === scriptKey;
    return `
      <form class="preview-title-edit-form" data-inline-asset-title-form data-inline-asset-path="${escapeHtml(scriptKey)}">
        <input
          class="preview-title-input"
          type="text"
          spellcheck="false"
          value="${escapeHtml(draft.alias || getSoundScriptDisplayName(script))}"
          data-inline-asset-alias-input
          ${pending ? 'disabled' : ''}
        >
        <button
          class="asset-edit-button"
          type="submit"
          aria-label="Save asset name"
          title="Save asset name"
          ${pending ? 'disabled' : ''}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M6.6 11.2 3.4 8l-1.1 1.1 4.3 4.3 7.1-7.1-1.1-1.1z" fill="currentColor"></path>
          </svg>
        </button>
        <button
          class="asset-edit-button"
          type="button"
          data-cancel-inline-asset-edit="${escapeHtml(scriptKey)}"
          aria-label="Cancel asset name edit"
          title="Cancel"
          ${pending ? 'disabled' : ''}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m4.1 3 3.9 3.9L11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1z" fill="currentColor"></path>
          </svg>
        </button>
      </form>
    `;
  }

  return `
    <div class="preview-title-row" data-edit-asset-metadata="${escapeHtml(scriptKey)}" title="Double-click to edit name">
      <h2>
        <span class="preview-title-text">${title}</span>
        <button
          class="asset-edit-button asset-edit-button-inline"
          type="button"
          data-edit-asset-metadata="${escapeHtml(scriptKey)}"
          aria-label="Edit asset name"
          title="Edit asset name"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M11.8 1.8a1.7 1.7 0 0 1 2.4 2.4l-7.9 7.9-3.6.8.8-3.6 7.9-7.9Zm1.4 1-1.4-1.4a.5.5 0 0 0-.7 0L10 2.5l2.1 2.1 1.1-1.1a.5.5 0 0 0 0-.7ZM11.3 5.3 9.2 3.2 4 8.4l-.5 2 2-.5 5.8-5.8Z" fill="currentColor"></path>
          </svg>
        </button>
      </h2>
    </div>
  `;
}

export function renderSoundRows(scripts) {
  return scripts.map((script) => {
    const scriptKey = getSoundScriptMetadataKey(script);
    const isSelected = script.scriptIndex === state.selectedSoundScriptIndex;
    const isPlaying = script.scriptIndex === state.playingSoundScriptIndex;
    const isLoading = Boolean(state.soundPreviewLoadingByScript[script.scriptIndex]);
    const hasPayload = script.byteLength > 0;
    const displayName = getSoundScriptDisplayName(script);
    const baseLabel = getSoundScriptBaseLabel(script);
    const detailBits = [
      baseLabel,
      getSoundChannelLabel(script),
      formatDurationMs(script.durationMs),
      `codec ${script.codec}`,
    ].filter(Boolean);
    if (state.sidebarInlineAssetEditorPath === scriptKey) {
      return `
        <div class="sound-row${isSelected ? ' is-selected' : ''}${isPlaying ? ' is-playing' : ''}${isLoading ? ' is-loading' : ''} is-editing" data-sound-script-row="${script.scriptIndex}">
          ${renderSidebarInlineAssetEditor(
            scriptKey,
            displayName,
            `<div class="asset-subtitle">${escapeHtml(detailBits.join(' | '))}</div>`,
          )}
          <div class="sound-row-actions">
            <button class="row-action-button row-action-icon-button" type="button" data-sound-play="${script.scriptIndex}" aria-label="${isLoading ? `Preparing ${escapeHtml(displayName)}` : `Play ${escapeHtml(displayName)}`}" title="${isLoading ? `Preparing ${escapeHtml(displayName)}` : `Play ${escapeHtml(displayName)}`}" ${(hasPayload && !isLoading) ? '' : 'disabled'}>
              ${isLoading ? renderRowActionIcon('spinner') : renderRowActionIcon('play')}
            </button>
            <button class="row-action-button row-action-icon-button" type="button" data-sound-stop="${script.scriptIndex}" aria-label="Stop ${escapeHtml(displayName)}" title="Stop ${escapeHtml(displayName)}" ${isPlaying ? '' : 'disabled'}>
              ${renderRowActionIcon('stop')}
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="sound-row${isSelected ? ' is-selected' : ''}${isPlaying ? ' is-playing' : ''}${isLoading ? ' is-loading' : ''}">
        <button class="asset-row sound-row-select${isSelected ? ' is-selected' : ''}" type="button" data-sound-script="${script.scriptIndex}" data-edit-sidebar-asset-path="${escapeHtml(scriptKey)}">
          <div class="asset-row-top">
            <span class="asset-title">${escapeHtml(displayName)}</span>
          </div>
          <div class="asset-subtitle">
            ${escapeHtml(detailBits.join(' | '))}
          </div>
        </button>
        <div class="sound-row-actions">
          <button class="row-action-button row-action-icon-button" type="button" data-sound-play="${script.scriptIndex}" aria-label="${isLoading ? `Preparing ${escapeHtml(displayName)}` : `Play ${escapeHtml(displayName)}`}" title="${isLoading ? `Preparing ${escapeHtml(displayName)}` : `Play ${escapeHtml(displayName)}`}" ${(hasPayload && !isLoading) ? '' : 'disabled'}>
            ${isLoading ? renderRowActionIcon('spinner') : renderRowActionIcon('play')}
          </button>
          <button class="row-action-button row-action-icon-button" type="button" data-sound-stop="${script.scriptIndex}" aria-label="Stop ${escapeHtml(displayName)}" title="Stop ${escapeHtml(displayName)}" ${isPlaying ? '' : 'disabled'}>
            ${renderRowActionIcon('stop')}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

export function renderSoundActions(script, { includeInput = false } = {}) {
  if (!script) return '';

  return `
    <div class="inline-actions preview-header-actions">
      <a class="link-button" href="${getSoundScriptExportUrl(script.scriptIndex)}" download>Download</a>
      <button class="link-button" type="button" data-sound-replace>${state.soundActionPending ? 'Replacing...' : 'Replace'}</button>
      ${includeInput ? `<input id="soundReplaceInput" type="file" accept=".wav,audio/wav" hidden ${state.soundActionPending ? 'disabled' : ''}>` : ''}
    </div>
  `;
}

export function renderAudioPreview(script) {
  if (!script) {
    const soundError = state.currentData?.spike?.soundError;
    return `
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>${soundError ? 'Sound decode failed' : 'No sound script selected'}</strong>
          <span>${escapeHtml(soundError || 'Pick a script from the left rail to preview or export it.')}</span>
        </div>
      </div>
    `;
  }

  if (script.byteLength <= 0) {
    return `
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>No audible payload</strong>
          <span>This script has no exported PCM frames.</span>
        </div>
      </div>
    `;
  }

  if (state.soundPreviewLoadingByScript[script.scriptIndex]) {
    const spec = getSoundPreviewLoadSpec(script);
    return `
      <div class="preview-surface preview-surface-loading">
        ${renderPreviewLoadingOverlay(spec?.key)}
      </div>
    `;
  }

  const spec = getSelectedPreviewLoadSpec();
  const overlay = spec ? renderPreviewLoadingOverlay(spec.key) : '';
  return `
    <div class="preview-surface${overlay ? ' is-loading' : ''}">
      <audio controls preload="metadata" src="${getSoundScriptPreviewUrl(script.scriptIndex)}" data-preview-load-key="${escapeHtml(spec?.key || '')}"></audio>
      ${overlay}
    </div>
  `;
}

export function renderAudioView() {
  const script = getSelectedSoundScript();
  const soundSystem = getSoundSystem();
  const soundError = state.currentData?.spike?.soundError;
  const displayName = getSoundScriptDisplayName(script);
  const baseLabel = getSoundScriptBaseLabel(script);

  return `
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div class="preview-header-main">
            ${renderEditableSoundTitle(script)}
          </div>
          ${renderSoundActions(script, { includeInput: true })}
        </div>
        ${renderAudioPreview(script)}
        ${state.soundActionError ? `<div class="error-state"><strong>Sound action failed</strong><p>${escapeHtml(state.soundActionError)}</p></div>` : ''}
      </section>

      <section class="two-col">
        <article class="panel">
          <h3>Sound system</h3>
          ${soundSystem ? renderKeyValue([
            ['Sample rate', `${formatNumber(soundSystem.sampleRate)} Hz`],
            ['Requests', formatNumber(soundSystem.requestCount)],
            ['Scripts', formatNumber(soundSystem.scriptCount)],
            ['Fragments', formatNumber(soundSystem.fragmentCount)],
          ]) : '<p class="muted">No sound-system metadata was decoded for this target.</p>'}
        </article>
        <article class="panel">
          <h3>Selected script</h3>
          ${script ? renderKeyValue([
            ['Name', `<code>${escapeHtml(displayName)}</code>`],
            ['Script id', `<code>${escapeHtml(baseLabel || `Script ${script.scriptIndex}`)}</code>`],
            ['Request index', formatNumber(script.requestIndex)],
            ['Channels', `<code>${escapeHtml(getSoundChannelLabel(script))}</code>`],
            ['Duration', formatDurationMs(script.durationMs)],
            ['Codec', `<code>${escapeHtml(script.codec)}</code>`],
            ['Fragments', formatNumber(script.fragmentCount)],
            ['PCM frames', formatNumber(script.byteLength)],
          ]) : '<p class="muted">Select a sound script to inspect its decoded metadata.</p>'}
        </article>
      </section>
    </div>
  `;
}

// --- Init: wire soundRowPlayer event listeners ---

export function initSound() {
  players.soundRowPlayer.addEventListener('play', syncSoundRowPlaybackState);
  players.soundRowPlayer.addEventListener('pause', syncSoundRowPlaybackState);
  players.soundRowPlayer.addEventListener('ended', syncSoundRowPlaybackState);
}
