// ---------------------------------------------------------------------------
// Rule graph subsystem — data helpers, async loading, and rendering.
// ---------------------------------------------------------------------------

import {
  state,
  targetInput,
  assetSearch,
  assetList,
  assetListHeading,
  scheduleRenderAll,
  inspectionGeneration,
} from './state.js';

import {
  escapeHtml,
  formatNumber,
  formatDurationMs,
  getSoundChannelLabel,
} from './utils.js';

import {
  getSoundScripts,
  getSoundScriptDisplayName,
  getSoundScriptBaseLabel,
} from './data-accessors.js';

export function normalizeGraphToken(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '');
}

export function getRuleGraph() {
  return state.ruleGraph?.graph || null;
}

export function getRuleGraphNodes() {
  return getRuleGraph()?.nodes || [];
}

export function getRuleGraphEdges() {
  return getRuleGraph()?.edges || [];
}

export function getGraphNodeById(nodeId = state.selectedGraphNodeId) {
  return getRuleGraphNodes().find((node) => node.id === nodeId) || null;
}

export function getGraphNodeFamilyKey(node) {
  return node?.familyKey || normalizeGraphToken(node?.label || '');
}

export function getGraphSceneAssetPath(node) {
  if (!node || node.type !== 'scene') return null;
  return node.scenePath || null;
}

export function getGraphLinkedNodes(node, edgeType, direction = 'outgoing') {
  if (!node) return [];

  const matchingEdges = getRuleGraphEdges().filter((edge) => {
    if (edge.type !== edgeType) return false;
    return direction === 'incoming' ? edge.target === node.id : edge.source === node.id;
  });

  return matchingEdges
    .map((edge) => getGraphNodeById(direction === 'incoming' ? edge.source : edge.target))
    .filter(Boolean);
}

export function getGraphContext(node = getGraphNodeById()) {
  if (!node) {
    return { node: null, moduleNode: null, familyNode: null, sceneNodes: [] };
  }

  if (node.type === 'rule_module') {
    const familyNode = getGraphLinkedNodes(node, 'contains')[0] || null;
    return {
      node,
      moduleNode: node,
      familyNode,
      sceneNodes: familyNode ? getGraphLinkedNodes(familyNode, 'triggers_scene') : [],
    };
  }

  if (node.type === 'event_family') {
    return {
      node,
      moduleNode: getGraphLinkedNodes(node, 'contains', 'incoming')[0] || null,
      familyNode: node,
      sceneNodes: getGraphLinkedNodes(node, 'triggers_scene'),
    };
  }

  if (node.type === 'scene') {
    const familyNode = getGraphLinkedNodes(node, 'triggers_scene', 'incoming')[0] || null;
    return {
      node,
      moduleNode: familyNode ? getGraphLinkedNodes(familyNode, 'contains', 'incoming')[0] || null : null,
      familyNode,
      sceneNodes: familyNode ? getGraphLinkedNodes(familyNode, 'triggers_scene') : [node],
    };
  }

  return { node, moduleNode: null, familyNode: null, sceneNodes: [] };
}

export function getGraphAudioCandidates(node = getGraphNodeById()) {
  const familyKey = getGraphNodeFamilyKey(node)
    || getGraphNodeFamilyKey(getGraphContext(node).familyNode);

  if (!familyKey) return [];

  return getSoundScripts().filter((script) => {
    const labelKeys = [
      normalizeGraphToken(getSoundScriptDisplayName(script)),
      normalizeGraphToken(getSoundScriptBaseLabel(script)),
    ].filter(Boolean);
    return labelKeys.some((labelKey) => labelKey.includes(familyKey) || familyKey.includes(labelKey));
  });
}

export function getGraphSearchMatches() {
  const query = assetSearch.value.trim().toLowerCase();
  const nodes = getRuleGraphNodes();
  if (!query) return nodes;

  return nodes.filter((node) => {
    const haystack = [
      node.id,
      node.type,
      node.label,
      node.sceneName,
      node.assetRef,
      node.scenePath,
      node.moduleName,
      node.familyName,
      node.loadDomain,
    ].filter(Boolean).join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

export function ensureSelectedGraphNode(nodes) {
  const graph = getRuleGraph();
  if (!graph?.nodes?.length) {
    state.selectedGraphNodeId = null;
    return;
  }

  if (state.selectedGraphNodeId && graph.nodes.some((node) => node.id === state.selectedGraphNodeId)) {
    return;
  }

  const searchMatches = nodes ?? getGraphSearchMatches();
  const preferred = searchMatches.find((node) => node.type === 'rule_module')
    || searchMatches.find((node) => node.type === 'event_family')
    || searchMatches[0]
    || graph.nodes[0];
  state.selectedGraphNodeId = preferred?.id || null;
}

// --- Event family catalog ---

function getGraphLinkedSoundNodes(familyNode) {
  return getGraphLinkedNodes(familyNode, 'triggers_audio');
}

function hasGraphSoundNodes() {
  return getRuleGraphNodes().some((n) => n.type === 'sound');
}

export function getEventFamilyCatalog() {
  const families = getRuleGraphNodes().filter((n) => n.type === 'event_family');
  const useSoundNodes = hasGraphSoundNodes();
  return families
    .map((familyNode) => ({
      familyNode,
      sceneNodes: getGraphLinkedNodes(familyNode, 'triggers_scene'),
      moduleNodes: getGraphLinkedNodes(familyNode, 'contains', 'incoming'),
      soundNodes: useSoundNodes ? getGraphLinkedSoundNodes(familyNode) : [],
      audioCandidates: useSoundNodes ? [] : getGraphAudioCandidates(familyNode),
    }))
    .sort((a, b) => (a.familyNode.label || '').localeCompare(b.familyNode.label || ''));
}

export function getFilteredFamilyCatalog() {
  const query = assetSearch.value.trim().toLowerCase();
  const catalog = getEventFamilyCatalog();
  if (!query) return catalog;

  return catalog.filter((entry) => {
    const parts = [
      entry.familyNode.label,
      entry.familyNode.familyName,
      ...entry.sceneNodes.map((n) => n.sceneName || n.label),
      ...entry.soundNodes.map((n) => n.label),
      ...entry.audioCandidates.map((s) => getSoundScriptDisplayName(s)),
      ...entry.audioCandidates.map((s) => getSoundScriptBaseLabel(s)),
      ...entry.moduleNodes.map((n) => n.label || n.moduleName),
    ].filter(Boolean).join('\n').toLowerCase();
    return parts.includes(query);
  });
}

// --- Scene name map ---

function buildGraphSceneNameMap() {
  const map = {};
  for (const node of getRuleGraphNodes()) {
    if (node.type === 'scene' && node.scenePath && node.sceneName) {
      map[node.scenePath] = node.sceneName;
    }
  }
  state.graphSceneNameByPath = map;
}

// --- Async loading ---

export async function loadRuleGraph({ refresh = false } = {}) {
  if (!state.currentData) return;
  if (state.ruleGraphLoading && !refresh) return;
  if (state.ruleGraph && !refresh) return;

  const sessionId = inspectionGeneration;
  state.ruleGraphLoading = true;
  state.ruleGraphError = '';
  scheduleRenderAll();

  try {
    const res = await fetch(`/api/rule-graph?path=${encodeURIComponent(targetInput.value.trim())}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Rule graph extraction failed');
    }
    if (sessionId !== inspectionGeneration) return;
    state.ruleGraph = data;
    buildGraphSceneNameMap();
    ensureSelectedGraphNode();
  } catch (error) {
    if (sessionId !== inspectionGeneration) return;
    state.ruleGraph = null;
    state.selectedGraphNodeId = null;
    state.graphSceneNameByPath = {};
    state.ruleGraphError = error.message;
  } finally {
    if (sessionId !== inspectionGeneration) return;
    state.ruleGraphLoading = false;
    scheduleRenderAll();
  }
}

// --- Rendering ---

export function renderGraphSidebar() {
  const catalog = getFilteredFamilyCatalog();

  if (assetListHeading) {
    assetListHeading.textContent = 'Event families';
  }

  if (state.ruleGraphLoading) {
    assetList.innerHTML = '<p class="muted">Building rule graph from the raw image...</p>';
    return;
  }

  if (state.ruleGraphError) {
    assetList.innerHTML = `<div class="error-state"><strong>Rule graph failed</strong><p>${escapeHtml(state.ruleGraphError)}</p></div>`;
    return;
  }

  if (!catalog.length) {
    assetList.innerHTML = '<p class="muted">No event families matched the current search.</p>';
    return;
  }

  assetList.innerHTML = catalog.map((entry) => {
    const label = entry.familyNode.label || entry.familyNode.id;
    const soundCount = entry.soundNodes.length || entry.audioCandidates.length;
    const sceneBadge = entry.sceneNodes.length ? `${entry.sceneNodes.length}s` : '';
    const audioBadge = soundCount ? `${soundCount}a` : '';
    return `
      <button class="asset-row" type="button" data-graph-scroll-to-family="${escapeHtml(entry.familyNode.id)}">
        <div class="asset-row-top">
          <span class="asset-title">${escapeHtml(label)}</span>
          <span class="badge kind-badge">${escapeHtml([sceneBadge, audioBadge].filter(Boolean).join(' '))}</span>
        </div>
      </button>
    `;
  }).join('');
}

export function renderRuleGraphView() {
  if (state.ruleGraphLoading) {
    return '<div class="empty-state"><p class="muted">Extracting the rule graph from the mounted raw image...</p></div>';
  }

  if (state.ruleGraphError) {
    return `<div class="error-state"><strong>Rule graph failed</strong><p>${escapeHtml(state.ruleGraphError)}</p></div>`;
  }

  const graph = getRuleGraph();
  if (!graph) {
    return '<div class="empty-state"><p class="muted">Open the Rule Graph tab to build the structured rule export.</p></div>';
  }

  const catalog = getFilteredFamilyCatalog();
  const counts = graph.counts || {};
  const totalFamilies = counts.eventFamilies || 0;
  const totalScenes = counts.scenes || 0;
  const totalModules = counts.ruleModules || 0;
  const totalSounds = counts.sounds || 0;
  const orphanScenes = counts.orphanScenes || 0;

  const statsHtml = `
    <div class="graph-summary-stats">
      <span class="graph-stat-pill">${formatNumber(totalFamilies)} families</span>
      <span class="graph-stat-pill">${formatNumber(totalScenes)} scenes${orphanScenes ? ` (${formatNumber(counts.namedScenes || 0)} named)` : ''}</span>
      <span class="graph-stat-pill">${formatNumber(totalSounds)} sounds</span>
      <span class="graph-stat-pill">${formatNumber(totalModules)} rule modules</span>
      <a class="graph-stat-pill graph-stat-link" href="/api/rule-graph?path=${encodeURIComponent(targetInput.value.trim())}" target="_blank" rel="noreferrer">Open JSON</a>
    </div>
  `;

  const cardsHtml = catalog.map((entry) => {
    const fid = entry.familyNode.id;
    const label = entry.familyNode.label || fid;
    const isExpanded = !!state.expandedGraphFamilies[fid];
    const chevron = isExpanded ? '\u25BC' : '\u25B6';

    const soundCount = entry.soundNodes.length || entry.audioCandidates.length;
    const sceneBadge = `${entry.sceneNodes.length} scene${entry.sceneNodes.length !== 1 ? 's' : ''}`;
    const audioBadge = `${soundCount} sound${soundCount !== 1 ? 's' : ''}`;
    const moduleBadge = `${entry.moduleNodes.length} module${entry.moduleNodes.length !== 1 ? 's' : ''}`;

    let bodyHtml = '';
    if (isExpanded) {
      const scenesSection = entry.sceneNodes.length ? `
        <div class="graph-family-section">
          <h4>Scenes</h4>
          ${entry.sceneNodes.map((sceneNode) => `
            <button class="graph-family-row" type="button" data-graph-open-scene="${escapeHtml(sceneNode.id)}">
              <span class="asset-title">${escapeHtml(sceneNode.sceneName || sceneNode.label)}</span>
              <span class="badge kind-badge">${escapeHtml(sceneNode.loadDomain || 'scene')}</span>
              ${sceneNode.inferred ? '<span class="badge kind-badge">inferred</span>' : ''}
            </button>
          `).join('')}
        </div>
      ` : '';

      let audioSection = '';
      if (entry.soundNodes.length) {
        audioSection = `
          <div class="graph-family-section">
            <h4>Sounds</h4>
            ${entry.soundNodes.map((snd) => `
              <button class="graph-family-row" type="button" data-graph-open-audio="${escapeHtml(snd.scriptIndex)}">
                <span class="asset-title">${escapeHtml(snd.label)}</span>
                <span class="badge kind-badge">${escapeHtml([
                  `#${snd.scriptIndex}`,
                  formatDurationMs(snd.durationMs),
                  snd.codec ? `codec ${snd.codec}` : '',
                ].filter(Boolean).join(' | '))}</span>
              </button>
            `).join('')}
          </div>
        `;
      } else if (entry.audioCandidates.length) {
        audioSection = `
          <div class="graph-family-section">
            <h4>Sounds</h4>
            ${entry.audioCandidates.map((script) => `
              <button class="graph-family-row" type="button" data-graph-open-audio="${escapeHtml(script.scriptIndex)}">
                <span class="asset-title">${escapeHtml(getSoundScriptDisplayName(script))}</span>
                <span class="badge kind-badge">${escapeHtml([
                  getSoundScriptBaseLabel(script),
                  formatDurationMs(script.durationMs),
                  `codec ${script.codec}`,
                ].filter(Boolean).join(' | '))}</span>
              </button>
            `).join('')}
          </div>
        `;
      }

      const modulesSection = entry.moduleNodes.length ? `
        <div class="graph-family-section">
          <h4>Rule modules</h4>
          <div class="graph-module-tags">
            ${entry.moduleNodes.map((m) => `<span class="graph-module-tag">${escapeHtml(m.label || m.moduleName || m.id)}</span>`).join('')}
          </div>
        </div>
      ` : '';

      bodyHtml = `
        <div class="graph-family-body">
          ${scenesSection}
          ${audioSection}
          ${modulesSection}
        </div>
      `;
    }

    return `
      <div class="graph-family-card" id="graph-family-${escapeHtml(fid)}">
        <button class="graph-family-header" type="button" data-graph-family-toggle="${escapeHtml(fid)}">
          <span class="graph-family-label">${escapeHtml(label)}</span>
          <span class="graph-family-counts">${escapeHtml(sceneBadge)} | ${escapeHtml(audioBadge)} | ${escapeHtml(moduleBadge)}</span>
          <span class="graph-family-chevron">${chevron}</span>
        </button>
        ${bodyHtml}
      </div>
    `;
  }).join('');

  return `
    <div class="viewer-stack graph-view">
      ${statsHtml}
      <div class="graph-family-list">
        ${cardsHtml || '<p class="muted">No event families matched the current search.</p>'}
      </div>
    </div>
  `;
}
