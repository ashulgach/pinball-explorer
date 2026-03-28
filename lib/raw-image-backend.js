import fs from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

import ext2fs from 'ext2fs';
import imageFs from 'balena-image-fs';
import fileDisk from 'file-disk';
import partitioninfo from 'partitioninfo';

import { inspectNativeSpikeSoundsMounted } from './spike-sound-native.js';
import { parseRadiumScene, collectImageManifest, collectAssetTree } from './radium-parser.js';
import { LRUCache, Semaphore } from './lru-cache.js';

// Pure functions shared with the browser backend (web/raw-image-backend-web.js)
import {
  LINUX_PARTITION_TYPES,
  STREAM_CHUNK_SIZE,
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
} from './raw-image-core.js';

const { interact } = imageFs;
const { FileDisk } = fileDisk;

const IMAGE_CACHE = new Map();
const PARTITION_TABLE_CACHE = new Map();

// ---------------------------------------------------------------------------
// Node-specific I/O functions
// ---------------------------------------------------------------------------

async function statHostPath(targetPath) {
  const st = await fs.stat(targetPath);
  return {
    resolvedPath: await fs.realpath(targetPath),
    size: st.size,
    mtimeMs: st.mtimeMs,
  };
}

async function getPartitionTable(imagePath) {
  const cached = PARTITION_TABLE_CACHE.get(imagePath);
  if (cached) return cached;

  const table = await partitioninfo.getPartitions(imagePath, {
    includeExtended: false,
    getLogical: true,
  });
  PARTITION_TABLE_CACHE.set(imagePath, table);
  return table;
}

async function getPartitionInfo(imagePath, partitionIndex) {
  const table = await getPartitionTable(imagePath);
  const partition = (table.partitions || []).find((entry) => entry.index === partitionIndex);
  if (!partition) {
    throw new Error(`Partition ${partitionIndex} not found in raw image.`);
  }
  return partition;
}

async function interactPartitionByInfo(imagePath, partition, fn) {
  if (LINUX_PARTITION_TYPES.has(partition.type)) {
    try {
      const handle = await fs.open(imagePath, 'r');
      try {
        const disk = new FileDisk(handle, true, false, false);
        const mountedFs = await ext2fs.mount(disk, partition.offset);
        try {
          return await fn(mountedFs);
        } finally {
          await ext2fs.umount(mountedFs);
        }
      } finally {
        await handle.close();
      }
    } catch {
      // Fall back to balena-image-fs if the direct ext2 mount path fails.
    }
  }

  return interact(imagePath, partition.index, fn);
}

async function interactPartition(imagePath, partitionIndex, fn) {
  const partition = await getPartitionInfo(imagePath, partitionIndex);
  return interactPartitionByInfo(imagePath, partition, fn);
}

async function interactPartitionWritable(imagePath, partitionIndex, fn) {
  const partition = await getPartitionInfo(imagePath, partitionIndex);
  return interact(imagePath, partition.index, fn);
}

// ---------------------------------------------------------------------------
// Partition scanning + image context
// ---------------------------------------------------------------------------

async function identifyPartitions(imagePath) {
  const partitionTable = await getPartitionTable(imagePath);
  const partitions = partitionTable.partitions || [];
  const orderedPartitions = [
    ...partitions.filter((partition) => LINUX_PARTITION_TYPES.has(partition.type)),
    ...partitions.filter((partition) => !LINUX_PARTITION_TYPES.has(partition.type)),
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
      const result = await interactPartitionByInfo(imagePath, partition, async (mountedFs) => {
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
          try {
            const soundInspection = await inspectNativeSpikeSoundsMounted(mountedFs, discoveredGameRoot);
            discoveredSoundSystem = soundInspection.soundSystem;
            discoveredSoundScripts = soundInspection.soundScripts;
          } catch (error) {
            discoveredSoundError = error.message;
          }
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
      if (rootfsPartitionIndex && gamePartitionIndex) {
        break;
      }
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

async function readMountedFileRangeByResolvedPath(resolvedPath, partitionIndex, mountedPath, start = 0, end = null) {
  const finalStart = Math.max(0, Number(start) || 0);
  const explicitEnd = end === null || end === undefined ? null : Math.max(-1, Number(end));
  let finalEnd = explicitEnd;

  if (finalEnd === null) {
    finalEnd = await interactPartition(resolvedPath, partitionIndex, async (mountedFs) => {
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
    return interactPartition(resolvedPath, partitionIndex, async (mountedFs) => {
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

    const chunk = await interactPartition(resolvedPath, partitionIndex, async (mountedFs) => {
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

async function sniffAssetMetadataByPath(resolvedPath, partitionIndex, mountedPath) {
  const ext = posixExtname(mountedPath).toLowerCase();
  if (ext !== '.asset') {
    const classified = classifyAsset(mountedPath);
    return {
      kind: classified.kind,
      format: classified.format,
      contentType: classified.contentType,
      previewKind: classified.previewKind,
      previewable: classified.previewable,
    };
  }

  const header = await readMountedFileRangeByResolvedPath(resolvedPath, partitionIndex, mountedPath, 0, 31);
  return sniffBufferContent(header);
}

async function buildImageContext(resolvedPath) {
  const hostInfo = await statHostPath(resolvedPath);

  if (!isRawImagePath(hostInfo.resolvedPath)) {
    throw new Error('Pinball Explorer currently supports raw SD images (.raw, .img, .iso) only.');
  }

  const cacheKey = hostInfo.resolvedPath;
  const existing = IMAGE_CACHE.get(cacheKey);
  if (existing && existing.signature.size === hostInfo.size && existing.signature.mtimeMs === hostInfo.mtimeMs) {
    return existing.context;
  }

  const partitionInfo = await identifyPartitions(hostInfo.resolvedPath);
  const versionText = partitionInfo.versionText;
  const assetFiles = partitionInfo.assetFiles;
  const assetMap = new Map(assetFiles.map((asset) => [asset.path, asset]));
  const radiumScenes = assetFiles.filter((asset) => asset.kind === 'scene').map((asset) => ({
    path: asset.path,
    sceneType: asset.sceneType,
  }));
  const soundSystem = partitionInfo.soundSystem;
  const soundScripts = partitionInfo.soundScripts;
  const soundError = partitionInfo.soundError;

  const context = {
    resolvedPath: hostInfo.resolvedPath,
    containerKind: 'raw-image',
    rootfsPartitionIndex: partitionInfo.rootfsPartitionIndex,
    gamePartitionIndex: partitionInfo.gamePartitionIndex,
    gameRoot: partitionInfo.gameRoot,
    assetRoot: partitionInfo.assetRoot,
    versionText,
    assetFiles,
    assetMap,
    radiumScenes,
    assetManifest: buildAssetManifest(assetFiles),
    soundSystem,
    soundScripts,
    soundError,
  };

  IMAGE_CACHE.set(cacheKey, {
    signature: {
      size: hostInfo.size,
      mtimeMs: hostInfo.mtimeMs,
    },
    context,
  });

  return context;
}

async function getImageContext(targetPath) {
  const { resolvedPath } = await statHostPath(targetPath);
  return buildImageContext(resolvedPath);
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

export async function inspectTarget(targetPath) {
  const context = await getImageContext(targetPath);

  return {
    targetPath,
    resolvedPath: context.resolvedPath,
    containerKind: context.containerKind,
    sourceSupport: describeSourceSupport(context.resolvedPath),
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

export async function locateAsset(targetPath, assetPath) {
  const context = await getImageContext(targetPath);
  const normalizedPath = toPosixAbsolute(assetPath);
  const asset = context.assetMap.get(normalizedPath);

  if (!asset) {
    throw new Error(`Asset not found in mounted raw image: ${normalizedPath}`);
  }

  return {
    asset,
    contentType: asset.contentType,
    partitionIndex: context.gamePartitionIndex,
    resolvedPath: context.resolvedPath,
  };
}

export async function describeScene(targetPath, scenePath) {
  const context = await getImageContext(targetPath);
  const normalizedScenePath = normalizeMountedPath(scenePath);
  const sceneAsset = context.assetMap.get(normalizedScenePath);

  if (!sceneAsset || sceneAsset.format !== 'radium') {
    throw new Error(`Scene not found: ${normalizedScenePath}`);
  }

  const sceneBuffer = await readMountedFileRangeByResolvedPath(
    context.resolvedPath,
    context.gamePartitionIndex,
    normalizedScenePath,
    0,
    sceneAsset.storedSize - 1,
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

    const previewAssetPath = linkedAssets.find((assetPath) => context.assetMap.get(assetPath)?.previewKind === 'video') || null;
    return {
      scenePath: normalizedScenePath,
      sceneType,
      previewKind: previewAssetPath ? 'video' : null,
      previewAssetPath,
      linkedAssets,
    };
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
      if (!width || !height) continue;
      if (width > 4096 || height > 4096) continue;

      const formatCode = sceneBuffer.readUInt32LE(entry.offset - 16);
      const imageFormat = (formatCode === 4 || formatCode === 5) ? formatCode : null;

      frames.push({
        assetPath: absolutePath,
        width,
        height,
        imageFormat,
        sceneLabel: null,
      });
    }

    return {
      scenePath: normalizedScenePath,
      sceneType,
      previewKind: frames.length ? 'flipbook' : null,
      frames,
    };
  }

  return {
    scenePath: normalizedScenePath,
    sceneType,
    previewKind: null,
  };
}

export async function renderSceneFramePreview(targetPath, scenePath, assetPath) {
  const scene = await describeScene(targetPath, scenePath);
  if (scene.sceneType !== 'StreamingFlipbook') {
    throw new Error(`Scene is not a StreamingFlipbook: ${scenePath}`);
  }

  const frame = scene.frames.find((entry) => entry.assetPath === normalizeMountedPath(assetPath));
  if (!frame) {
    throw new Error(`Frame not found in scene: ${assetPath}`);
  }

  const located = await locateAsset(targetPath, frame.assetPath);
  const raw = await readMountedFileRangeByResolvedPath(
    located.resolvedPath,
    located.partitionIndex,
    frame.assetPath,
    0,
    located.asset.storedSize - 1,
  );
  if (frame.imageFormat === 5) {
    const rgba = decodeDXT5(raw, frame.width, frame.height);
    return { contentType: 'image/png', buffer: encodeRgbaPng(frame.width, frame.height, rgba) };
  }

  if (frame.imageFormat === 4) {
    const rgba = decodeDXT1(raw, frame.width, frame.height);
    return { contentType: 'image/png', buffer: encodeRgbaPng(frame.width, frame.height, rgba) };
  }

  const untiled = untile4x4Gray8(raw, frame.width, frame.height);
  return { contentType: 'image/png', buffer: encodeGrayPng(frame.width, frame.height, untiled) };
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

export async function streamAssetRange(targetPath, assetPath, start, end, stream) {
  const located = await locateAsset(targetPath, assetPath);
  const finalStart = Math.max(0, Number(start) || 0);
  const finalEnd = end === null || end === undefined
    ? located.asset.storedSize - 1
    : Math.min(Number(end), located.asset.storedSize - 1);

  if (finalEnd < finalStart) {
    return;
  }

  await interactPartition(located.resolvedPath, located.partitionIndex, async (mountedFs) => {
    const handle = await mountedFs.promises.open(located.asset.path, 'r');
    try {
      let position = finalStart;

      while (position <= finalEnd) {
        if (stream.destroyed || stream.writableEnded) break;

        const length = Math.min(STREAM_CHUNK_SIZE, finalEnd - position + 1);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, position);

        if (bytesRead === 0) break;

        const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
        await writeChunk(stream, chunk);
        position += bytesRead;
      }
    } finally {
      await handle.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Radium scene full parse + image rendering
// ---------------------------------------------------------------------------

const radiumParseCache = new LRUCache(10);
const imageRenderCache = new LRUCache(0, 200 * 1024 * 1024);
const interactSemaphore = new Semaphore(1);
const parseInflight = new Map();

export async function parseRadiumSceneFull(targetPath, scenePath) {
  const cacheKey = `${targetPath}::${scenePath}`;
  if (radiumParseCache.has(cacheKey)) {
    return radiumParseCache.get(cacheKey);
  }

  if (parseInflight.has(cacheKey)) {
    return parseInflight.get(cacheKey);
  }

  const pending = (async () => {
    await interactSemaphore.acquire();
    try {
      if (radiumParseCache.has(cacheKey)) {
        return radiumParseCache.get(cacheKey);
      }

      const context = await getImageContext(targetPath);
      const normalizedScenePath = normalizeMountedPath(scenePath);
      const sceneAsset = context.assetMap.get(normalizedScenePath);

      if (!sceneAsset || sceneAsset.format !== 'radium') {
        throw new Error(`Scene not found: ${normalizedScenePath}`);
      }

      const sceneBuffer = await readMountedFileRangeByResolvedPath(
        context.resolvedPath,
        context.gamePartitionIndex,
        normalizedScenePath,
        0,
        sceneAsset.storedSize - 1,
      );

      const parseResult = parseRadiumScene(sceneBuffer);
      const imageManifest = collectImageManifest(parseResult);
      const assetTree = collectAssetTree(parseResult);

      const sceneDir = posixDirname(normalizedScenePath);

      const result = {
        scenePath: normalizedScenePath,
        sceneDir,
        composition: parseResult.composition,
        imageManifest,
        assetTree,
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

export async function renderRadiumImage(targetPath, scenePath, imageId) {
  const renderCacheKey = `${targetPath}::${scenePath}::${imageId}`;
  const cached = imageRenderCache.get(renderCacheKey);
  if (cached) return cached;

  const parsed = await parseRadiumSceneFull(targetPath, scenePath);
  const imageEntry = parsed._parseResult.images[imageId];

  if (!imageEntry) {
    throw new Error(`Image not found: ${imageId}`);
  }

  let result;

  if (imageEntry.isExternal) {
    await interactSemaphore.acquire();
    try {
      const cached2 = imageRenderCache.get(renderCacheKey);
      if (cached2) return cached2;

      const context = await getImageContext(targetPath);
      const assetPath = normalizeMountedPath(
        posixJoin(parsed.sceneDir, 'scene.assets', imageEntry.fileName),
      );
      const asset = context.assetMap.get(assetPath);
      if (!asset) {
        throw new Error(`External image asset not found: ${assetPath}`);
      }
      const raw = await readMountedFileRangeByResolvedPath(
        context.resolvedPath,
        context.gamePartitionIndex,
        assetPath,
        0,
        asset.storedSize - 1,
      );

      result = decodeDxtToPng(raw, imageEntry.width, imageEntry.height, imageEntry.format);
    } finally {
      interactSemaphore.release();
    }
  } else {
    const cached2 = imageRenderCache.get(renderCacheKey);
    if (cached2) return cached2;

    const raw = imageEntry.rawBuffer;
    if (!raw) {
      throw new Error(`No raw buffer for embedded image: ${imageId}`);
    }

    result = decodeDxtToPng(raw, imageEntry.width, imageEntry.height, imageEntry.format);
    imageEntry.rawBuffer = null;
  }

  result._byteSize = result.buffer.length;
  imageRenderCache.set(renderCacheKey, result);
  return result;
}

export async function replaceRadiumImage(targetPath, scenePath, imageId, pngBuffer) {
  const parsed = await parseRadiumSceneFull(targetPath, scenePath);
  const imageEntry = parsed._parseResult.images[imageId];
  if (!imageEntry) {
    throw new Error(`Image not found in scene: ${imageId}`);
  }

  const png = decodePngToRgba(pngBuffer);

  if (png.width !== imageEntry.width || png.height !== imageEntry.height) {
    throw new Error(
      `Dimension mismatch: replacement is ${png.width}\u00D7${png.height} ` +
      `but original is ${imageEntry.width}\u00D7${imageEntry.height}. ` +
      `Replacement must have identical dimensions.`,
    );
  }

  const dxtData = encodeRgbaToDxt(png.pixels, png.width, png.height, imageEntry.format);

  const expected = expectedDxtSize(imageEntry.width, imageEntry.height, imageEntry.format);
  if (dxtData.length !== expected) {
    throw new Error(
      `Encoded DXT size mismatch: got ${dxtData.length}, expected ${expected}`,
    );
  }

  const context = await getImageContext(targetPath);
  const normalizedScenePath = normalizeMountedPath(scenePath);

  await interactSemaphore.acquire();
  try {
    if (imageEntry.isExternal) {
      const assetPath = normalizeMountedPath(
        posixJoin(parsed.sceneDir, 'scene.assets', imageEntry.fileName),
      );
      const asset = context.assetMap.get(assetPath);
      if (!asset) {
        throw new Error(`External image asset file not found: ${assetPath}`);
      }

      if (dxtData.length !== asset.storedSize) {
        throw new Error(
          `External asset size mismatch: encoded ${dxtData.length} bytes ` +
          `but file is ${asset.storedSize} bytes. Cannot resize files in-place.`,
        );
      }

      await interactPartitionWritable(
        context.resolvedPath,
        context.gamePartitionIndex,
        async (mountedFs) => {
          const handle = await mountedFs.promises.open(assetPath, 'r+');
          try {
            const { bytesWritten } = await handle.write(dxtData, 0, dxtData.length, 0);
            if (bytesWritten !== dxtData.length) {
              throw new Error(
                `Short write for external image: expected ${dxtData.length}, wrote ${bytesWritten}`,
              );
            }
          } finally {
            await handle.close();
          }
        },
      );
    } else {
      if (imageEntry.dataOffset === undefined || imageEntry.dataOffset === null) {
        throw new Error('Embedded image is missing byte offset — cannot replace.');
      }
      if (dxtData.length !== imageEntry.dataLength) {
        throw new Error(
          `Embedded data size mismatch: encoded ${dxtData.length} bytes ` +
          `but slot is ${imageEntry.dataLength} bytes.`,
        );
      }

      await interactPartitionWritable(
        context.resolvedPath,
        context.gamePartitionIndex,
        async (mountedFs) => {
          const handle = await mountedFs.promises.open(normalizedScenePath, 'r+');
          try {
            const { bytesWritten } = await handle.write(
              dxtData, 0, dxtData.length, imageEntry.dataOffset,
            );
            if (bytesWritten !== dxtData.length) {
              throw new Error(
                `Short write for embedded image: expected ${dxtData.length}, wrote ${bytesWritten}`,
              );
            }
          } finally {
            await handle.close();
          }
        },
      );
    }
  } finally {
    interactSemaphore.release();
  }

  radiumParseCache.clear();
  imageRenderCache.clear();

  return {
    imageId,
    width: imageEntry.width,
    height: imageEntry.height,
    format: imageEntry.format,
    isExternal: imageEntry.isExternal || false,
  };
}

export async function replaceAssetFile(targetPath, assetPath, replacementBuffer) {
  const context = await getImageContext(targetPath);
  const normalizedPath = toPosixAbsolute(assetPath);
  const asset = context.assetMap.get(normalizedPath);
  if (!asset) throw new Error(`Asset not found: ${assetPath}`);

  await interactSemaphore.acquire();
  try {
    await interactPartitionWritable(
      context.resolvedPath,
      context.gamePartitionIndex,
      async (mountedFs) => {
        const handle = await mountedFs.promises.open(normalizedPath, 'w');
        try {
          const { bytesWritten } = await handle.write(replacementBuffer, 0, replacementBuffer.length, 0);
          if (bytesWritten !== replacementBuffer.length) {
            throw new Error(`Short write: expected ${replacementBuffer.length}, wrote ${bytesWritten}`);
          }
        } finally {
          await handle.close();
        }
      },
    );
  } finally {
    interactSemaphore.release();
  }
  return { assetPath: normalizedPath, size: replacementBuffer.length };
}
