import fs from 'node:fs/promises';
import path from 'node:path';

const createdDirs = new Set();
const SOUND_SCRIPT_KEY_PREFIX = 'sound-script::';

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function soundScriptMetadataKey(scriptIndex) {
  return `${SOUND_SCRIPT_KEY_PREFIX}${scriptIndex}`;
}

export function normalizeAssetMetadataEntry(entry = {}) {
  const alias = normalizeString(entry.alias);
  const description = normalizeString(entry.description);
  if (!alias && !description) return null;
  return { alias, description };
}

export function normalizeAssetMetadataStore(raw = {}) {
  const source = raw && typeof raw === 'object' && raw.assets && typeof raw.assets === 'object'
    ? raw.assets
    : {};

  const assets = {};
  for (const [assetPath, entry] of Object.entries(source)) {
    const normalizedPath = normalizeString(assetPath);
    const normalizedEntry = normalizeAssetMetadataEntry(entry);
    if (!normalizedPath || !normalizedEntry) continue;
    assets[normalizedPath] = normalizedEntry;
  }

  return {
    version: 1,
    assets,
  };
}

export async function readAssetMetadataStore(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizeAssetMetadataStore(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return normalizeAssetMetadataStore();
    }
    throw error;
  }
}

export async function writeAssetMetadataStore(filePath, store) {
  const normalized = normalizeAssetMetadataStore(store);
  const sortedAssets = Object.fromEntries(
    Object.entries(normalized.assets).sort(([left], [right]) => left.localeCompare(right)),
  );
  const payload = JSON.stringify({
    version: 1,
    assets: sortedAssets,
  }, null, 2);

  const dir = path.dirname(filePath);
  if (!createdDirs.has(dir)) {
    await fs.mkdir(dir, { recursive: true });
    createdDirs.add(dir);
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${payload}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function updateAssetMetadataEntry(filePath, assetPath, entry) {
  const normalizedPath = normalizeString(assetPath);
  if (!normalizedPath) {
    throw new Error('Asset path is required.');
  }

  const store = await readAssetMetadataStore(filePath);
  const normalizedEntry = normalizeAssetMetadataEntry(entry);
  if (normalizedEntry) {
    store.assets[normalizedPath] = normalizedEntry;
  } else {
    delete store.assets[normalizedPath];
  }
  await writeAssetMetadataStore(filePath, store);
  return normalizedEntry || { alias: '', description: '' };
}

export function applyAssetMetadataToInspection(inspection, assetMetadataByPath = {}) {
  if (!inspection?.spike) return inspection;

  return {
    ...inspection,
    spike: {
      ...inspection.spike,
      assetFiles: (inspection.spike.assetFiles || []).map((asset) => {
        const entry = normalizeAssetMetadataEntry(assetMetadataByPath[asset.path]) || null;
        return {
          ...asset,
          alias: entry?.alias || '',
          description: entry?.description || '',
        };
      }),
      soundScripts: (inspection.spike.soundScripts || []).map((script) => {
        const entry = normalizeAssetMetadataEntry(assetMetadataByPath[soundScriptMetadataKey(script.scriptIndex)]) || null;
        return {
          ...script,
          defaultLabel: String(script.defaultLabel || script.label || ''),
          alias: entry?.alias || '',
          description: entry?.description || '',
        };
      }),
    },
  };
}
