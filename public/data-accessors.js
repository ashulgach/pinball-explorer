// ---------------------------------------------------------------------------
// State-derived getters, filtering, URL builders, and metadata helpers.
// ---------------------------------------------------------------------------

import {
  state,
  targetInput,
  assetSearch,
  viewableOnly,
  sceneTypeFilter,
  SCENE_NODE_KEY_PREFIX,
  SOUND_SCRIPT_KEY_PREFIX,
  soundPreviewPrepareInflight,
} from './state.js';

import {
  escapeHtml,
  formatNumber,
  pathBasename,
  getAssetPathValue,
  sceneNodeMetadataKey,
} from './utils.js';

// --- Asset record helpers ---

export function getAssets() {
  return state.currentData?.spike?.assetFiles || [];
}

export function getAssetRecord(assetOrPath) {
  if (assetOrPath && typeof assetOrPath === 'object' && (assetOrPath.alias !== undefined || assetOrPath.description !== undefined)) {
    return assetOrPath;
  }

  const assetPath = getAssetPathValue(assetOrPath);
  if (!assetPath) return assetOrPath && typeof assetOrPath === 'object' ? assetOrPath : null;
  return getAssets().find((asset) => asset.path === assetPath) || (assetOrPath && typeof assetOrPath === 'object' ? assetOrPath : null);
}

export function getAssetAlias(assetOrPath) {
  return String(getAssetRecord(assetOrPath)?.alias || '').trim();
}

export function getAssetDescription(assetOrPath) {
  return String(getAssetRecord(assetOrPath)?.description || '').trim();
}

export function getAssetDisplayName(assetOrPath) {
  const alias = getAssetAlias(assetOrPath);
  if (alias) return alias;
  const assetPath = getAssetPathValue(assetOrPath);
  const graphName = state.graphSceneNameByPath[assetPath];
  if (graphName) return graphName;
  return pathBasename(assetPath);
}

export function getAssetMetadataDraft(asset) {
  return getMetadataDraft(asset?.path, asset);
}

export function getAssetSearchText(asset) {
  return [
    asset.path,
    asset.scenePath,
    asset.sceneLabel,
    asset.kind,
    asset.format,
    getAssetDisplayName(asset),
    getAssetAlias(asset),
    getAssetDescription(asset),
  ].filter(Boolean).join('\n').toLowerCase();
}

// --- Sound data getters ---

export function getSoundSystem() {
  return state.currentData?.spike?.soundSystem || null;
}

export function getSoundScripts() {
  return state.currentData?.spike?.soundScripts || [];
}

export function getSoundScriptByIndex(scriptIndex) {
  return getSoundScripts().find((script) => script.scriptIndex === scriptIndex) || null;
}

export function getSelectedSoundScript() {
  return getSoundScriptByIndex(state.selectedSoundScriptIndex);
}

export function getSoundScriptMetadataKey(scriptOrIndex) {
  const scriptIndex = typeof scriptOrIndex === 'object'
    ? Number(scriptOrIndex?.scriptIndex)
    : Number(scriptOrIndex);
  if (!Number.isInteger(scriptIndex) || scriptIndex < 0) return '';
  return `${SOUND_SCRIPT_KEY_PREFIX}${scriptIndex}`;
}

export function parseSoundScriptMetadataKey(value) {
  const raw = String(value || '');
  if (!raw.startsWith(SOUND_SCRIPT_KEY_PREFIX)) return null;
  const scriptIndex = Number(raw.slice(SOUND_SCRIPT_KEY_PREFIX.length));
  if (!Number.isInteger(scriptIndex) || scriptIndex < 0) return null;
  return scriptIndex;
}

export function getSoundScriptByMetadataKey(value) {
  const scriptIndex = parseSoundScriptMetadataKey(value);
  return scriptIndex === null ? null : getSoundScriptByIndex(scriptIndex);
}

export function getSoundScriptAlias(script) {
  return String(script?.alias || '').trim();
}

export function getSoundScriptDefaultName(script) {
  const defaultLabel = String(script?.defaultLabel || script?.label || '').trim();
  if (defaultLabel) return defaultLabel;
  const scriptIndex = Number(script?.scriptIndex);
  return Number.isInteger(scriptIndex) ? `Script ${scriptIndex}` : 'Untitled sound';
}

export function getSoundScriptDisplayName(script) {
  return getSoundScriptAlias(script) || getSoundScriptDefaultName(script);
}

export function getSoundScriptBaseLabel(script) {
  const baseLabel = getSoundScriptDefaultName(script);
  return baseLabel === getSoundScriptDisplayName(script) ? '' : baseLabel;
}

export function getMetadataAlias(metadataPath) {
  const asset = getAssets().find((item) => item.path === metadataPath);
  if (asset) return getAssetAlias(asset);

  const script = getSoundScriptByMetadataKey(metadataPath);
  if (script) return getSoundScriptAlias(script);

  if (String(metadataPath || '').startsWith(SCENE_NODE_KEY_PREFIX)) {
    return state.sceneNodeAliasByKey[metadataPath] || '';
  }

  return '';
}

export function getMetadataDefaultName(metadataPath) {
  const asset = getAssets().find((item) => item.path === metadataPath);
  if (asset) return pathBasename(asset.path);

  const script = getSoundScriptByMetadataKey(metadataPath);
  if (script) return getSoundScriptDefaultName(script);

  if (String(metadataPath || '').startsWith(SCENE_NODE_KEY_PREFIX)) {
    return metadataPath.split('::').pop() || metadataPath;
  }

  return pathBasename(metadataPath);
}

export function getMetadataDisplayName(metadataPath) {
  const asset = getAssets().find((item) => item.path === metadataPath);
  if (asset) return getAssetDisplayName(asset);

  const script = getSoundScriptByMetadataKey(metadataPath);
  if (script) return getSoundScriptDisplayName(script);

  const sceneAlias = state.sceneNodeAliasByKey[metadataPath];
  if (sceneAlias) return sceneAlias;
  return getMetadataDefaultName(metadataPath);
}

export function getMetadataDescription(metadataPath) {
  const asset = getAssets().find((item) => item.path === metadataPath);
  if (asset) return getAssetDescription(asset);

  const script = getSoundScriptByMetadataKey(metadataPath);
  if (script) return String(script.description || '').trim();

  return '';
}

export function getMetadataDraft(metadataPath, record = null) {
  if (!metadataPath) {
    return { alias: '', description: '' };
  }

  const draft = state.assetMetadataDraftByPath[metadataPath];
  const fallbackAlias = record
    ? String(record.alias || '')
    : getMetadataAlias(metadataPath);
  const fallbackDescription = record
    ? String(record.description || '')
    : getMetadataDescription(metadataPath);
  return {
    alias: draft?.alias ?? fallbackAlias,
    description: draft?.description ?? fallbackDescription,
  };
}

// --- View predicates ---

export function isAudioView() {
  return state.activeView === 'assets' && state.activeKind === 'audio';
}

export function isVideoView() {
  return state.activeView === 'assets' && state.activeKind === 'video';
}

export function isRuleGraphView() {
  return state.activeView === 'graph';
}

export function getSelectedAsset() {
  return getAssets().find((asset) => asset.path === state.selectedAssetPath) || null;
}

// --- Scene helpers ---

export function getScenePathForAsset(asset) {
  if (!asset) return null;
  if (asset.kind === 'scene' || asset.format === 'radium') return asset.path;
  return asset.scenePath || null;
}

export function getSceneDetailsForAsset(asset) {
  const scenePath = getScenePathForAsset(asset);
  if (!scenePath) return null;
  return state.sceneDetailsByPath[scenePath] || null;
}

export function getResolvedSceneType(scenePath, fallback = 'Unknown') {
  return state.sceneDetailsByPath[scenePath]?.sceneType || fallback;
}

export function getResolvedSceneTypeForAsset(asset) {
  const scenePath = getScenePathForAsset(asset);
  return getResolvedSceneType(scenePath, asset?.sceneType || 'Unknown');
}

export function isSceneContainerAsset(asset) {
  return Boolean(asset && (asset.kind === 'scene' || asset.format === 'radium'));
}

export function getSceneFrameForAsset(sceneDetails, asset) {
  if (!sceneDetails?.frames?.length || !asset?.path) return null;
  return sceneDetails.frames.find((frame) => frame.assetPath === asset.path) || null;
}

export function isAssetViewable(asset) {
  if (asset?.previewable || asset?.previewKind || asset?.previewMode) return true;
  return Boolean(getSceneDetailsForAsset(asset)?.previewKind);
}

// --- URL builders ---

export function getAssetUrl(assetPath) {
  return `/api/asset?path=${encodeURIComponent(targetInput.value.trim())}&asset=${encodeURIComponent(assetPath)}`;
}

export function getSceneFramePreviewUrl(scenePath, assetPath) {
  return `/api/scene-frame-preview?path=${encodeURIComponent(targetInput.value.trim())}&scene=${encodeURIComponent(scenePath)}&asset=${encodeURIComponent(assetPath)}`;
}

export function getAssetPreviewUrl(asset) {
  if (!asset) return '';
  if (asset?.previewMode === 'radium-gray8') {
    return `/api/asset-preview?path=${encodeURIComponent(targetInput.value.trim())}&asset=${encodeURIComponent(asset.path)}`;
  }

  const sceneDetails = getSceneDetailsForAsset(asset);
  if (!isSceneContainerAsset(asset)) {
    const sceneFrame = getSceneFrameForAsset(sceneDetails, asset);
    if (sceneFrame) {
      return getSceneFramePreviewUrl(sceneDetails.scenePath, sceneFrame.assetPath);
    }
    return getAssetUrl(asset.path);
  }

  if (sceneDetails?.previewKind === 'video' && sceneDetails.previewAssetPath) {
    return getAssetUrl(sceneDetails.previewAssetPath);
  }
  if (sceneDetails?.previewKind === 'flipbook' && sceneDetails.frames?.length) {
    return getSceneFramePreviewUrl(sceneDetails.scenePath, sceneDetails.frames[0].assetPath);
  }
  return getAssetUrl(asset.path);
}

// --- Filtering ---

export function getFilteredAssets() {
  const needle = assetSearch.value.trim().toLowerCase();
  const sceneType = sceneTypeFilter.value;
  return getAssets().filter((asset) => {
    if (state.activeKind !== 'all' && asset.kind !== state.activeKind) return false;
    if (needle && !getAssetSearchText(asset).includes(needle)) return false;
    if (viewableOnly.checked && !isAssetViewable(asset)) return false;
    if (sceneType && getResolvedSceneTypeForAsset(asset) !== sceneType) return false;
    return true;
  });
}

export function getFilteredSoundScripts() {
  const needle = assetSearch.value.trim().toLowerCase();
  return getSoundScripts().filter((script) => {
    if (viewableOnly.checked && script.byteLength <= 0) return false;
    if (!needle) return true;

    const haystack = [
      getSoundScriptDisplayName(script),
      getSoundScriptBaseLabel(script),
      `0x${script.scriptIndex.toString(16)}`,
      script.codec,
      script.durationMs,
      script.fragmentCount,
      script.stereo ? 'stereo' : 'mono',
      script.channelCount,
    ].join(' ').toLowerCase();

    return haystack.includes(needle);
  });
}

export function getFilteredSceneAssets() {
  return getFilteredAssets().filter((asset) => isSceneContainerAsset(asset));
}

export function isVideoSceneFilterActive() {
  return state.activeView === 'scenes' && sceneTypeFilter.value === 'Video';
}

export function getSceneGroups() {
  const sceneAssetsByPath = new Map(
    getAssets()
      .filter((asset) => isSceneContainerAsset(asset))
      .map((asset) => [asset.path, asset]),
  );
  const byPath = new Map();

  const ensureScene = (scenePath) => {
    if (!scenePath) return null;

    let scene = byPath.get(scenePath);
    if (!scene) {
      const sceneAsset = sceneAssetsByPath.get(scenePath) || null;
      scene = {
        scenePath,
        sceneType: getResolvedSceneType(scenePath, sceneAsset?.sceneType || 'RawScene'),
        sceneAsset,
        assets: [],
        clipLabels: new Set(),
      };
      byPath.set(scenePath, scene);
    }
    return scene;
  };

  for (const asset of getFilteredSceneAssets()) {
    ensureScene(asset.path);
  }

  for (const asset of getFilteredAssets()) {
    if (!asset.scenePath || asset.path === asset.scenePath || !isAssetViewable(asset)) continue;
    const scene = ensureScene(asset.scenePath);
    if (!scene) continue;
    scene.assets.push(asset);
    if (asset.sceneLabel) scene.clipLabels.add(asset.sceneLabel);
  }

  return [...byPath.values()]
    .map((scene) => ({
      ...scene,
      clipLabels: [...scene.clipLabels].sort(),
    }))
    .sort((a, b) => a.scenePath.localeCompare(b.scenePath));
}

export function getRenderableSceneGroups() {
  return getSceneGroups();
}

export function getSceneTypeOptions() {
  return [...new Set(getAssets().map((asset) => getResolvedSceneTypeForAsset(asset)).filter(Boolean))].sort();
}

// --- Selection ---

export function ensureSelectedAsset() {
  const filtered = getSelectableAssets();
  if (!filtered.length) {
    state.selectedAssetPath = null;
    return;
  }
  if (!state.selectedAssetPath || !filtered.some((asset) => asset.path === state.selectedAssetPath)) {
    state.selectedAssetPath = filtered[0].path;
  }
}

export function ensureSelectedSoundScript() {
  const filtered = getFilteredSoundScripts();
  if (!filtered.length) {
    state.selectedSoundScriptIndex = null;
    return;
  }

  if (state.selectedSoundScriptIndex === null || !filtered.some((script) => script.scriptIndex === state.selectedSoundScriptIndex)) {
    state.selectedSoundScriptIndex = filtered[0].scriptIndex;
  }
}

export function pickPrimarySceneAsset(scene) {
  return scene.assets.find((asset) => asset.clipFrames?.length)
    || scene.assets.find((asset) => asset.previewKind === 'image')
    || scene.assets[0]
    || null;
}

export function getRenderableSceneRows() {
  const scenes = getRenderableSceneGroups();

  if (isVideoSceneFilterActive()) {
    const videoRows = scenes.flatMap((scene) => {
      if (scene.sceneType !== 'Video') return [];
      return scene.assets
        .filter((asset) => asset.path !== scene.scenePath && asset.previewKind === 'video')
        .map((asset) => ({
          rowType: 'asset',
          scene,
          asset,
        }));
    });

    if (videoRows.length) {
      return videoRows.sort((left, right) => left.asset.path.localeCompare(right.asset.path));
    }
  }

  return scenes.map((scene) => ({
    rowType: 'scene',
    scene,
    asset: scene.sceneAsset || pickPrimarySceneAsset(scene),
  })).filter((row) => row.asset);
}

export function getSelectableAssets() {
  if (state.activeView === 'scenes') {
    return getRenderableSceneRows().map((row) => row.asset).filter(Boolean);
  }
  return getFilteredAssets();
}

export function isFlatSceneFileMode(rows = getRenderableSceneRows()) {
  return rows.some((row) => row.rowType === 'asset');
}

// --- Scene node aliases ---

export function getSceneNodeAlias(scenePath, nodeId) {
  return state.sceneNodeAliasByKey[sceneNodeMetadataKey(scenePath, nodeId)] || '';
}

export async function loadSceneNodeAliases() {
  try {
    const res = await fetch('/api/asset-metadata');
    const data = await res.json();
    if (data?.assets) {
      for (const [key, entry] of Object.entries(data.assets)) {
        if (key.startsWith(SCENE_NODE_KEY_PREFIX) && entry?.alias) {
          state.sceneNodeAliasByKey[key] = entry.alias;
        }
      }
    }
  } catch {
    // Non-critical -- aliases just won't display
  }
}

export function updateAssetMetadataInState(assetPath, metadata = {}) {
  const nextAlias = String(metadata.alias || '');
  const nextDescription = String(metadata.description || '');
  const soundScriptIndex = parseSoundScriptMetadataKey(assetPath);
  if (!state.currentData?.spike) return;

  state.currentData = {
    ...state.currentData,
    spike: {
      ...state.currentData.spike,
      assetFiles: (state.currentData.spike.assetFiles || []).map((asset) => (
        asset.path === assetPath
          ? { ...asset, alias: nextAlias, description: nextDescription }
          : asset
      )),
      soundScripts: (state.currentData.spike.soundScripts || []).map((script) => (
        script.scriptIndex === soundScriptIndex
          ? { ...script, alias: nextAlias, description: nextDescription }
          : script
      )),
    },
  };
}

export function resetInteractiveLoadState() {
  soundPreviewPrepareInflight.clear();
  state.previewLoadingByKey = {};
  state.previewLoadedByKey = {};
  state.soundPreviewLoadingByScript = {};
  state.soundPreviewPreparedByScript = {};
  state.soundPreviewRevisionByScript = {};
}

// --- Sidebar inline editor HTML ---

export function renderSidebarInlineAssetEditor(assetPath, fallbackText, extraMarkup = '') {
  const draft = getMetadataDraft(assetPath);
  const pending = state.assetMetadataPendingPath === assetPath;
  const inlineValue = draft.alias || getMetadataDisplayName(assetPath) || fallbackText;

  return `
    <div class="rail-inline-edit-row">
      <form class="rail-inline-edit-form" data-sidebar-inline-asset-title-form data-sidebar-inline-asset-path="${escapeHtml(assetPath)}">
        <input
          class="rail-inline-edit-input"
          type="text"
          spellcheck="false"
          value="${escapeHtml(inlineValue)}"
          data-sidebar-inline-asset-alias-input
          ${pending ? 'disabled' : ''}
        >
        <button
          class="asset-edit-button asset-edit-button-compact"
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
          class="asset-edit-button asset-edit-button-compact"
          type="button"
          data-cancel-sidebar-inline-asset-edit="${escapeHtml(assetPath)}"
          aria-label="Cancel asset name edit"
          title="Cancel"
          ${pending ? 'disabled' : ''}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m4.1 3 3.9 3.9L11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1z" fill="currentColor"></path>
          </svg>
        </button>
      </form>
      ${extraMarkup}
    </div>
  `;
}

export function getCompactSceneAssetLabel(assetPath, scenePath) {
  const fullPath = String(assetPath || '');
  if (!fullPath) return '';

  const sceneRoot = String(scenePath || '').replace(/\/scene\.radium$/, '');
  if (sceneRoot && fullPath.startsWith(`${sceneRoot}/`)) {
    const relativePath = fullPath.slice(sceneRoot.length + 1);
    const relativeParts = relativePath.split('/').filter(Boolean);
    if (relativeParts.length <= 4) return relativePath;
    return `.../${relativeParts.slice(-4).join('/')}`;
  }

  const parts = fullPath.split('/').filter(Boolean);
  if (parts.length <= 4) return fullPath;
  return `.../${parts.slice(-4).join('/')}`;
}
