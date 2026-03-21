// ---------------------------------------------------------------------------
// View rendering, UI sync, and the central renderAll() function.
// ---------------------------------------------------------------------------

import {
  state,
  targetInput,
  viewer,
  viewerSelectionName,
  selectionInspector,
  packageInspector,
  manifestInspector,
  targetSummary,
  assetList,
  assetListHeading,
  assetSearch,
  assetSearchLabel,
  viewableOnly,
  viewableOnlyRow,
  sceneTypeFilter,
  sceneTypeFilterLabel,
  sidebarFilters,
  statusbar,
  tabCountFonts,
  tabCountImages,
  tabCountScenes,
  tabCountAudio,
  tabCountVideos,
  tabCountGraph,
  loadOverlay,
  topbarFileLabel,
  SCENE_NODE_KEY_PREFIX,
} from './state.js';

import {
  escapeHtml,
  formatNumber,
  formatHex,
  pathBasename,
  shortBackendName,
  renderKeyValue,
  renderList,
  formatDurationMs,
  getSoundChannelLabel,
  sceneNodeMetadataKey,
} from './utils.js';

import {
  getAssets,
  getAssetDisplayName,
  getAssetAlias,
  getAssetDescription,
  getAssetMetadataDraft,
  getAssetPreviewUrl,
  getAssetUrl,
  getMetadataAlias,
  getMetadataDefaultName,
  getMetadataDescription,
  getMetadataDisplayName,
  getSelectedAsset,
  getFilteredAssets,
  getFilteredSoundScripts,
  isAudioView,
  isRuleGraphView,
  isAssetViewable,
  isSceneContainerAsset,
  getSceneDetailsForAsset,
  getScenePathForAsset,
  getSoundSystem,
  getSoundScripts,
  getSelectedSoundScript,
  getSoundScriptDisplayName,
  getSoundScriptBaseLabel,
  ensureSelectedAsset,
  ensureSelectedSoundScript,
  getSceneNodeAlias,
  renderSidebarInlineAssetEditor,
  getRenderableSceneRows,
  isFlatSceneFileMode,
} from './data-accessors.js';

import {
  getRuleGraph,
  getGraphNodeById,
  ensureSelectedGraphNode,
  loadRuleGraph,
  renderGraphSidebar,
  renderRuleGraphView,
} from './graph.js';

import {
  getSelectedPreviewLoadSpec,
  wirePreviewSurfaceLoaders,
  capturePreviewTransitionState,
  applyPreviewTransition,
  clearPreviewTransitionTimer,
  queueSelectedPreviewSurfaceLoad,
} from './preview.js';

import {
  renderSoundRows,
  renderSoundActions,
  renderAudioPreview,
  renderAudioView,
  getSoundScriptPreviewUrl,
  syncAudioSidebarSelectionState,
  stopAnimationPreview,
  queueSelectedSoundPreviewPrepare,
} from './sound.js';

import {
  renderSceneRows,
  renderScenesView,
  renderAssetSurface,
  queueSelectedSceneDetailsLoad,
  wireStreamingFlipbookPreview,
  wireSceneFlipbookPreview,
  wireRadiumPlayer,
  destroyRadiumPlayer,
  setRenderEditableAssetTitle,
} from './scenes.js';

// --- Target summary ---

function renderTargetSummary() {
  if (!targetSummary) return;

  if (state.loading) {
    targetSummary.innerHTML = '<p class="muted">Inspecting target...</p>';
    return;
  }

  if (state.error) {
    targetSummary.innerHTML = `<div class="error-state"><strong>Inspect failed</strong><p>${escapeHtml(state.error)}</p></div>`;
    return;
  }

  if (!state.currentData) {
    targetSummary.innerHTML = '<p class="muted">No target loaded.</p>';
    return;
  }

  const { currentData } = state;
  targetSummary.innerHTML = `
    <span class="micro-label">Current target</span>
    <div class="stack">
      <strong>${escapeHtml(pathBasename(currentData.resolvedPath || currentData.targetPath))}</strong>
      <span class="muted">${escapeHtml(currentData.containerKind || 'unknown container')}</span>
      ${renderKeyValue([
        ['Driver', `<code>${escapeHtml(shortBackendName(currentData.sourceSupport?.driver))}</code>`],
        ['Mode', `<code>${escapeHtml(currentData.sourceSupport?.mode || 'unknown')}</code>`],
        ['Content', currentData.spike?.path ? `<code>${escapeHtml(pathBasename(currentData.spike.path))}</code>` : 'n/a'],
        ['Runtime', currentData.spike?.versionText ? `<code>${escapeHtml(currentData.spike.versionText)}</code>` : 'n/a'],
      ])}
    </div>
  `;
}

// --- Metadata editing ---

export function renderAssetMetadataEditor(asset) {
  if (!asset) return '';

  const draft = getAssetMetadataDraft(asset);
  const isPending = state.assetMetadataPendingPath === asset.path;
  const isError = state.assetMetadataErrorPath === asset.path && state.assetMetadataError;
  const isSaved = state.assetMetadataSavedPath === asset.path && !isPending && !isError;
  const feedback = isError
    ? state.assetMetadataError
    : (isSaved ? 'Saved alias and description.' : '');

  return `
    <form class="asset-meta-form" data-asset-metadata-form data-metadata-asset-path="${escapeHtml(asset.path)}">
      <label class="field-label" for="assetAliasInput">Display name</label>
      <input
        id="assetAliasInput"
        name="alias"
        type="text"
        spellcheck="false"
        value="${escapeHtml(draft.alias)}"
        placeholder="${escapeHtml(pathBasename(asset.path))}"
        data-asset-alias-input
        ${isPending ? 'disabled' : ''}
      >
      <label class="field-label" for="assetDescriptionInput">Description</label>
      <textarea
        id="assetDescriptionInput"
        name="description"
        rows="4"
        spellcheck="false"
        data-asset-description-input
        ${isPending ? 'disabled' : ''}
      >${escapeHtml(draft.description)}</textarea>
      <p class="muted asset-meta-hint">Shown anywhere the file name appears. Leave both fields blank to fall back to the raw file name.</p>
      <div class="inline-actions">
        <button class="link-button" type="submit" ${isPending ? 'disabled' : ''}>${isPending ? 'Saving...' : 'Save metadata'}</button>
        <button class="link-button" type="button" data-clear-asset-metadata="${escapeHtml(asset.path)}" ${isPending ? 'disabled' : ''}>Clear metadata</button>
      </div>
      ${feedback ? `<p class="asset-meta-feedback${isError ? ' is-error' : ''}">${escapeHtml(feedback)}</p>` : ''}
    </form>
  `;
}

export function renderEditableAssetTitle(asset, fallbackText) {
  const title = escapeHtml(asset ? getAssetDisplayName(asset) : fallbackText);
  if (!asset) return `<h2>${title}</h2>`;

  const isEditing = state.inlineAssetEditorPath === asset.path;
  if (isEditing) {
    const draft = getAssetMetadataDraft(asset);
    const pending = state.assetMetadataPendingPath === asset.path;
    const inlineValue = draft.alias || getAssetDisplayName(asset);
    return `
      <form class="preview-title-edit-form" data-inline-asset-title-form data-inline-asset-path="${escapeHtml(asset.path)}">
        <input
          class="preview-title-input"
          type="text"
          spellcheck="false"
          value="${escapeHtml(inlineValue)}"
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
          data-cancel-inline-asset-edit="${escapeHtml(asset.path)}"
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
    <div class="preview-title-row" data-edit-asset-metadata="${escapeHtml(asset.path)}" title="Double-click to edit name">
      <h2>${title}</h2>
      <button
        class="asset-edit-button"
        type="button"
        data-edit-asset-metadata="${escapeHtml(asset.path)}"
        aria-label="Edit asset name"
        title="Edit asset name"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M11.8 1.8a1.7 1.7 0 0 1 2.4 2.4l-7.9 7.9-3.6.8.8-3.6 7.9-7.9Zm1.4 1-1.4-1.4a.5.5 0 0 0-.7 0L10 2.5l2.1 2.1 1.1-1.1a.5.5 0 0 0 0-.7ZM11.3 5.3 9.2 3.2 4 8.4l-.5 2 2-.5 5.8-5.8Z" fill="currentColor"></path>
        </svg>
      </button>
    </div>
  `;
}

// Wire the renderEditableAssetTitle into scenes.js so it can use it
setRenderEditableAssetTitle(renderEditableAssetTitle);

export function startInlineAssetEdit(assetPath) {
  if (!assetPath) return;
  state.sidebarInlineAssetEditorPath = null;
  state.inlineAssetEditorPath = assetPath;
  state.assetMetadataDraftByPath[assetPath] = {
    alias: getMetadataAlias(assetPath) || getMetadataDefaultName(assetPath),
    description: getMetadataDescription(assetPath),
  };
  renderAll();
  window.requestAnimationFrame(() => {
    const input = viewer.querySelector('[data-inline-asset-alias-input]');
    input?.focus();
    input?.select();
  });
}

export function cancelInlineAssetEdit(assetPath = state.inlineAssetEditorPath) {
  if (!assetPath) return;
  state.assetMetadataDraftByPath[assetPath] = {
    alias: getMetadataAlias(assetPath),
    description: getMetadataDescription(assetPath),
  };
  if (state.inlineAssetEditorPath === assetPath) {
    state.inlineAssetEditorPath = null;
  }
  renderAll();
}

export function startSidebarInlineAssetEdit(assetPath) {
  if (!assetPath) return;
  state.inlineAssetEditorPath = null;
  state.sidebarInlineAssetEditorPath = assetPath;
  let aliasDefault;
  if (assetPath.startsWith(SCENE_NODE_KEY_PREFIX)) {
    aliasDefault = state.sceneNodeAliasByKey[assetPath] || assetPath.split('::').pop() || assetPath;
  } else {
    aliasDefault = getMetadataAlias(assetPath) || getMetadataDefaultName(assetPath) || getMetadataDisplayName(assetPath);
  }
  state.assetMetadataDraftByPath[assetPath] = {
    alias: aliasDefault,
    description: getMetadataDescription(assetPath),
  };
  renderAll();
  window.requestAnimationFrame(() => {
    const input = assetList.querySelector('[data-sidebar-inline-asset-alias-input]');
    input?.focus();
    input?.select();
  });
}

export function cancelSidebarInlineAssetEdit(assetPath = state.sidebarInlineAssetEditorPath) {
  if (!assetPath) return;
  if (assetPath.startsWith(SCENE_NODE_KEY_PREFIX)) {
    state.assetMetadataDraftByPath[assetPath] = {
      alias: state.sceneNodeAliasByKey[assetPath] || '',
      description: '',
    };
  } else {
    state.assetMetadataDraftByPath[assetPath] = {
      alias: getMetadataAlias(assetPath),
      description: getMetadataDescription(assetPath),
    };
  }
  if (state.sidebarInlineAssetEditorPath === assetPath) {
    state.sidebarInlineAssetEditorPath = null;
  }
  renderAll();
}

// --- Inspector rendering ---

function renderSelectionInspector() {
  if (state.error) {
    selectionInspector.innerHTML = '';
    return;
  }

  if (isRuleGraphView()) {
    const graph = getRuleGraph();
    const counts = graph?.counts || {};
    selectionInspector.innerHTML = `
      <div class="section-head"><h2>Rule graph</h2></div>
      ${graph ? renderKeyValue([
        ['Families', formatNumber(counts.eventFamilies || 0)],
        ['Scenes', `${formatNumber(counts.scenes || 0)}${counts.namedScenes ? ` (${formatNumber(counts.namedScenes)} named)` : ''}`],
        ['Sounds', formatNumber(counts.sounds || 0)],
        ['Modules', formatNumber(counts.ruleModules || 0)],
      ]) : '<p class="muted">Graph not loaded yet.</p>'}
      ${graph ? `
        <div class="inline-actions">
          <a class="link-button" href="/api/rule-graph?path=${encodeURIComponent(targetInput.value.trim())}" target="_blank" rel="noreferrer">Open JSON</a>
        </div>
      ` : ''}
    `;
    return;
  }

  if (isAudioView()) {
    const script = getSelectedSoundScript();
    const soundSystem = getSoundSystem();
    const displayName = getSoundScriptDisplayName(script);
    const baseLabel = getSoundScriptBaseLabel(script);
    selectionInspector.innerHTML = `
      <div class="section-head"><h2>Selection</h2></div>
      ${script ? renderKeyValue([
        ['Name', `<code>${escapeHtml(displayName)}</code>`],
        ['Script id', `<code>${escapeHtml(baseLabel || `Script ${script.scriptIndex}`)}</code>`],
        ['Channels', `<code>${escapeHtml(getSoundChannelLabel(script))}</code>`],
        ['Duration', formatDurationMs(script.durationMs)],
        ['Codec', `<code>${escapeHtml(script.codec)}</code>`],
        ['Fragments', formatNumber(script.fragmentCount)],
        ['Frames', formatNumber(script.byteLength)],
      ]) : '<p class="muted">Select a sound script to inspect it.</p>'}
      ${script ? renderSoundActions(script) : ''}
      ${soundSystem ? renderKeyValue([
        ['Sample rate', `${formatNumber(soundSystem.sampleRate)} Hz`],
        ['Scripts', formatNumber(soundSystem.scriptCount)],
      ]) : ''}
      ${state.soundActionError ? `<p class="muted">${escapeHtml(state.soundActionError)}</p>` : ''}
    `;
    return;
  }

  const asset = getSelectedAsset();
  const sceneDetails = getSceneDetailsForAsset(asset);
  if (!asset) {
    selectionInspector.innerHTML = `
      <div class="section-head"><h2>Selection</h2></div>
      <p class="muted">Select an asset to inspect its format, offsets, and preview links.</p>
    `;
    return;
  }

  const rawUrl = getAssetUrl(asset.path);
  const previewUrl = getAssetPreviewUrl(asset);
  selectionInspector.innerHTML = `
    <div class="section-head"><h2>Selection</h2></div>
    ${renderKeyValue([
      ['Name', `<code>${escapeHtml(getAssetDisplayName(asset))}</code>`],
      ['Path', `<code>${escapeHtml(asset.path)}</code>`],
      ['Description', escapeHtml(getAssetDescription(asset) || 'n/a')],
      ['Kind', `<code>${escapeHtml(asset.kind)}</code>`],
      ['Format', `<code>${escapeHtml(asset.format || 'unknown')}</code>`],
      ['Scene type', sceneDetails?.sceneType ? `<code>${escapeHtml(sceneDetails.sceneType)}</code>` : (asset.sceneType ? `<code>${escapeHtml(asset.sceneType)}</code>` : 'n/a')],
      ['Size', formatNumber(asset.size)],
      ['Stored', formatNumber(asset.storedSize)],
      ['Offset', `<code>${formatHex(asset.offset)}</code>`],
    ])}
    <div class="inline-actions">
      <a class="link-button" href="${rawUrl}" target="_blank" rel="noreferrer">Open Raw</a>
      ${isAssetViewable(asset) ? `<a class="link-button" href="${previewUrl}" target="_blank" rel="noreferrer">Open Preview</a>` : ''}
    </div>
    ${renderAssetMetadataEditor(asset)}
  `;
}

function renderPackageInspector() {
  if (!state.currentData || state.error) {
    packageInspector.innerHTML = '';
    return;
  }

  const wrapper = state.currentData.squashfs;
  packageInspector.innerHTML = `
    <div class="section-head"><h2>Input source</h2></div>
    ${renderKeyValue([
      ['Driver', `<code>${escapeHtml(shortBackendName(state.currentData.sourceSupport?.driver))}</code>`],
      ['Status', `<code>${escapeHtml(state.currentData.sourceSupport?.status || 'unknown')}</code>`],
      ['Mode', `<code>${escapeHtml(state.currentData.sourceSupport?.mode || 'unknown')}</code>`],
      ['Wrapper', wrapper ? `<code>${escapeHtml(pathBasename(wrapper.innerRelative))}</code>` : 'none'],
      ['Extracted', wrapper ? `<code>${escapeHtml(pathBasename(wrapper.extractedPath))}</code>` : 'n/a'],
    ])}
    ${state.currentData.sourceSupport?.note ? `<p class="muted">${escapeHtml(state.currentData.sourceSupport.note)}</p>` : ''}
  `;
}

function renderManifestInspector() {
  if (!state.currentData || state.error) {
    manifestInspector.innerHTML = '';
    return;
  }

  const manifest = state.currentData.spike?.assetManifest;
  manifestInspector.innerHTML = `
    <div class="section-head"><h2>Manifest</h2></div>
    ${manifest ? renderKeyValue([
      ['Paths', formatNumber(manifest.totalPaths)],
      ['Likely assets', formatNumber(manifest.likelyAssets.length)],
      ['Game assets', formatNumber(manifest.gameAssets.length)],
      ['Kinds', Object.keys(manifest.byKind || {}).length ? Object.entries(manifest.byKind).map(([key, value]) => `${escapeHtml(key)}:${formatNumber(value)}`).join('<br>') : 'n/a'],
    ]) : '<p class="muted">No manifest-like path list was extracted.</p>'}
  `;
}

// --- View rendering ---

function renderAssetHeaderActions(asset) {
  if (!asset) return '';

  const isVideo = asset.previewKind === 'video';
  const replacePending = state.videoReplacePending;
  const replaceError = state.videoReplaceError;
  const replaceSuccess = state.videoReplaceAssetPath === asset.path;

  return `
    <div class="preview-header-actions">
      <a class="link-button" href="${getAssetUrl(asset.path)}" download>Download</a>
      ${isVideo ? `
        <button class="link-button" type="button" data-video-replace="${escapeHtml(asset.path)}" ${replacePending ? 'disabled' : ''}>${replacePending ? 'Replacing\u2026' : 'Replace'}</button>
        <input id="videoReplaceInput" type="file" accept=".mp4,.mov,.webm,video/*" hidden ${replacePending ? 'disabled' : ''}>
        ${replaceError ? `<span class="error-text">${escapeHtml(replaceError)}</span>` : ''}
        ${replaceSuccess ? '<span class="success-text">Replaced successfully</span>' : ''}
      ` : ''}
    </div>
  `;
}

function renderAssetsView() {
  const asset = getSelectedAsset();
  return `
    <div class="viewer-stack">
      <section class="preview-stage preview-stage-seamless">
        <div class="preview-header">
          <div>
            ${renderEditableAssetTitle(asset, 'Select an asset')}
          </div>
          ${renderAssetHeaderActions(asset)}
        </div>
        ${renderAssetSurface(asset)}
      </section>
    </div>
  `;
}

function renderSummaryView() {
  const spike = state.currentData?.spike;
  const selected = getSelectedAsset();
  const soundSystem = getSoundSystem();

  return `
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div>
            <h2>${escapeHtml(pathBasename(state.currentData.resolvedPath || state.currentData.targetPath || 'No target'))}</h2>
          </div>
        </div>
      </section>

      <section class="two-col">
        <article class="panel">
          <h3>Source summary</h3>
          ${renderKeyValue([
            ['Requested path', `<code>${escapeHtml(state.currentData.targetPath)}</code>`],
            ['Resolved path', `<code>${escapeHtml(state.currentData.resolvedPath)}</code>`],
            ['Driver', `<code>${escapeHtml(state.currentData.sourceSupport?.driver || 'unknown')}</code>`],
            ['Status', `<code>${escapeHtml(state.currentData.sourceSupport?.status || 'unknown')}</code>`],
            ['Mode', `<code>${escapeHtml(state.currentData.sourceSupport?.mode || 'unknown')}</code>`],
          ])}
        </article>
        <article class="panel">
          <h3>Current selection</h3>
          ${selected ? renderKeyValue([
            ['Name', `<code>${escapeHtml(getAssetDisplayName(selected))}</code>`],
            ['Path', `<code>${escapeHtml(selected.path)}</code>`],
            ['Description', escapeHtml(getAssetDescription(selected) || 'n/a')],
            ['Kind', `<code>${escapeHtml(selected.kind)}</code>`],
            ['Preview', `<code>${escapeHtml(selected.previewKind || 'none')}</code>`],
            ['Size', formatNumber(selected.size)],
            ['Scene', selected.scenePath ? `<code>${escapeHtml(selected.scenePath)}</code>` : 'n/a'],
          ]) : '<p class="muted">No asset selected yet.</p>'}
        </article>
      </section>
    </div>
  `;
}

function renderEntriesView() {
  const entries = state.currentData?.spike?.entries || [];
  return `
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div>
            <h2>Indexed entry blocks</h2>
          </div>
        </div>
      </section>
      <section class="entry-grid">
        ${entries.length ? entries.map((entry, index) => `
          <article class="entry-card">
            <div class="eyebrow">Entry ${index + 1}</div>
            <h3>${escapeHtml(entry.name || entry.indexType || 'Unnamed entry')}</h3>
            ${renderKeyValue([
              ['SPK0', `<code>${formatHex(entry.spk0Offset)}</code>`],
              ['Index', `<code>${formatHex(entry.indexOffset)}</code>`],
              ['Type', `<code>${escapeHtml(entry.indexType || 'n/a')}</code>`],
              ['Declared', formatNumber(entry.declaredSize)],
              ['Payload', `<code>${escapeHtml(entry.payloadKind || 'unknown')}</code>`],
              ['Strings', formatNumber(entry.stringsCount)],
              ['Files', formatNumber(entry.indexedFiles.length)],
            ])}
          </article>
        `).join('') : '<div class="panel"><p class="muted">No entry groups were found by the current parser.</p></div>'}
      </section>
    </div>
  `;
}

function renderReferencesView() {
  const strings = state.currentData?.spike?.stringsPreview || [];
  const wrapper = state.currentData?.squashfs?.listingPreview || [];
  const manifestPaths = state.currentData?.spike?.assetManifest?.gameAssets?.length
    ? state.currentData.spike.assetManifest.gameAssets
    : state.currentData?.spike?.assetManifest?.paths || [];

  return `
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div>
            <h2>Strings, paths, and wrapper hints</h2>
          </div>
        </div>
      </section>

      <section class="reference-grid">
        <article class="panel">
          <h3>Top-level strings</h3>
          ${renderList(strings)}
        </article>
        <article class="panel">
          <h3>Squashfs listing preview</h3>
          ${renderList(wrapper)}
        </article>
      </section>

      <section class="panel">
        <h3>Manifest paths</h3>
        ${renderList(manifestPaths, 'manifest-paths')}
      </section>
    </div>
  `;
}

function renderViewer() {
  stopAnimationPreview();
  destroyRadiumPlayer();
  clearPreviewTransitionTimer();

  if (state.loading) {
    viewer.innerHTML = '<div class="empty-state"><p class="muted">Inspecting target and rebuilding the workbench...</p></div>';
    return;
  }

  if (state.error) {
    viewer.innerHTML = `<div class="error-state"><strong>Inspect failed</strong><p>${escapeHtml(state.error)}</p></div>`;
    return;
  }

  if (!state.currentData) {
    viewer.innerHTML = '<div class="empty-state"><p class="muted">Load a target to populate the workbench.</p></div>';
    return;
  }

  let markup = '';
  if (state.activeView === 'graph') markup = renderRuleGraphView();
  if (state.activeView === 'summary') markup = renderSummaryView();
  if (state.activeView === 'assets') markup = isAudioView() ? renderAudioView() : renderAssetsView();
  if (state.activeView === 'scenes') markup = renderScenesView();
  if (state.activeView === 'entries') markup = renderEntriesView();
  if (state.activeView === 'references') markup = renderReferencesView();

  const previousPreview = capturePreviewTransitionState();
  viewer.innerHTML = markup;
  applyPreviewTransition(previousPreview);
  wirePreviewSurfaceLoaders();
  const selected = getSelectedAsset();
  const sceneDetails = getSceneDetailsForAsset(selected);
  if (sceneDetails?.previewKind === 'flipbook' && sceneDetails.frames?.length > 1) {
    wireSceneFlipbookPreview(sceneDetails);
    return;
  }
  if (selected?.sceneType === 'StreamingFlipbook' && selected.clipFrames?.length > 1) {
    wireStreamingFlipbookPreview(selected);
    return;
  }
  wireRadiumPlayer();
}

// --- Sidebar ---

export function renderSidebar() {
  if (isRuleGraphView()) {
    renderGraphSidebar();
    return;
  }

  if (assetListHeading) {
    if (isAudioView()) {
      assetListHeading.textContent = 'Sound index';
    } else {
      assetListHeading.textContent = state.activeView === 'scenes'
        ? 'Scene index'
        : 'Asset index';
    }
  }

  if (!state.currentData || state.error) {
    assetList.innerHTML = '<p class="muted">No assets to display.</p>';
    return;
  }

  if (isAudioView()) {
    ensureSelectedSoundScript();
    const scripts = getFilteredSoundScripts();

    if (!scripts.length) {
      const soundError = state.currentData?.spike?.soundError;
      assetList.innerHTML = soundError
        ? `<div class="error-state"><strong>Sound decode failed</strong><p>${escapeHtml(soundError)}</p></div>`
        : '<p class="muted">No sound scripts matched the current filters.</p>';
      return;
    }

    assetList.innerHTML = renderSoundRows(scripts);
    return;
  }

  if (state.activeView === 'scenes') {
    ensureSelectedAsset();
    const rows = getRenderableSceneRows();
    if (assetListHeading) {
      assetListHeading.textContent = isFlatSceneFileMode(rows) ? 'File browser' : 'Scene index';
    }

    if (!rows.length) {
      assetList.innerHTML = '<p class="muted">No scene files matched the current filters.</p>';
      return;
    }

    assetList.innerHTML = renderSceneRows(rows);
    return;
  }

  ensureSelectedAsset();
  const filtered = getFilteredAssets();

  if (!filtered.length) {
    assetList.innerHTML = '<p class="muted">No assets matched the current filters.</p>';
    return;
  }

  assetList.innerHTML = filtered.map((asset) => `
    ${state.sidebarInlineAssetEditorPath === asset.path ? `
      <div class="asset-row${asset.path === state.selectedAssetPath ? ' is-selected' : ''} is-editing">
        ${renderSidebarInlineAssetEditor(
          asset.path,
          getAssetDisplayName(asset),
          `<div class="asset-subtitle">${escapeHtml(asset.path)}</div>`,
        )}
      </div>
    ` : `
      <button class="asset-row${asset.path === state.selectedAssetPath ? ' is-selected' : ''}" type="button" data-asset-path="${escapeHtml(asset.path)}" data-edit-sidebar-asset-path="${escapeHtml(asset.path)}">
        <div class="asset-row-top">
          <span class="asset-title">${escapeHtml(getAssetDisplayName(asset))}</span>
          <span class="badge kind-badge">${escapeHtml(asset.kind)}</span>
        </div>
        <div class="asset-subtitle">${escapeHtml(asset.path)}</div>
      </button>
    `}
  `).join('');
}

// --- Statusbar ---

function renderStatusbar() {
  const assetCount = state.currentData?.spike?.assetFiles.length || 0;
  const sceneCount = state.currentData?.spike?.radiumScenes.length || 0;
  const soundCount = state.currentData?.spike?.soundScripts?.length || 0;
  const selected = getSelectedAsset();
  const selectedSound = getSelectedSoundScript();
  const selectedGraphNode = getGraphNodeById();
  statusbar.innerHTML = [
    `<span>${escapeHtml(pathBasename(state.currentData?.resolvedPath || state.currentData?.targetPath || 'no-target'))}</span>`,
    '<span class="divider"></span>',
    `<span>${formatNumber(assetCount)} assets</span>`,
    '<span class="divider"></span>',
    `<span>${formatNumber(sceneCount)} scenes</span>`,
    '<span class="divider"></span>',
    `<span>${formatNumber(soundCount)} sounds</span>`,
    '<span class="divider"></span>',
    `<span>${escapeHtml(state.activeView)}</span>`,
    '<span class="divider"></span>',
    `<span>${escapeHtml(
      isRuleGraphView()
        ? (selectedGraphNode?.label || 'no graph node selected')
        : (isAudioView() ? (selectedSound?.label || 'no sound selected') : (selected ? selected.path : 'nothing selected'))
    )}</span>`,
  ].join('');
}

// --- Topbar / tabs ---

function getTopbarViewKey() {
  if (state.activeView === 'graph') return 'graph';
  if (state.activeView === 'assets' && state.activeKind === 'all') return 'all-files';
  if (state.activeView === 'scenes') return 'scenes';
  if (state.activeView === 'assets' && state.activeKind === 'font') return 'fonts';
  if (state.activeView === 'assets' && state.activeKind === 'image') return 'images';
  if (state.activeView === 'assets' && state.activeKind === 'audio') return 'audio';
  if (state.activeView === 'assets' && state.activeKind === 'video') return 'videos';
  return '';
}

function syncTabs() {
  const activeTopbarView = getTopbarViewKey();
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('is-active', button.dataset.view === activeTopbarView);
  }
}

function updateTopbarCounts() {
  const assets = getAssets();
  tabCountFonts.textContent = formatNumber(assets.filter((asset) => asset.kind === 'font').length);
  tabCountImages.textContent = formatNumber(assets.filter((asset) => asset.kind === 'image').length);
  tabCountScenes.textContent = formatNumber(state.currentData?.spike?.radiumScenes.length || 0);
  tabCountAudio.textContent = formatNumber(getSoundScripts().length);
  if (tabCountVideos) {
    tabCountVideos.textContent = formatNumber(assets.filter((asset) => asset.kind === 'video').length);
  }
  if (tabCountGraph) {
    tabCountGraph.textContent = formatNumber(getRuleGraph()?.counts?.eventFamilies || 0);
  }
}

function updateViewerToolbar() {
  if (state.loading) {
    viewerSelectionName.textContent = 'Inspecting target...';
    return;
  }

  if (state.error) {
    viewerSelectionName.textContent = 'Inspect failed';
    return;
  }

  if (!state.currentData) {
    viewerSelectionName.textContent = 'No target loaded';
    return;
  }

  const selected = getSelectedAsset();
  const selectedSound = getSelectedSoundScript();
  const selectedGraphNode = getGraphNodeById();
  if (state.activeView === 'graph') {
    viewerSelectionName.textContent = selectedGraphNode?.label || 'Rule graph';
    return;
  }
  if (state.activeView === 'summary') {
    viewerSelectionName.textContent = pathBasename(state.currentData.resolvedPath || state.currentData.targetPath);
    return;
  }

  if (state.activeView === 'scenes') {
    if (state.selectedSceneNodeId && state.selectedSceneNodeScenePath) {
      const nodeAlias = getSceneNodeAlias(state.selectedSceneNodeScenePath, state.selectedSceneNodeId);
      const sceneData = state.radiumScenesByPath[state.selectedSceneNodeScenePath];
      const allNodes = sceneData?.assetTree ? [
        ...(sceneData.assetTree.images || []),
        ...(sceneData.assetTree.sounds || []),
        ...(sceneData.assetTree.videoClips || []),
        ...(sceneData.assetTree.fonts || []),
        ...(sceneData.assetTree.spineAssets || []),
        ...(sceneData.assetTree.texts || []),
      ] : [];
      const node = allNodes.find((n) => n.id === state.selectedSceneNodeId);
      viewerSelectionName.textContent = nodeAlias || node?.label || state.selectedSceneNodeId;
    } else {
      viewerSelectionName.textContent = selected ? getAssetDisplayName(selected) : 'Radium scenes';
    }
    return;
  }

  if (isAudioView()) {
    viewerSelectionName.textContent = selectedSound?.label || 'Decoded sound scripts';
    return;
  }

  viewerSelectionName.textContent = selected ? getAssetDisplayName(selected) : 'No asset selected';
}

function updateLoadOverlay() {
  const hasData = !!state.currentData;
  if (loadOverlay) {
    loadOverlay.hidden = hasData || state.loading;
  }
  if (topbarFileLabel) {
    if (hasData) {
      const name = pathBasename(state.currentData.resolvedPath || state.currentData.targetPath || '');
      topbarFileLabel.textContent = `Current File: ${name}`;
    } else {
      topbarFileLabel.textContent = 'No file loaded';
    }
  }
}

function syncFilterVisibility() {
  const isGraph = isRuleGraphView();
  const hideSceneFilter = isAudioView() || isGraph;
  if (sidebarFilters) {
    sidebarFilters.hidden = state.activeView === 'scenes';
  }
  if (assetSearchLabel) {
    assetSearchLabel.textContent = isGraph ? 'Graph search' : 'Asset search';
  }
  assetSearch.placeholder = isGraph
    ? 'rampage, scene.radium, demand_loaded'
    : 'png, radium, scene.assets';
  if (viewableOnlyRow) {
    viewableOnlyRow.hidden = isGraph;
  }
  if (sceneTypeFilterLabel) {
    sceneTypeFilterLabel.hidden = hideSceneFilter;
  }
  if (sceneTypeFilter) {
    sceneTypeFilter.hidden = hideSceneFilter;
  }
}

// --- The central orchestrator ---

export function renderAll() {
  if (isRuleGraphView()) {
    ensureSelectedGraphNode();
    if (state.currentData && !state.ruleGraph && !state.ruleGraphLoading && !state.ruleGraphError) {
      void loadRuleGraph();
    }
  }
  renderTargetSummary();
  renderSidebar();
  renderSelectionInspector();
  renderPackageInspector();
  renderManifestInspector();
  renderViewer();
  renderStatusbar();
  syncTabs();
  syncFilterVisibility();
  updateTopbarCounts();
  updateViewerToolbar();
  updateLoadOverlay();
  queueSelectedSceneDetailsLoad();
  queueSelectedSoundPreviewPrepare();
  queueSelectedPreviewSurfaceLoad();
}
