/**
 * raw-image-backend-web.js — Browser-compatible backend for Pinball Explorer.
 *
 * Replaces the Node-specific I/O layer (fs, FileDisk, partitioninfo, balena-image-fs)
 * with browser equivalents (File API, BrowserDisk, partition-parser).
 *
 * Shares all pure logic with the Node backend via raw-image-core.js.
 */

import { Buffer } from 'buffer';
import ext2fs from 'ext2fs';

import { BrowserDisk } from './browser-disk.js';
import { getPartitions } from './partition-parser.js';

import { parseRadiumScene, collectImageManifest, collectAssetTree } from '../lib/radium-parser.js';
import { LRUCache, Semaphore } from '../lib/lru-cache.js';

import {
  LINUX_PARTITION_TYPES,
  READ_CHUNK_LIMIT,
  isRawImagePath,
  toPosixAbsolute,
  normalizeMountedPath,
  posixDirname,
  posixJoin,
  posixExtname,
  basename,
  sniffBufferContent,
  extractTaggedStrings,
  isKnownSceneType,
  looksLikeVideoReference,
  looksLikeFlipbookFrameReference,
  resolveSceneAssetReference,
  classifyAsset,
  describeSourceSupport,
  buildAssetManifest,
  mountedExists,
  readSmallMountedTextFile,
  discoverGameRoot,
  collectAssetFilesFromMountedFs,
  decodeDXT1,
  decodeDXT5,
  decodeDxtToPng,
  decodePngToRgba,
  encodeRgbaPng,
  encodeGrayPng,
  encodeRgbaToDxt,
  expectedDxtSize,
  untile4x4Gray8,
} from '../lib/raw-image-core.js';

// ---------------------------------------------------------------------------
// Caches & concurrency (same pattern as Node backend)
// ---------------------------------------------------------------------------

const IMAGE_CACHE = new Map();
const PARTITION_TABLE_CACHE = new Map();
const radiumParseCache = new LRUCache(10);
const imageRenderCache = new LRUCache(0, 200 * 1024 * 1024);
const interactSemaphore = new Semaphore(1);
const parseInflight = new Map();

// ---------------------------------------------------------------------------
// Browser-specific I/O layer
// ---------------------------------------------------------------------------

/**
 * In browser mode, the "target" is a File object, not a path string.
 * We use the File's name + size as a cache key.
 */
function fileCacheKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

async function getPartitionTable(file) {
  const key = fileCacheKey(file);
  const cached = PARTITION_TABLE_CACHE.get(key);
  if (cached) return cached;

  const table = await getPartitions(file);
  PARTITION_TABLE_CACHE.set(key, table);
  return table;
}

async function getPartitionInfo(file, partitionIndex) {
  const table = await getPartitionTable(file);
  const partition = (table.partitions || []).find((entry) => entry.index === partitionIndex);
  if (!partition) {
    throw new Error(`Partition ${partitionIndex} not found in raw image.`);
  }
  return partition;
}

/**
 * Mount a partition from the raw image file and call fn with the mounted filesystem.
 * Uses BrowserDisk + ext2fs WASM.
 */
async function interactPartition(file, partitionIndex, fn) {
  console.log('[backend] interactPartition start, partition:', partitionIndex);
  const partition = await getPartitionInfo(file, partitionIndex);
  console.log('[backend] partition info:', JSON.stringify(partition));
  const disk = new BrowserDisk(file, true);
  console.log('[backend] BrowserDisk created, calling ext2fs.mount...');
  console.log('[backend] ext2fs object keys:', Object.keys(ext2fs));
  console.log('[backend] typeof ext2fs.mount:', typeof ext2fs.mount);

  // Debug: Test if ext2fs module internals are accessible
  try {
    const extModule = await import('ext2fs/lib/libext2fs');
    console.log('[backend] libext2fs module type:', typeof extModule);
    console.log('[backend] libext2fs default type:', typeof extModule.default);
    const M = extModule.default || extModule;
    console.log('[backend] WASM Module.calledRun:', M.calledRun);
    console.log('[backend] WASM Module.HEAP8:', !!M.HEAP8);
    console.log('[backend] WASM wasmBinary set:', !!M.wasmBinary);
  } catch (e) {
    console.log('[backend] Could not import libext2fs directly:', e.message);
  }

  // Wrap mount with timeout to detect hang
  const mountPromise = ext2fs.mount(disk, partition.offset);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('ext2fs.mount() timed out after 15s'));
    }, 15000);
  });

  let mountedFs;
  try {
    mountedFs = await Promise.race([mountPromise, timeoutPromise]);
  } catch (e) {
    console.error('[backend] ext2fs.mount failed or timed out:', e.message);
    throw e;
  }
  console.log('[backend] ext2fs.mount returned!');
  console.log('[backend] ext2fs.mount succeeded');
  try {
    return await fn(mountedFs);
  } finally {
    await ext2fs.umount(mountedFs);
    console.log('[backend] ext2fs.umount done');
  }
}

// ---------------------------------------------------------------------------
// Partition scanning + image context (browser version)
// ---------------------------------------------------------------------------

async function identifyPartitions(file) {
  console.log('[backend] identifyPartitions start');
  const partitionTable = await getPartitionTable(file);
  console.log('[backend] partition table:', JSON.stringify(partitionTable).slice(0, 500));
  const partitions = partitionTable.partitions || [];
  const orderedPartitions = [
    ...partitions.filter((p) => LINUX_PARTITION_TYPES.has(p.type)),
    ...partitions.filter((p) => !LINUX_PARTITION_TYPES.has(p.type)),
  ];

  let rootfsPartitionIndex = null;
  let versionText = null;
  let gamePartitionIndex = null;
  let gameRoot = null;
  let assetFiles = null;
  let soundSystem = null;
  let soundScripts = [];
  let soundError = null;

  for (const partition of orderedPartitions) {
    try {
      const result = await interactPartition(file, partition.index, async (mountedFs) => {
        const rootEntries = (await mountedFs.promises.readdir('/')).sort();
        const names = new Set(rootEntries);

        const isRootfs = names.has('usr') && names.has('etc');
        const discoveredGameRoot = await discoverGameRoot(mountedFs);
        const discoveredAssetRoot = discoveredGameRoot ? `${discoveredGameRoot}/assets` : null;
        const discoveredVersionText = isRootfs
          ? await readSmallMountedTextFile(mountedFs, '/usr/local/spike/VERSION.txt').catch(() => null)
          : null;

        let discoveredAssetFiles = null;
        let discoveredSoundSystem = null;
        let discoveredSoundScripts = [];
        let discoveredSoundError = null;

        if (discoveredGameRoot && discoveredAssetRoot) {
          discoveredAssetFiles = await collectAssetFilesFromMountedFs(mountedFs, discoveredAssetRoot);
          // Sound inspection requires spike-sound-native which may need adaptation
          // for browser. For now, skip sound inspection in web mode.
          discoveredSoundSystem = null;
          discoveredSoundScripts = [];
          discoveredSoundError = 'Sound inspection not yet supported in web mode';
        }

        return {
          isRootfs,
          versionText: discoveredVersionText,
          gameRoot: discoveredGameRoot,
          assetRoot: discoveredAssetRoot,
          assetFiles: discoveredAssetFiles,
          soundSystem: discoveredSoundSystem,
          soundScripts: discoveredSoundScripts,
          soundError: discoveredSoundError,
        };
      });

      if (result.isRootfs) {
        rootfsPartitionIndex = partition.index;
        versionText = result.versionText;
      }
      if (result.gameRoot) {
        gamePartitionIndex = partition.index;
        gameRoot = result.gameRoot;
        assetFiles = result.assetFiles;
        soundSystem = result.soundSystem;
        soundScripts = result.soundScripts;
        soundError = result.soundError;
      }
      if (rootfsPartitionIndex && gamePartitionIndex) break;
    } catch {
      // Ignore unsupported or unreadable partitions.
    }
  }

  if (!gamePartitionIndex || !gameRoot) {
    throw new Error('Unable to find the game-content partition in the raw image.');
  }

  return {
    rootfsPartitionIndex,
    versionText,
    gamePartitionIndex,
    gameRoot,
    assetRoot: `${gameRoot}/assets`,
    assetFiles: assetFiles || [],
    soundSystem,
    soundScripts,
    soundError,
  };
}

async function readMountedFileRange(file, partitionIndex, mountedPath, start = 0, end = null) {
  const finalStart = Math.max(0, Number(start) || 0);
  let finalEnd = end === null || end === undefined ? null : Math.max(-1, Number(end));

  if (finalEnd === null) {
    finalEnd = await interactPartition(file, partitionIndex, async (mountedFs) => {
      const handle = await mountedFs.promises.open(mountedPath, 'r');
      try {
        const stat = await handle.stat();
        return stat.size - 1;
      } finally {
        await handle.close();
      }
    });
  }

  const totalLength = Math.max(0, finalEnd - finalStart + 1);
  if (totalLength === 0) return Buffer.alloc(0);

  if (totalLength <= READ_CHUNK_LIMIT) {
    return interactPartition(file, partitionIndex, async (mountedFs) => {
      const handle = await mountedFs.promises.open(mountedPath, 'r');
      try {
        const buffer = Buffer.alloc(totalLength);
        let position = finalStart;
        let written = 0;
        while (written < totalLength) {
          const { bytesRead } = await handle.read(buffer, written, totalLength - written, position);
          if (bytesRead === 0) break;
          position += bytesRead;
          written += bytesRead;
        }
        return written === buffer.length ? buffer : buffer.subarray(0, written);
      } finally {
        await handle.close();
      }
    });
  }

  const chunks = [];
  let offset = finalStart;
  while (offset <= finalEnd) {
    const chunkEnd = Math.min(offset + READ_CHUNK_LIMIT - 1, finalEnd);
    const chunkLength = chunkEnd - offset + 1;
    const chunkStart = offset;

    const chunk = await interactPartition(file, partitionIndex, async (mountedFs) => {
      const handle = await mountedFs.promises.open(mountedPath, 'r');
      try {
        const buffer = Buffer.alloc(chunkLength);
        let position = chunkStart;
        let written = 0;
        while (written < chunkLength) {
          const { bytesRead } = await handle.read(buffer, written, chunkLength - written, position);
          if (bytesRead === 0) break;
          position += bytesRead;
          written += bytesRead;
        }
        return written === buffer.length ? buffer : buffer.subarray(0, written);
      } finally {
        await handle.close();
      }
    });

    chunks.push(chunk);
    if (chunk.length < chunkLength) break;
    offset = chunkEnd + 1;
  }

  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Image context (browser version — uses File object instead of path)
// ---------------------------------------------------------------------------

async function buildImageContext(file) {
  console.log('[backend] buildImageContext, file:', file.name, 'size:', file.size, 'isRawImage:', isRawImagePath(file.name));
  if (!isRawImagePath(file.name)) {
    throw new Error('Pinball Explorer currently supports raw SD images (.raw, .img, .iso) only.');
  }

  const cacheKey = fileCacheKey(file);
  const existing = IMAGE_CACHE.get(cacheKey);
  if (existing) return existing;

  const partitionInfo = await identifyPartitions(file);
  const assetFiles = partitionInfo.assetFiles;
  const assetMap = new Map(assetFiles.map((asset) => [asset.path, asset]));
  const radiumScenes = assetFiles.filter((asset) => asset.kind === 'scene').map((asset) => ({
    path: asset.path,
    sceneType: asset.sceneType,
  }));

  const context = {
    file,
    containerKind: 'raw-image',
    rootfsPartitionIndex: partitionInfo.rootfsPartitionIndex,
    gamePartitionIndex: partitionInfo.gamePartitionIndex,
    gameRoot: partitionInfo.gameRoot,
    assetRoot: partitionInfo.assetRoot,
    versionText: partitionInfo.versionText,
    assetFiles,
    assetMap,
    radiumScenes,
    assetManifest: buildAssetManifest(assetFiles),
    soundSystem: partitionInfo.soundSystem,
    soundScripts: partitionInfo.soundScripts,
    soundError: partitionInfo.soundError,
  };

  IMAGE_CACHE.set(cacheKey, context);
  return context;
}

// ---------------------------------------------------------------------------
// Exported API (mirrors Node backend, but takes File instead of path)
// ---------------------------------------------------------------------------

export async function inspectTarget(file) {
  const context = await buildImageContext(file);

  return {
    targetPath: file.name,
    resolvedPath: file.name,
    containerKind: context.containerKind,
    sourceSupport: describeSourceSupport(file.name),
    squashfs: null,
    spike: {
      path: context.assetRoot,
      sourceMode: 'raw-image',
      versionText: context.versionText,
      gameRoot: context.gameRoot,
      assetRoot: context.assetRoot,
      rootfsPartitionIndex: context.rootfsPartitionIndex,
      gamePartitionIndex: context.gamePartitionIndex,
      entries: [],
      stringsPreview: [],
      assetManifest: context.assetManifest,
      assetFiles: context.assetFiles,
      radiumScenes: context.radiumScenes,
      soundSystem: context.soundSystem,
      soundScripts: context.soundScripts,
      soundError: context.soundError,
    },
  };
}

export async function locateAsset(file, assetPath) {
  const context = await buildImageContext(file);
  const normalizedPath = toPosixAbsolute(assetPath);
  const asset = context.assetMap.get(normalizedPath);

  if (!asset) {
    throw new Error(`Asset not found in mounted raw image: ${normalizedPath}`);
  }

  return {
    asset,
    contentType: asset.contentType,
    partitionIndex: context.gamePartitionIndex,
    file: context.file,
  };
}

export async function readAssetRange(file, assetPath, start = 0, end = null) {
  const located = await locateAsset(file, assetPath);
  const finalEnd = end === null ? located.asset.storedSize - 1 : end;
  return readMountedFileRange(located.file, located.partitionIndex, located.asset.path, start, finalEnd);
}

export async function describeScene(file, scenePath) {
  const context = await buildImageContext(file);
  const normalizedScenePath = normalizeMountedPath(scenePath);
  const sceneAsset = context.assetMap.get(normalizedScenePath);

  if (!sceneAsset || sceneAsset.format !== 'radium') {
    throw new Error(`Scene not found: ${normalizedScenePath}`);
  }

  const sceneBuffer = await readMountedFileRange(
    context.file, context.gamePartitionIndex, normalizedScenePath, 0, sceneAsset.storedSize - 1,
  );
  const taggedStrings = extractTaggedStrings(sceneBuffer);
  const strings = taggedStrings.map((entry) => entry.value);
  const sceneType = strings.find(isKnownSceneType) || 'RawScene';
  const sceneDir = posixDirname(normalizedScenePath);

  if (sceneType === 'Video') {
    const linkedAssets = [];
    for (const value of strings) {
      if (!looksLikeVideoReference(value)) continue;
      const absolutePath = resolveSceneAssetReference(sceneDir, value, context.assetMap);
      if (!absolutePath) continue;
      if (!linkedAssets.includes(absolutePath)) linkedAssets.push(absolutePath);
    }
    const previewAssetPath = linkedAssets.find((ap) => context.assetMap.get(ap)?.previewKind === 'video') || null;
    return { scenePath: normalizedScenePath, sceneType, previewKind: previewAssetPath ? 'video' : null, previewAssetPath, linkedAssets };
  }

  if (sceneType === 'StreamingFlipbook') {
    const frames = [];
    for (const entry of taggedStrings) {
      if (!looksLikeFlipbookFrameReference(entry.value)) continue;
      const absolutePath = resolveSceneAssetReference(sceneDir, entry.value, context.assetMap);
      if (!absolutePath) continue;
      if (entry.offset < 24) continue;
      const width = sceneBuffer.readUInt32LE(entry.offset - 24);
      const height = sceneBuffer.readUInt32LE(entry.offset - 20);
      if (!width || !height || width > 4096 || height > 4096) continue;
      const formatCode = sceneBuffer.readUInt32LE(entry.offset - 16);
      const imageFormat = (formatCode === 4 || formatCode === 5) ? formatCode : null;
      frames.push({ assetPath: absolutePath, width, height, imageFormat, sceneLabel: null });
    }
    return { scenePath: normalizedScenePath, sceneType, previewKind: frames.length ? 'flipbook' : null, frames };
  }

  return { scenePath: normalizedScenePath, sceneType, previewKind: null };
}

export async function renderSceneFramePreview(file, scenePath, assetPath) {
  const scene = await describeScene(file, scenePath);
  if (scene.sceneType !== 'StreamingFlipbook') {
    throw new Error(`Scene is not a StreamingFlipbook: ${scenePath}`);
  }

  const frame = scene.frames.find((entry) => entry.assetPath === normalizeMountedPath(assetPath));
  if (!frame) throw new Error(`Frame not found in scene: ${assetPath}`);

  const located = await locateAsset(file, frame.assetPath);
  const raw = await readMountedFileRange(located.file, located.partitionIndex, frame.assetPath, 0, located.asset.storedSize - 1);

  if (frame.imageFormat === 5) return { contentType: 'image/png', buffer: encodeRgbaPng(frame.width, frame.height, decodeDXT5(raw, frame.width, frame.height)) };
  if (frame.imageFormat === 4) return { contentType: 'image/png', buffer: encodeRgbaPng(frame.width, frame.height, decodeDXT1(raw, frame.width, frame.height)) };
  return { contentType: 'image/png', buffer: encodeGrayPng(frame.width, frame.height, untile4x4Gray8(raw, frame.width, frame.height)) };
}

export async function parseRadiumSceneFull(file, scenePath) {
  const cacheKey = `${fileCacheKey(file)}::${scenePath}`;
  if (radiumParseCache.has(cacheKey)) return radiumParseCache.get(cacheKey);
  if (parseInflight.has(cacheKey)) return parseInflight.get(cacheKey);

  const pending = (async () => {
    await interactSemaphore.acquire();
    try {
      if (radiumParseCache.has(cacheKey)) return radiumParseCache.get(cacheKey);

      const context = await buildImageContext(file);
      const normalizedScenePath = normalizeMountedPath(scenePath);
      const sceneAsset = context.assetMap.get(normalizedScenePath);
      if (!sceneAsset || sceneAsset.format !== 'radium') throw new Error(`Scene not found: ${normalizedScenePath}`);

      const sceneBuffer = await readMountedFileRange(context.file, context.gamePartitionIndex, normalizedScenePath, 0, sceneAsset.storedSize - 1);
      const parseResult = parseRadiumScene(sceneBuffer);

      const result = {
        scenePath: normalizedScenePath,
        sceneDir: posixDirname(normalizedScenePath),
        composition: parseResult.composition,
        imageManifest: collectImageManifest(parseResult),
        assetTree: collectAssetTree(parseResult),
        _parseResult: parseResult,
      };

      radiumParseCache.set(cacheKey, result);
      return result;
    } finally {
      interactSemaphore.release();
    }
  })();

  parseInflight.set(cacheKey, pending);
  pending.finally(() => parseInflight.delete(cacheKey));
  return pending;
}

export async function renderRadiumImage(file, scenePath, imageId) {
  const renderCacheKey = `${fileCacheKey(file)}::${scenePath}::${imageId}`;
  const cached = imageRenderCache.get(renderCacheKey);
  if (cached) return cached;

  const parsed = await parseRadiumSceneFull(file, scenePath);
  const imageEntry = parsed._parseResult.images[imageId];
  if (!imageEntry) throw new Error(`Image not found: ${imageId}`);

  let result;

  if (imageEntry.isExternal) {
    await interactSemaphore.acquire();
    try {
      const cached2 = imageRenderCache.get(renderCacheKey);
      if (cached2) return cached2;

      const context = await buildImageContext(file);
      const assetPath = normalizeMountedPath(posixJoin(parsed.sceneDir, 'scene.assets', imageEntry.fileName));
      const asset = context.assetMap.get(assetPath);
      if (!asset) throw new Error(`External image asset not found: ${assetPath}`);

      const raw = await readMountedFileRange(context.file, context.gamePartitionIndex, assetPath, 0, asset.storedSize - 1);
      result = decodeDxtToPng(raw, imageEntry.width, imageEntry.height, imageEntry.format);
    } finally {
      interactSemaphore.release();
    }
  } else {
    const cached2 = imageRenderCache.get(renderCacheKey);
    if (cached2) return cached2;

    const raw = imageEntry.rawBuffer;
    if (!raw) throw new Error(`No raw buffer for embedded image: ${imageId}`);
    result = decodeDxtToPng(raw, imageEntry.width, imageEntry.height, imageEntry.format);
    imageEntry.rawBuffer = null;
  }

  result._byteSize = result.buffer.length;
  imageRenderCache.set(renderCacheKey, result);
  return result;
}

/**
 * Clear all caches — call when loading a new file.
 */
export function clearCaches() {
  IMAGE_CACHE.clear();
  PARTITION_TABLE_CACHE.clear();
  radiumParseCache.clear();
  imageRenderCache.clear();
}
