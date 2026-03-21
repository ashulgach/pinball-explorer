// ---------------------------------------------------------------------------
// Shared application state, DOM references, constants, and render callbacks.
// This is the leaf module — no imports from other app modules.
// ---------------------------------------------------------------------------

// --- DOM element references ---
export const targetInput = document.getElementById('targetPath');
export const assetSearch = document.getElementById('assetSearch');
export const assetSearchLabel = document.querySelector('label[for="assetSearch"]');
export const viewableOnly = document.getElementById('viewableOnly');
export const viewableOnlyRow = viewableOnly?.closest('.control-row');
export const sceneTypeFilterLabel = document.querySelector('label[for="sceneTypeFilter"]');
export const sceneTypeFilter = document.getElementById('sceneTypeFilter');
export const targetSummary = document.getElementById('targetSummary');
export const assetList = document.getElementById('assetList');
export const assetListHeading = document.getElementById('assetListHeading');

export const loadOverlay = document.getElementById('loadOverlay');
export const loadOverlayButton = document.getElementById('loadOverlayButton');
export const topbarFileLabel = document.getElementById('topbarFileLabel');
export const topbarLoadNew = document.getElementById('topbarLoadNew');
export const sidebarResizer = document.getElementById('sidebarResizer');
export const viewer = document.getElementById('viewer');
export const viewerSelectionName = document.getElementById('viewerSelectionName');

export const selectionInspector = document.getElementById('selectionInspector');
export const packageInspector = document.getElementById('packageInspector');
export const manifestInspector = document.getElementById('manifestInspector');
export const sidebarFilters = document.getElementById('sidebarFilters');
export const statusbar = document.getElementById('statusbar');
export const tabCountFonts = document.getElementById('tabCountFonts');
export const tabCountImages = document.getElementById('tabCountImages');
export const tabCountScenes = document.getElementById('tabCountScenes');
export const tabCountAudio = document.getElementById('tabCountAudio');
export const tabCountVideos = document.getElementById('tabCountVideos');
export const tabCountGraph = document.getElementById('tabCountGraph');

// --- Core application state ---
export const state = {
  currentData: null,
  selectedAssetPath: null,
  selectedSoundScriptIndex: null,
  playingSoundScriptIndex: null,
  activeView: 'assets',
  activeKind: 'all',
  loading: false,
  error: '',
  ruleGraph: null,
  ruleGraphLoading: false,
  ruleGraphError: '',
  selectedGraphNodeId: null,
  expandedGraphFamilies: {},
  graphSceneNameByPath: {},
  sceneDetailsByPath: {},
  sceneLoadingByPath: {},
  previewLoadingByKey: {},
  previewLoadedByKey: {},
  soundPreviewLoadingByScript: {},
  soundPreviewPreparedByScript: {},
  soundPreviewRevisionByScript: {},
  soundActionPending: false,
  soundActionError: '',
  assetMetadataDraftByPath: {},
  assetMetadataPendingPath: null,
  assetMetadataSavedPath: null,
  assetMetadataErrorPath: null,
  assetMetadataError: '',
  inlineAssetEditorPath: null,
  sidebarInlineAssetEditorPath: null,
  radiumScenesByPath: {},
  radiumSceneLoadingByPath: {},
  expandedScenePaths: {},
  selectedSceneNodeId: null,
  selectedSceneNodeScenePath: null,
  sceneNodeAliasByKey: {},
  imageReplacePending: false,
  imageReplaceError: '',
  imageReplaceSuccess: null,
  videoReplacePending: false,
  videoReplaceError: '',
  videoReplaceAssetPath: null,
};

// --- Constants ---
export const SIDEBAR_WIDTH_STORAGE_KEY = 'pinball-explorer.sidebar-width';
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
export const SCENE_NODE_KEY_PREFIX = 'radium-node::';
export const SOUND_SCRIPT_KEY_PREFIX = 'sound-script::';
export const RADIUM_CLIENT_SCENE_CACHE_MAX = 5;

// --- Mutable scalars wrapped in objects for cross-module access ---
export const timers = {
  activeAnimationTimer: null,
  previewTransitionTimer: null,
  renderAllTimer: null,
  renderAudioSelectionTimer: null,
};

export const players = {
  soundRowPlayer: new Audio(),
  soundRowPlayerScriptIndex: null,
  activeRadiumPlayer: null,
};

players.soundRowPlayer.preload = 'none';

export let soundPlaybackRequestId = 0;
export function bumpSoundPlaybackRequestId() {
  soundPlaybackRequestId += 1;
  return soundPlaybackRequestId;
}

export let inspectionGeneration = 0;
export function bumpInspectionGeneration() {
  inspectionGeneration += 1;
  return inspectionGeneration;
}

export const soundPreviewPrepareInflight = new Map();

// --- Render callback registry ---
// Modules that need to trigger a full re-render call scheduleRenderAll()
// instead of importing renderAll directly, breaking the circular dependency.
let _renderAll = () => {};
let _refreshAudioSelectionPanels = () => false;

export function setRenderAll(fn) {
  _renderAll = fn;
}

export function setRefreshAudioSelectionPanels(fn) {
  _refreshAudioSelectionPanels = fn;
}

export function scheduleRenderAll() {
  if (timers.renderAllTimer !== null) return;
  timers.renderAllTimer = window.setTimeout(() => {
    timers.renderAllTimer = null;
    _renderAll();
  }, 0);
}

export function scheduleAudioSelectionRefresh() {
  if (timers.renderAudioSelectionTimer !== null) return;
  timers.renderAudioSelectionTimer = window.setTimeout(() => {
    timers.renderAudioSelectionTimer = null;
    if (!_refreshAudioSelectionPanels()) {
      _renderAll();
    }
  }, 0);
}
