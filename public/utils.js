// ---------------------------------------------------------------------------
// Pure utility functions — no state reads, no side effects.
// ---------------------------------------------------------------------------

import {
  sidebarResizer,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SCENE_NODE_KEY_PREFIX,
} from './state.js';

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getSidebarWidth() {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const width = Number(raw);
  if (!Number.isFinite(width)) return 240;
  return clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
}

export function applySidebarWidth(width) {
  const next = clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
  document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
  sidebarResizer?.setAttribute('aria-valuenow', String(next));
  sidebarResizer?.setAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH));
  sidebarResizer?.setAttribute('aria-valuemax', String(SIDEBAR_MAX_WIDTH));
  return next;
}

export function persistSidebarWidth(width) {
  window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatNumber(value) {
  if (value === null || value === undefined) return 'n/a';
  return new Intl.NumberFormat().format(value);
}

export function formatHex(value) {
  if (value === null || value === undefined) return 'n/a';
  return `0x${value.toString(16)}`;
}

export function pathBasename(filePath) {
  const parts = String(filePath || '').split('/');
  return parts[parts.length - 1] || filePath;
}

export function getAssetPathValue(assetOrPath) {
  if (assetOrPath && typeof assetOrPath === 'object') {
    return assetOrPath.path || assetOrPath.assetPath || '';
  }
  return String(assetOrPath || '');
}

export function normalizeAssetAliasInput(assetPath, value, fallbackLabel = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const defaultLabel = String(fallbackLabel || pathBasename(assetPath));
  return trimmed === defaultLabel ? '' : trimmed;
}

export function shortBackendName(value) {
  const raw = String(value || '');
  if (!raw) return 'unknown';
  const parts = raw.split('.');
  return parts[parts.length - 1] || raw;
}

export function renderKeyValue(items) {
  if (!items.length) return '<p class="muted">No metadata available.</p>';
  return `<dl class="kv">${items.map(([key, value]) => `
    <dt>${escapeHtml(key)}</dt>
    <dd>${value}</dd>
  `).join('')}</dl>`;
}

export function renderList(values, className = 'string-list') {
  if (!values?.length) return '<p class="muted">None</p>';
  return `<ul class="${className}">${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
}

export function renderRowActionIcon(kind) {
  if (kind === 'spinner') {
    return '<span class="row-action-spinner" aria-hidden="true"></span>';
  }
  if (kind === 'play') {
    return `
      <svg class="row-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M5 3.5v9l7-4.5z" fill="currentColor"></path>
      </svg>
    `;
  }
  return `
    <svg class="row-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="8" height="8" fill="currentColor"></rect>
    </svg>
  `;
}

export function formatDurationMs(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) return 'n/a';
  if (duration < 1000) return `${duration} ms`;
  return `${(duration / 1000).toFixed(3)} s`;
}

export function getSoundChannelLabel(script) {
  if (!script) return 'n/a';
  if (script.channelCount === 2) return 'Stereo';
  if (script.channelCount === 1) return 'Mono';
  if (script.channelCount > 2) return `${script.channelCount} channels`;
  return 'Silent';
}

export function sceneNodeMetadataKey(scenePath, nodeId) {
  return `${SCENE_NODE_KEY_PREFIX}${scenePath}::${nodeId}`;
}
