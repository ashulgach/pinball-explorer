import path from 'node:path';

import imageFs from 'balena-image-fs';
import partitioninfo from 'partitioninfo';

const { interact } = imageFs;

const PRINTABLE_ASCII_MIN = 0x20;
const PRINTABLE_ASCII_MAX = 0x7e;
const HASH_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATH_PATTERN = /^[0-9a-f]{40}\/[0-9a-f]{40}$/;
const RULE_MODULE_PATTERN = /^\d+c[a-z0-9_]+$/;

const REJECT_NAME_PATTERNS = [
  /^Text\./,
  /^SpecialAttack_Textbox\./,
  /^MusicCredits\./,
  /^GameOver\./,
  /^Logo$/,
  /^CURRENT PLAYLIST$/,
  /^EFFECT VIEWER$/,
  /^CENTER BUTTON TO PLAY\/STOP$/,
  /^HostSelection_Instance\..+/,
  /^BellTowerFrenzy_instance\..+/,
  /^.+_Instance\..+$/,
  /^.+_instance\..+$/,
  /^.+Outline(?:_Instance)?$/,
  /^.+dropshadow.+$/,
  /^[A-Za-z]+DisplayElement$/,
  /^BackgroundDisplayLayers$/,
  /^LayeredDisplayElement$/,
  /^\d+[A-Za-z_].*$/,
  /^.+_scene_loader$/,
  /^vector::/,
  /^std::/,
  /^\.\.\/source\//,
];

// Minimum normalized key length for substring module matching.
// Prevents false positives from very short keys like "tilt" matching "multitilt".
const MIN_SUBSTRING_MATCH_LENGTH = 6;

function isPrintableAsciiByte(byte) {
  return byte >= PRINTABLE_ASCII_MIN && byte <= PRINTABLE_ASCII_MAX;
}

export function extractPrintableStrings(buffer, minLength = 4) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const strings = [];
  let start = -1;

  for (let index = 0; index < source.length; index += 1) {
    if (isPrintableAsciiByte(source[index])) {
      if (start < 0) start = index;
      continue;
    }

    if (start >= 0 && (index - start) >= minLength) {
      strings.push({
        offset: start,
        value: source.subarray(start, index).toString('ascii'),
      });
    }
    start = -1;
  }

  if (start >= 0 && (source.length - start) >= minLength) {
    strings.push({
      offset: start,
      value: source.subarray(start).toString('ascii'),
    });
  }

  return strings;
}

function isLikelySymbolicName(value) {
  if (!value || value.length < 4) return false;
  if (HASH_PATTERN.test(value) || HASH_PATH_PATTERN.test(value)) return false;
  if (value.includes('/') || value.includes('\\')) return false;

  for (const pattern of REJECT_NAME_PATTERNS) {
    if (pattern.test(value)) return false;
  }

  return /[A-Za-z]/.test(value);
}

export function extractNamedAssetReferences(strings) {
  const mappings = new Map();

  for (let index = 0; index < strings.length; index += 1) {
    const current = strings[index];
    const assetRef = current?.value;
    if (!HASH_PATTERN.test(assetRef) && !HASH_PATH_PATTERN.test(assetRef)) continue;
    const maxNeighborDistance = HASH_PATH_PATTERN.test(assetRef) ? 1 : 4;

    for (const direction of [-1, 1]) {
      for (let distance = 1; distance <= maxNeighborDistance; distance += 1) {
        const neighbor = strings[index + (direction * distance)];
        if (!neighbor) break;
        if (HASH_PATTERN.test(neighbor.value) || HASH_PATH_PATTERN.test(neighbor.value)) break;
        if (!isLikelySymbolicName(neighbor.value)) continue;

        const key = `${neighbor.value}\t${assetRef}`;
        if (!mappings.has(key)) {
          mappings.set(key, {
            name: neighbor.value,
            assetRef,
            offset: current.offset,
          });
        }
        break;
      }
    }
  }

  return [...mappings.values()];
}

export function normalizeGraphToken(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '');
}

function deriveEventFamilyName(sceneName) {
  const raw = String(sceneName || '');
  if (!raw) return '';

  const firstSeparator = raw.indexOf('_');
  if (firstSeparator < 0) return raw;
  return raw.slice(0, firstSeparator) || raw;
}

function deriveRuleModuleCore(rawName) {
  return String(rawName || '').replace(/^\d+c/, '');
}

export function extractRuleModuleNames(strings) {
  const modules = new Map();

  for (const entry of strings) {
    const rawName = entry?.value;
    if (!RULE_MODULE_PATTERN.test(rawName)) continue;

    const moduleCore = deriveRuleModuleCore(rawName);
    if (moduleCore.length < 5) continue;
    const familyKey = normalizeGraphToken(moduleCore);
    if (!familyKey) continue;

    if (!modules.has(rawName)) {
      modules.set(rawName, {
        rawName,
        moduleCore,
        familyKey,
        offset: entry.offset,
      });
    }
  }

  return [...modules.values()];
}

function createGraphNode(type, key, data) {
  return {
    id: `${type}:${key}`,
    type,
    ...data,
  };
}

function createGraphEdge(type, source, target, data = {}) {
  return {
    id: `${type}:${source}->${target}`,
    type,
    source,
    target,
    ...data,
  };
}

function splitAssetRef(assetRef) {
  if (HASH_PATH_PATTERN.test(assetRef)) {
    const [groupHash, sceneHash] = assetRef.split('/');
    return { groupHash, sceneHash };
  }

  if (HASH_PATTERN.test(assetRef)) {
    return { groupHash: assetRef, sceneHash: null };
  }

  return { groupHash: null, sceneHash: null };
}

export function buildRuleDisplayGraphExport({
  gameRoot,
  executablePath,
  sceneReferences,
  ruleModules,
  allScenePaths = [],
}) {
  const nodes = [];
  const edges = [];
  const eventFamilies = new Map();
  const linkedModuleIds = new Set();

  // Track which scene paths are already covered by binary references.
  const coveredScenePaths = new Set();

  // Map groupHash -> familyKey for sibling inference.
  const groupHashToFamily = new Map();

  for (const moduleInfo of ruleModules) {
    nodes.push(createGraphNode('rule_module', moduleInfo.rawName, {
      label: moduleInfo.rawName,
      moduleName: moduleInfo.rawName,
      moduleCore: moduleInfo.moduleCore,
      familyKey: moduleInfo.familyKey,
      sourcePath: executablePath,
      offset: moduleInfo.offset,
    }));
  }

  // --- Phase 1: Build graph from binary-extracted scene references ---

  for (const reference of sceneReferences) {
    const familyName = deriveEventFamilyName(reference.name);
    const familyKey = normalizeGraphToken(familyName);
    const { groupHash, sceneHash } = splitAssetRef(reference.assetRef);
    const sceneNodeId = `scene:${reference.assetRef}`;

    if (familyKey && !eventFamilies.has(familyKey)) {
      const eventNode = createGraphNode('event_family', familyKey, {
        label: familyName,
        familyName,
        familyKey,
        sourcePath: executablePath,
      });
      eventFamilies.set(familyKey, eventNode);
      nodes.push(eventNode);
    }

    // Record group-hash to family mapping for sibling inference.
    if (groupHash && familyKey) {
      if (!groupHashToFamily.has(groupHash)) {
        groupHashToFamily.set(groupHash, familyKey);
      }
    }

    if (reference.scenePath) {
      coveredScenePaths.add(reference.scenePath);
    }

    nodes.push(createGraphNode('scene', reference.assetRef, {
      label: reference.name,
      sceneName: reference.name,
      familyKey,
      assetRef: reference.assetRef,
      groupHash,
      sceneHash,
      scenePath: reference.scenePath,
      sceneFileName: reference.scenePath ? path.basename(reference.scenePath) : null,
      loadDomain: reference.loadDomain,
      resolved: Boolean(reference.scenePath),
    }));

    if (familyKey) {
      edges.push(createGraphEdge('triggers_scene', `event_family:${familyKey}`, sceneNodeId, {
        relation: 'event_to_scene',
      }));
    }
  }

  // --- Phase 2: Add orphan scenes from the filesystem ---

  let orphanSceneCount = 0;

  for (const discovered of allScenePaths) {
    if (coveredScenePaths.has(discovered.scenePath)) continue;

    orphanSceneCount += 1;

    // Build a synthetic asset ref for this scene.
    const assetRef = discovered.sceneHash
      ? `${discovered.groupHash}/${discovered.sceneHash}`
      : discovered.groupHash;

    // Check if a sibling in the same group hash has a known family.
    const inferredFamilyKey = groupHashToFamily.get(discovered.groupHash) || null;
    const sceneNodeId = `scene:${assetRef}`;

    nodes.push(createGraphNode('scene', assetRef, {
      label: assetRef,
      sceneName: null,
      familyKey: inferredFamilyKey,
      assetRef,
      groupHash: discovered.groupHash,
      sceneHash: discovered.sceneHash,
      scenePath: discovered.scenePath,
      sceneFileName: 'scene.radium',
      loadDomain: discovered.loadDomain,
      resolved: true,
      orphan: true,
      inferred: Boolean(inferredFamilyKey),
    }));

    if (inferredFamilyKey && eventFamilies.has(inferredFamilyKey)) {
      edges.push(createGraphEdge('triggers_scene', `event_family:${inferredFamilyKey}`, sceneNodeId, {
        relation: 'event_to_scene',
        inferred: true,
      }));
    }
  }

  // --- Phase 3: Module-to-family matching (exact + substring) ---

  for (const moduleInfo of ruleModules) {
    // Try exact match first.
    let eventNode = eventFamilies.get(moduleInfo.familyKey);

    // Fall back to substring matching for longer keys.
    if (!eventNode && moduleInfo.familyKey.length >= MIN_SUBSTRING_MATCH_LENGTH) {
      for (const [key, candidate] of eventFamilies) {
        if (key.length < MIN_SUBSTRING_MATCH_LENGTH) continue;
        if (key.includes(moduleInfo.familyKey) || moduleInfo.familyKey.includes(key)) {
          eventNode = candidate;
          break;
        }
      }
    }

    if (!eventNode) continue;
    linkedModuleIds.add(moduleInfo.rawName);
    edges.push(createGraphEdge('contains', `rule_module:${moduleInfo.rawName}`, eventNode.id, {
      relation: 'module_to_event_family',
    }));
  }

  const totalScenes = sceneReferences.length + orphanSceneCount;

  return {
    schemaVersion: 2,
    gameRoot,
    executablePath,
    counts: {
      ruleModules: ruleModules.length,
      eventFamilies: eventFamilies.size,
      scenes: totalScenes,
      namedScenes: sceneReferences.length,
      orphanScenes: orphanSceneCount,
      resolvedScenes: sceneReferences.filter((reference) => reference.scenePath).length + orphanSceneCount,
      linkedRuleModules: linkedModuleIds.size,
    },
    nodes,
    edges,
  };
}

async function mountedExists(mountedFs, mountedPath) {
  try {
    await mountedFs.promises.lstat(mountedPath);
    return true;
  } catch {
    return false;
  }
}

async function discoverGameRoot(mountedFs) {
  if (await mountedExists(mountedFs, '/game')) {
    try {
      const linkTarget = await mountedFs.promises.readlink('/game');
      const candidate = String(linkTarget || '').replace(/\\/g, '/').replace(/\/game$/, '');
      if (candidate
        && await mountedExists(mountedFs, `${candidate}/assets`)
        && await mountedExists(mountedFs, `${candidate}/game`)) {
        return candidate.startsWith('/') ? candidate : `/${candidate}`;
      }
    } catch {
      // Fall back to directory probing.
    }
  }

  const entries = (await mountedFs.promises.readdir('/')).sort();
  for (const entry of entries) {
    const candidate = `/${entry}`;
    try {
      const stats = await mountedFs.promises.stat(candidate);
      if (!stats.isDirectory()) continue;
      if (await mountedExists(mountedFs, `${candidate}/assets`)
        && await mountedExists(mountedFs, `${candidate}/game`)) {
        return candidate;
      }
    } catch {
      // Ignore unreadable entries.
    }
  }

  return null;
}

async function identifyGamePartition(imagePath) {
  const partitionTable = await partitioninfo.getPartitions(imagePath, {
    includeExtended: false,
    getLogical: true,
  });

  for (const partition of partitionTable.partitions || []) {
    try {
      const gameRoot = await interact(imagePath, partition.index, async (mountedFs) => discoverGameRoot(mountedFs));
      if (gameRoot) {
        return {
          gamePartitionIndex: partition.index,
          gameRoot,
        };
      }
    } catch {
      // Ignore unreadable partitions.
    }
  }

  throw new Error('Unable to find the game-content partition in the raw image.');
}

function buildSceneCandidates(gameRoot, assetRef) {
  const baseRoot = `${gameRoot}/assets/lcd`;
  if (HASH_PATH_PATTERN.test(assetRef)) {
    const [groupHash, sceneHash] = assetRef.split('/');
    return [
      {
        loadDomain: 'demand_loaded',
        scenePath: `${baseRoot}/demand_loaded/${groupHash}/${sceneHash}/scene.radium`,
      },
      {
        loadDomain: 'auto_loaded',
        scenePath: `${baseRoot}/auto_loaded/${groupHash}/${sceneHash}/scene.radium`,
      },
    ];
  }

  if (HASH_PATTERN.test(assetRef)) {
    return [
      {
        loadDomain: 'demand_loaded',
        scenePath: `${baseRoot}/demand_loaded/${assetRef}/scene.radium`,
      },
      {
        loadDomain: 'auto_loaded',
        scenePath: `${baseRoot}/auto_loaded/${assetRef}/scene.radium`,
      },
    ];
  }

  return [];
}

// Walk demand_loaded and auto_loaded directories for all scene.radium files.
async function discoverAllScenePaths(mountedFs, gameRoot) {
  const scenes = [];
  const baseRoot = `${gameRoot}/assets/lcd`;

  for (const loadDomain of ['demand_loaded', 'auto_loaded']) {
    const domainRoot = `${baseRoot}/${loadDomain}`;
    if (!await mountedExists(mountedFs, domainRoot)) continue;

    let groupEntries;
    try {
      groupEntries = await mountedFs.promises.readdir(domainRoot);
    } catch {
      continue;
    }

    for (const groupEntry of groupEntries) {
      if (!HASH_PATTERN.test(groupEntry)) continue;
      const groupPath = `${domainRoot}/${groupEntry}`;

      // Check for direct scene.radium (single-hash path, no sub-directory).
      const directScene = `${groupPath}/scene.radium`;
      if (await mountedExists(mountedFs, directScene)) {
        scenes.push({
          scenePath: directScene,
          groupHash: groupEntry,
          sceneHash: null,
          loadDomain,
        });
        // A direct scene can coexist with nested scenes, so don't skip.
      }

      // Check for nested hash directories containing scene.radium.
      let sceneEntries;
      try {
        sceneEntries = await mountedFs.promises.readdir(groupPath);
      } catch {
        continue;
      }

      for (const sceneEntry of sceneEntries) {
        if (!HASH_PATTERN.test(sceneEntry)) continue;
        const nestedScene = `${groupPath}/${sceneEntry}/scene.radium`;
        if (await mountedExists(mountedFs, nestedScene)) {
          scenes.push({
            scenePath: nestedScene,
            groupHash: groupEntry,
            sceneHash: sceneEntry,
            loadDomain,
          });
        }
      }
    }
  }

  return scenes;
}

export async function extractRuleDisplayGraphFromRawImage(imagePath) {
  const { gamePartitionIndex, gameRoot } = await identifyGamePartition(imagePath);

  return interact(imagePath, gamePartitionIndex, async (mountedFs) => {
    const executablePath = `${gameRoot}/game`;
    const executableBuffer = Buffer.from(await mountedFs.promises.readFile(executablePath));
    const strings = extractPrintableStrings(executableBuffer);
    const ruleModules = extractRuleModuleNames(strings);
    const references = extractNamedAssetReferences(strings);
    const sceneReferences = [];

    for (const reference of references) {
      let resolved = null;
      for (const candidate of buildSceneCandidates(gameRoot, reference.assetRef)) {
        if (await mountedExists(mountedFs, candidate.scenePath)) {
          resolved = candidate;
          break;
        }
      }

      sceneReferences.push({
        ...reference,
        scenePath: resolved?.scenePath || null,
        loadDomain: resolved?.loadDomain || null,
      });
    }

    // Walk the filesystem for all scene.radium files (including ones not
    // referenced in the binary).
    const allScenePaths = await discoverAllScenePaths(mountedFs, gameRoot);

    return {
      gameRoot,
      executablePath,
      ruleModules,
      sceneReferences,
      graph: buildRuleDisplayGraphExport({
        gameRoot,
        executablePath,
        sceneReferences,
        ruleModules,
        allScenePaths,
      }),
    };
  });
}
