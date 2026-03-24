// ---------------------------------------------------------------------------
// Entry point: imports, event wiring, and initialization.
// ---------------------------------------------------------------------------

import {
  state,
  targetInput,
  viewer,
  assetSearch,
  viewableOnly,
  sceneTypeFilter,
  sidebarResizer,
  loadOverlay,
  loadOverlayButton,
  topbarLoadNew,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SCENE_NODE_KEY_PREFIX,
  setRenderAll,
  setRefreshAudioSelectionPanels,
  scheduleAudioSelectionRefresh,
  bumpInspectionGeneration,
} from './state.js';

import {
  clamp,
  normalizeAssetAliasInput,
  getSidebarWidth,
  applySidebarWidth,
  persistSidebarWidth,
} from './utils.js';

import {
  getMetadataDefaultName,
  getMetadataDescription,
  isRuleGraphView,
  ensureSelectedAsset,
  ensureSelectedSoundScript,
  loadSceneNodeAliases,
  updateAssetMetadataInState,
  resetInteractiveLoadState,
} from './data-accessors.js';

import {
  getGraphNodeById,
  getGraphSceneAssetPath,
  ensureSelectedGraphNode,
  loadRuleGraph,
} from './graph.js';

import {
  stopSoundRowPlayback,
  syncAudioSidebarSelectionState,
  refreshAudioSelectionPanels,
  cancelPendingSoundPlayback,
  playSoundScript,
  stopSoundScript,
  replaceSelectedSound,
  initSound,
} from './sound.js';

import {
  loadRadiumScene,
  destroyRadiumPlayer,
  populateSceneTypeFilter,
} from './scenes.js';

import {
  handleRadiumImageReplace,
  initCropModal,
} from './crop-modal.js';

import {
  renderAll,
  startInlineAssetEdit,
  cancelInlineAssetEdit,
  startSidebarInlineAssetEdit,
  cancelSidebarInlineAssetEdit,
} from './renderers.js';

// --- Wire render callbacks at import time ---
setRenderAll(renderAll);
setRefreshAudioSelectionPanels(refreshAudioSelectionPanels);

// --- Asset metadata persistence ---

async function saveAssetMetadata(assetPath, values) {
  if (!assetPath) return;

  state.assetMetadataPendingPath = assetPath;
  state.assetMetadataSavedPath = null;
  state.assetMetadataErrorPath = null;
  state.assetMetadataError = '';
  renderAll();

  try {
    const res = await fetch('/api/asset-metadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assetPath,
        alias: values.alias,
        description: values.description,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Asset metadata save failed');
    }

    updateAssetMetadataInState(assetPath, data.metadata);
    if (assetPath.startsWith(SCENE_NODE_KEY_PREFIX)) {
      const alias = String(data.metadata?.alias || '');
      if (alias) {
        state.sceneNodeAliasByKey[assetPath] = alias;
      } else {
        delete state.sceneNodeAliasByKey[assetPath];
      }
    }
    state.assetMetadataDraftByPath[assetPath] = {
      alias: String(data.metadata?.alias || ''),
      description: String(data.metadata?.description || ''),
    };
    state.assetMetadataSavedPath = assetPath;
    if (state.inlineAssetEditorPath === assetPath) {
      state.inlineAssetEditorPath = null;
    }
    if (state.sidebarInlineAssetEditorPath === assetPath) {
      state.sidebarInlineAssetEditorPath = null;
    }
  } catch (error) {
    state.assetMetadataErrorPath = assetPath;
    state.assetMetadataError = error.message;
  } finally {
    if (state.assetMetadataPendingPath === assetPath) {
      state.assetMetadataPendingPath = null;
    }
    renderAll();
  }
}

// --- Video replace ---

async function replaceSelectedVideo(file) {
  const assetPath = document.querySelector('[data-video-replace]')?.dataset.videoReplace;
  if (!assetPath) return;

  state.videoReplacePending = true;
  state.videoReplaceError = '';
  state.videoReplaceAssetPath = null;
  renderAll();

  try {
    const target = targetInput.value.trim();
    const res = await fetch(
      `/api/video-replace?path=${encodeURIComponent(target)}&asset=${encodeURIComponent(assetPath)}`,
      { method: 'POST', body: file },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Video replace failed');
    }
    state.videoReplaceAssetPath = assetPath;
    // Re-inspect to pick up the new file size
    await inspectTargetPath(target, { preserveSelection: true });
  } catch (error) {
    state.videoReplaceError = error.message;
  } finally {
    state.videoReplacePending = false;
    renderAll();
  }
}

// --- Target inspection ---

async function inspectTargetPath(targetPath, { preserveSelection = false } = {}) {
  bumpInspectionGeneration();
  cancelPendingSoundPlayback();
  const previousAssetPath = preserveSelection ? state.selectedAssetPath : null;
  const previousSoundScriptIndex = preserveSelection ? state.selectedSoundScriptIndex : null;
  stopSoundRowPlayback({ clearSource: true });
  state.loading = true;
  state.error = '';
  state.ruleGraph = null;
  state.ruleGraphLoading = false;
  state.ruleGraphError = '';
  state.selectedGraphNodeId = null;
  state.expandedGraphFamilies = {};
  state.graphSceneNameByPath = {};
  state.soundActionError = '';
  state.assetMetadataDraftByPath = {};
  state.assetMetadataPendingPath = null;
  state.assetMetadataSavedPath = null;
  state.assetMetadataErrorPath = null;
  state.assetMetadataError = '';
  state.inlineAssetEditorPath = null;
  state.sidebarInlineAssetEditorPath = null;
  state.sceneDetailsByPath = {};
  state.sceneLoadingByPath = {};
  state.radiumScenesByPath = {};
  state.radiumSceneLoadingByPath = {};
  state.expandedScenePaths = {};
  state.selectedSceneNodeId = null;
  state.selectedSceneNodeScenePath = null;
  state.sceneNodeAliasByKey = {};
  destroyRadiumPlayer();
  resetInteractiveLoadState();
  renderAll();

  try {
    const res = await fetch(`/api/inspect?path=${encodeURIComponent(targetPath)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Inspect failed');
    }
    state.currentData = data;
    // Remember last successfully loaded target for next session.
    try { localStorage.setItem(LAST_TARGET_KEY, targetPath); } catch {}
    if (previousAssetPath && data.spike?.assetFiles?.some((asset) => asset.path === previousAssetPath)) {
      state.selectedAssetPath = previousAssetPath;
    }
    if (previousSoundScriptIndex !== null && data.spike?.soundScripts?.some((script) => script.scriptIndex === previousSoundScriptIndex)) {
      state.selectedSoundScriptIndex = previousSoundScriptIndex;
    }
    populateSceneTypeFilter();
    ensureSelectedAsset();
    ensureSelectedSoundScript();
    loadSceneNodeAliases();
  } catch (error) {
    state.currentData = null;
    state.selectedAssetPath = null;
    state.selectedSoundScriptIndex = null;
    state.error = error.message;
  } finally {
    state.loading = false;
    renderAll();
  }
}

// --- Native file picker ---

async function pickAndLoadFile() {
  let filePath;
  if (window.electronAPI?.pickFile) {
    filePath = await window.electronAPI.pickFile();
  } else {
    const res = await fetch('/api/pick-file');
    const data = await res.json();
    filePath = data.path;
  }
  if (!filePath) return;
  targetInput.value = filePath;
  await inspectTargetPath(filePath);
}

loadOverlayButton.addEventListener('click', () => void pickAndLoadFile());
topbarLoadNew.addEventListener('click', () => void pickAndLoadFile());

// --- Drag-and-drop support ---

document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.add('drag-over');
});

document.body.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('drag-over');
});

document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  // In Electron, File objects have a .path property with the full native path.
  // In a regular browser this is undefined, so drag-and-drop gracefully no-ops.
  const filePath = file?.path;
  if (!filePath) return;
  targetInput.value = filePath;
  await inspectTargetPath(filePath);
});

// --- Inspector toggle ---

const inspectorToggle = document.getElementById('inspectorToggle');
const workspace = document.querySelector('.workspace');
const INSPECTOR_HIDDEN_KEY = 'pinball-explorer.inspector-hidden';

function applyInspectorState(hidden) {
  workspace.classList.toggle('inspector-hidden', hidden);
  inspectorToggle.classList.toggle('is-active', !hidden);
}

// Hidden by default
applyInspectorState(localStorage.getItem(INSPECTOR_HIDDEN_KEY) !== 'false');

inspectorToggle.addEventListener('click', () => {
  const nowHidden = !workspace.classList.contains('inspector-hidden');
  applyInspectorState(nowHidden);
  localStorage.setItem(INSPECTOR_HIDDEN_KEY, nowHidden ? 'true' : 'false');
});

// --- Sidebar resizer ---

function wireSidebarResizer() {
  if (!sidebarResizer) return;

  let dragPointerId = null;

  const updateFromClientX = (clientX) => {
    const workspaceBounds = document.querySelector('.workspace')?.getBoundingClientRect();
    if (!workspaceBounds) return;
    const nextWidth = clamp(clientX - workspaceBounds.left, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    applySidebarWidth(nextWidth);
  };

  const stopDrag = () => {
    if (dragPointerId === null) return;
    persistSidebarWidth(getSidebarWidthFromStyles());
    sidebarResizer.classList.remove('is-dragging');
    try {
      sidebarResizer.releasePointerCapture(dragPointerId);
    } catch {}
    dragPointerId = null;
    document.body.style.cursor = '';
  };

  const getSidebarWidthFromStyles = () => {
    const width = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
    if (!Number.isFinite(width)) return 240;
    return clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
  };

  sidebarResizer.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 1180px)').matches) return;
    dragPointerId = event.pointerId;
    sidebarResizer.setPointerCapture(event.pointerId);
    sidebarResizer.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    updateFromClientX(event.clientX);
    event.preventDefault();
  });

  sidebarResizer.addEventListener('pointermove', (event) => {
    if (event.pointerId !== dragPointerId) return;
    updateFromClientX(event.clientX);
  });

  sidebarResizer.addEventListener('pointerup', (event) => {
    if (event.pointerId !== dragPointerId) return;
    stopDrag();
  });

  sidebarResizer.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== dragPointerId) return;
    stopDrag();
  });

  window.addEventListener('keydown', (event) => {
    if (document.activeElement !== sidebarResizer) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    const current = getSidebarWidthFromStyles();
    let next = current;
    if (event.key === 'ArrowLeft') next = current - 12;
    if (event.key === 'ArrowRight') next = current + 12;
    if (event.key === 'Home') next = SIDEBAR_MIN_WIDTH;
    if (event.key === 'End') next = SIDEBAR_MAX_WIDTH;

    next = applySidebarWidth(next);
    persistSidebarWidth(next);
    event.preventDefault();
  });
}

// --- Event listeners ---

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    const next = viewButton.dataset.view;
    if (next === 'all-files') {
      state.activeView = 'assets';
      state.activeKind = 'all';
    } else if (next === 'fonts') {
      state.activeView = 'assets';
      state.activeKind = 'font';
    } else if (next === 'images') {
      state.activeView = 'assets';
      state.activeKind = 'image';
    } else if (next === 'audio') {
      state.activeView = 'assets';
      state.activeKind = 'audio';
    } else if (next === 'videos') {
      state.activeView = 'assets';
      state.activeKind = 'video';
    } else if (next === 'scenes') {
      state.activeView = 'scenes';
      state.activeKind = 'all';
    } else if (next === 'graph') {
      state.activeView = 'graph';
      state.activeKind = 'all';
    } else {
      state.activeView = 'assets';
      state.activeKind = 'all';
    }
    if (state.activeView === 'graph') {
      void loadRuleGraph();
    }
    renderAll();
    return;
  }

  const playSoundButton = event.target.closest('[data-sound-play]');
  if (playSoundButton) {
    void playSoundScript(Number(playSoundButton.dataset.soundPlay));
    return;
  }

  const stopSoundButton = event.target.closest('[data-sound-stop]');
  if (stopSoundButton) {
    stopSoundScript(Number(stopSoundButton.dataset.soundStop));
    return;
  }

  const soundButton = event.target.closest('[data-sound-script]');
  if (soundButton) {
    cancelPendingSoundPlayback();
    state.selectedSoundScriptIndex = Number(soundButton.dataset.soundScript);
    syncAudioSidebarSelectionState();
    scheduleAudioSelectionRefresh();
    return;
  }

  const replaceButton = event.target.closest('[data-sound-replace]');
  if (replaceButton) {
    if (state.soundActionPending) return;
    const input = document.getElementById('soundReplaceInput');
    input?.click();
    return;
  }

  const sceneNodeRenameStart = event.target.closest('[data-scene-node-rename-start]');
  if (sceneNodeRenameStart) {
    const metaKey = sceneNodeRenameStart.dataset.sceneNodeRenameStart;
    state.inlineAssetEditorPath = metaKey;
    const alias = state.sceneNodeAliasByKey[metaKey] || '';
    const fallback = metaKey.split('::').pop() || metaKey;
    state.assetMetadataDraftByPath[metaKey] = { alias: alias || fallback, description: '' };
    renderAll();
    window.requestAnimationFrame(() => {
      const input = viewer.querySelector('[data-scene-node-rename-input]');
      input?.focus();
      input?.select();
    });
    return;
  }

  const sceneNodeRenameCancel = event.target.closest('[data-scene-node-rename-cancel]');
  if (sceneNodeRenameCancel) {
    const metaKey = sceneNodeRenameCancel.dataset.sceneNodeRenameCancel;
    state.assetMetadataDraftByPath[metaKey] = { alias: state.sceneNodeAliasByKey[metaKey] || '', description: '' };
    if (state.inlineAssetEditorPath === metaKey) state.inlineAssetEditorPath = null;
    renderAll();
    return;
  }

  const videoReplaceButton = event.target.closest('[data-video-replace]');
  if (videoReplaceButton) {
    if (state.videoReplacePending) return;
    const input = document.getElementById('videoReplaceInput');
    input?.click();
    return;
  }

  const imageReplaceButton = event.target.closest('[data-radium-image-replace]');
  if (imageReplaceButton) {
    if (state.imageReplacePending) return;
    const input = document.getElementById('radiumImageReplaceInput');
    input?.click();
    return;
  }

  const clearAssetMetadataButton = event.target.closest('[data-clear-asset-metadata]');
  if (clearAssetMetadataButton) {
    void saveAssetMetadata(clearAssetMetadataButton.dataset.clearAssetMetadata, {
      alias: '',
      description: '',
    });
    return;
  }

  const cancelInlineAssetEditButton = event.target.closest('[data-cancel-inline-asset-edit]');
  if (cancelInlineAssetEditButton) {
    cancelInlineAssetEdit(cancelInlineAssetEditButton.dataset.cancelInlineAssetEdit);
    return;
  }

  const cancelSidebarInlineAssetEditButton = event.target.closest('[data-cancel-sidebar-inline-asset-edit]');
  if (cancelSidebarInlineAssetEditButton) {
    cancelSidebarInlineAssetEdit(cancelSidebarInlineAssetEditButton.dataset.cancelSidebarInlineAssetEdit);
    return;
  }

  if (event.target.closest('[data-inline-asset-title-form]')) {
    return;
  }

  if (event.target.closest('[data-sidebar-inline-asset-title-form]')) {
    return;
  }

  if (event.target.closest('[data-asset-metadata-form]')) {
    return;
  }

  const assetButton = event.target.closest('[data-asset-path]');
  if (assetButton) {
    state.selectedAssetPath = assetButton.dataset.assetPath;
    state.activeView = 'assets';
    renderAll();
    return;
  }

  const sceneTreeToggle = event.target.closest('[data-scene-tree-toggle]');
  if (sceneTreeToggle) {
    const scenePath = sceneTreeToggle.dataset.sceneTreeToggle;
    if (state.expandedScenePaths[scenePath]) {
      delete state.expandedScenePaths[scenePath];
    } else {
      state.expandedScenePaths[scenePath] = true;
      if (!state.radiumScenesByPath[scenePath] && !state.radiumSceneLoadingByPath?.[scenePath]) {
        loadRadiumScene(scenePath);
      }
    }
    renderAll();
    return;
  }

  const sceneTreeNode = event.target.closest('[data-scene-tree-node]');
  if (sceneTreeNode) {
    state.selectedSceneNodeId = sceneTreeNode.dataset.sceneTreeNode;
    state.selectedSceneNodeScenePath = sceneTreeNode.dataset.sceneTreeNodeScene;
    renderAll();
    return;
  }

  const backToSceneBtn = event.target.closest('[data-back-to-scene]');
  if (backToSceneBtn) {
    state.selectedSceneNodeId = null;
    state.selectedSceneNodeScenePath = null;
    renderAll();
    return;
  }

  const sceneButton = event.target.closest('[data-scene-asset]');
  if (sceneButton) {
    state.selectedAssetPath = sceneButton.dataset.sceneAsset;
    state.selectedSceneNodeId = null;
    state.selectedSceneNodeScenePath = null;
    renderAll();
    return;
  }

  const graphFamilyToggle = event.target.closest('[data-graph-family-toggle]');
  if (graphFamilyToggle) {
    const fid = graphFamilyToggle.dataset.graphFamilyToggle;
    if (state.expandedGraphFamilies[fid]) {
      delete state.expandedGraphFamilies[fid];
    } else {
      state.expandedGraphFamilies[fid] = true;
    }
    renderAll();
    return;
  }

  const graphScrollToFamily = event.target.closest('[data-graph-scroll-to-family]');
  if (graphScrollToFamily) {
    const fid = graphScrollToFamily.dataset.graphScrollToFamily;
    state.expandedGraphFamilies[fid] = true;
    renderAll();
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`graph-family-${fid}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }

  const graphNodeButton = event.target.closest('[data-graph-node-id]');
  if (graphNodeButton) {
    state.selectedGraphNodeId = graphNodeButton.dataset.graphNodeId;
    renderAll();
    return;
  }

  const openSceneButton = event.target.closest('[data-graph-open-scene]');
  if (openSceneButton) {
    const sceneNode = getGraphNodeById(openSceneButton.dataset.graphOpenScene);
    const scenePath = getGraphSceneAssetPath(sceneNode);
    if (scenePath) {
      state.selectedAssetPath = scenePath;
      state.activeView = 'scenes';
      state.activeKind = 'all';
      renderAll();
    }
    return;
  }

  const openAudioButton = event.target.closest('[data-graph-open-audio]');
  if (openAudioButton) {
    state.selectedSoundScriptIndex = Number(openAudioButton.dataset.graphOpenAudio);
    state.activeView = 'assets';
    state.activeKind = 'audio';
    syncAudioSidebarSelectionState();
    scheduleAudioSelectionRefresh();
  }
});

document.addEventListener('dblclick', (event) => {
  const titleTrigger = event.target.closest('.preview-title-row[data-edit-asset-metadata]');
  if (titleTrigger) {
    startInlineAssetEdit(titleTrigger.dataset.editAssetMetadata);
    return;
  }

  const sidebarRowTrigger = event.target.closest('[data-edit-sidebar-asset-path]');
  if (sidebarRowTrigger) {
    startSidebarInlineAssetEdit(sidebarRowTrigger.dataset.editSidebarAssetPath);
  }
});

document.addEventListener('click', (event) => {
  const editAssetMetadataButton = event.target.closest('[data-edit-asset-metadata].asset-edit-button');
  if (!editAssetMetadataButton) return;
  startInlineAssetEdit(editAssetMetadataButton.dataset.editAssetMetadata);
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-scene-viewable-only]')) {
    viewableOnly.checked = event.target.checked;
    ensureSelectedAsset();
    renderAll();
    return;
  }

  if (event.target.matches('[data-scene-type-filter]')) {
    sceneTypeFilter.value = event.target.value;
    ensureSelectedAsset();
    renderAll();
    return;
  }

  if (event.target.id === 'videoReplaceInput') {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    await replaceSelectedVideo(file);
    return;
  }

  if (event.target.id === 'radiumImageReplaceInput') {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    const scenePath = state.selectedSceneNodeScenePath;
    const imageId = state.selectedSceneNodeId;
    await handleRadiumImageReplace(file, scenePath, imageId);
    return;
  }

  if (event.target.id !== 'soundReplaceInput') return;
  const [file] = event.target.files || [];
  event.target.value = '';
  if (!file) return;
  await replaceSelectedSound(file);
});

document.addEventListener('submit', async (event) => {
  const sceneNodeRenameForm = event.target.closest('[data-scene-node-rename-form]');
  if (sceneNodeRenameForm) {
    event.preventDefault();
    const metaKey = sceneNodeRenameForm.dataset.sceneNodeRenamePath || '';
    const inputVal = sceneNodeRenameForm.querySelector('[data-scene-node-rename-input]')?.value || '';
    const originalLabel = metaKey.split('::').pop() || '';
    const alias = inputVal.trim() === originalLabel ? '' : inputVal.trim();
    await saveAssetMetadata(metaKey, { alias, description: '' });
    return;
  }

  const inlineTitleForm = event.target.closest('[data-inline-asset-title-form]');
  if (inlineTitleForm) {
    event.preventDefault();
    const assetPath = inlineTitleForm.dataset.inlineAssetPath || '';
    await saveAssetMetadata(assetPath, {
      alias: normalizeAssetAliasInput(
        assetPath,
        inlineTitleForm.querySelector('[data-inline-asset-alias-input]')?.value || '',
        getMetadataDefaultName(assetPath),
      ),
      description: getMetadataDescription(assetPath),
    });
    return;
  }

  const sidebarInlineTitleForm = event.target.closest('[data-sidebar-inline-asset-title-form]');
  if (sidebarInlineTitleForm) {
    event.preventDefault();
    const assetPath = sidebarInlineTitleForm.dataset.sidebarInlineAssetPath || '';
    await saveAssetMetadata(assetPath, {
      alias: normalizeAssetAliasInput(
        assetPath,
        sidebarInlineTitleForm.querySelector('[data-sidebar-inline-asset-alias-input]')?.value || '',
        getMetadataDefaultName(assetPath),
      ),
      description: getMetadataDescription(assetPath),
    });
    return;
  }

  const form = event.target.closest('[data-asset-metadata-form]');
  if (!form) return;

  event.preventDefault();
  const assetPath = form.dataset.metadataAssetPath || '';
  await saveAssetMetadata(assetPath, {
    alias: normalizeAssetAliasInput(
      assetPath,
      form.querySelector('[data-asset-alias-input]')?.value || '',
      getMetadataDefaultName(assetPath),
    ),
    description: form.querySelector('[data-asset-description-input]')?.value || '',
  });
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-scene-node-rename-input]')) {
    const form = event.target.closest('[data-scene-node-rename-form]');
    const metaKey = form?.dataset.sceneNodeRenamePath;
    if (!metaKey) return;
    state.assetMetadataDraftByPath[metaKey] = { alias: event.target.value, description: '' };
    return;
  }

  if (event.target.matches('[data-inline-asset-alias-input]')) {
    const form = event.target.closest('[data-inline-asset-title-form]');
    const assetPath = form?.dataset.inlineAssetPath;
    if (!assetPath) return;

    state.assetMetadataDraftByPath[assetPath] = {
      alias: event.target.value,
      description: getMetadataDescription(assetPath),
    };
    return;
  }

  if (event.target.matches('[data-sidebar-inline-asset-alias-input]')) {
    const form = event.target.closest('[data-sidebar-inline-asset-title-form]');
    const assetPath = form?.dataset.sidebarInlineAssetPath;
    if (!assetPath) return;

    state.assetMetadataDraftByPath[assetPath] = {
      alias: event.target.value,
      description: getMetadataDescription(assetPath),
    };
    return;
  }

  if (event.target.matches('[data-asset-alias-input], [data-asset-description-input]')) {
    const form = event.target.closest('[data-asset-metadata-form]');
    const assetPath = form?.dataset.metadataAssetPath;
    if (!assetPath) return;

    state.assetMetadataDraftByPath[assetPath] = {
      alias: form.querySelector('[data-asset-alias-input]')?.value || '',
      description: form.querySelector('[data-asset-description-input]')?.value || '',
    };
    return;
  }

  if (!event.target.matches('[data-scene-search]')) return;
  assetSearch.value = event.target.value;
  ensureSelectedAsset();
  renderAll();
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('[data-scene-node-rename-input]')) {
    const form = event.target.closest('[data-scene-node-rename-form]');
    const metaKey = form?.dataset.sceneNodeRenamePath;
    if (!metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      state.assetMetadataDraftByPath[metaKey] = { alias: state.sceneNodeAliasByKey[metaKey] || '', description: '' };
      if (state.inlineAssetEditorPath === metaKey) state.inlineAssetEditorPath = null;
      renderAll();
    }
    return;
  }

  if (event.target.matches('[data-inline-asset-alias-input]')) {
    const form = event.target.closest('[data-inline-asset-title-form]');
    const assetPath = form?.dataset.inlineAssetPath;
    if (!assetPath) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelInlineAssetEdit(assetPath);
    }
    return;
  }

  if (!event.target.matches('[data-sidebar-inline-asset-alias-input]')) return;

  const form = event.target.closest('[data-sidebar-inline-asset-title-form]');
  const assetPath = form?.dataset.sidebarInlineAssetPath;
  if (!assetPath) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    form.requestSubmit();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    cancelSidebarInlineAssetEdit(assetPath);
  }
});


assetSearch.addEventListener('input', () => {
  if (isRuleGraphView()) {
    ensureSelectedGraphNode();
  } else {
    ensureSelectedAsset();
  }
  renderAll();
});

viewableOnly.addEventListener('change', () => {
  ensureSelectedAsset();
  renderAll();
});

sceneTypeFilter.addEventListener('change', () => {
  ensureSelectedAsset();
  renderAll();
});


// --- Initialization ---

const LAST_TARGET_KEY = 'pinball-explorer.last-target';

async function init() {
  initSound();
  initCropModal();
  applySidebarWidth(getSidebarWidth());
  wireSidebarResizer();

  // Determine which image to load: server default, then localStorage fallback.
  const res = await fetch('/api/default-target');
  const data = await res.json();
  targetInput.value = data.defaultTarget || localStorage.getItem(LAST_TARGET_KEY) || '';
  if (targetInput.value) {
    await inspectTargetPath(targetInput.value);
    return;
  }
  renderAll();
}

init();
