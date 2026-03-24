import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  applyAssetMetadataToInspection,
  readAssetMetadataStore,
  updateAssetMetadataEntry,
} from './lib/asset-metadata-store.js';
import { replaceNativeSpikeSoundScript } from './lib/spike-sound-native.js';
import { LRUCache } from './lib/lru-cache.js';

const selfRoot = path.dirname(fileURLToPath(import.meta.url));

// When running inside Electron, process.execPath is the Electron binary.
// ELECTRON_RUN_AS_NODE makes it behave as plain Node.js for worker spawns.
const workerEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

// These are re-assigned by startServer() when running inside Electron.
let root = selfRoot;
let publicDir = path.join(root, 'public');
let workerPath = path.join(root, 'lib', 'raw-image-worker.js');
let assetMetadataPath = path.join(root, 'data', 'asset-metadata.json');
let cacheRoot = path.join(root, '.cache');
let soundCacheDir = path.join(cacheRoot, 'sound-cache');
let soundUploadDir = path.join(cacheRoot, 'sound-uploads');
let videoUploadDir = path.join(cacheRoot, 'video-uploads');
let imageUploadDir = path.join(cacheRoot, 'image-uploads');
let defaultTarget = '';
const inspectCache = new Map();
const inspectInflight = new Map();
const graphCache = new Map();
const graphInflight = new Map();
let assetMetadataCache = null;
const sceneCache = new Map();
const sceneInflight = new Map();
const soundFileCache = new Map();
const soundFileInflight = new Map();
const radiumSceneCache = new LRUCache(20);
const radiumSceneInflight = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > 1024 * 1024) {
      throw new Error('JSON payload too large.');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

function parseScriptIndex(value) {
  const scriptIndex = Number(value);
  if (!Number.isInteger(scriptIndex) || scriptIndex < 0) {
    return null;
  }
  return scriptIndex;
}

function parseRangeHeader(rangeHeader, totalLength) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { error: 'invalid' };

  const [, rawStart, rawEnd] = match;
  let start = rawStart ? Number(rawStart) : null;
  let end = rawEnd ? Number(rawEnd) : null;

  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) {
    return { error: 'invalid' };
  }

  if (start === null && end === null) return { error: 'invalid' };
  if (start === null) {
    if (end <= 0) return { error: 'invalid' };
    start = Math.max(totalLength - end, 0);
    end = totalLength - 1;
  } else {
    if (start >= totalLength) return { error: 'unsatisfiable' };
    end = end === null ? totalLength - 1 : Math.min(end, totalLength - 1);
  }

  if (start < 0 || end < start) return { error: 'invalid' };
  return { start, end };
}

async function serveStatic(res, pathname) {
  const filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname.slice(1));
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

async function resolveTargetSignature(targetPath) {
  const [resolvedPath, stats] = await Promise.all([
    fs.realpath(targetPath),
    fs.stat(targetPath),
  ]);

  return {
    resolvedPath,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore missing files during cache cleanup.
  }
}

function soundCacheKey(signature, scriptIndex) {
  return `${signature.resolvedPath}::${signature.size}:${signature.mtimeMs}::${scriptIndex}`;
}

function buildSoundCachePath(cacheDir, signature, scriptIndex) {
  const hash = crypto
    .createHash('sha1')
    .update(`${signature.resolvedPath}\n${signature.size}\n${signature.mtimeMs}\n${scriptIndex}`)
    .digest('hex');
  return path.join(cacheDir, `${hash}.wav`);
}

function matchesTargetPath(targetPaths, target, resolvedPath) {
  return targetPaths.has(target) || (resolvedPath ? targetPaths.has(resolvedPath) : false);
}

async function invalidateTargetCaches(target) {
  let resolvedPath = null;
  try {
    resolvedPath = await fs.realpath(target);
  } catch {
    // Ignore path resolution failures during invalidation.
  }

  inspectCache.delete(target);
  inspectInflight.delete(target);
  graphCache.delete(target);
  graphInflight.delete(target);
  if (resolvedPath) {
    inspectCache.delete(resolvedPath);
    inspectInflight.delete(resolvedPath);
    graphCache.delete(resolvedPath);
    graphInflight.delete(resolvedPath);
  }

  for (const key of [...sceneCache.keys()]) {
    if (key.startsWith(`${target}::`) || (resolvedPath && key.startsWith(`${resolvedPath}::`))) {
      sceneCache.delete(key);
    }
  }

  for (const key of [...sceneInflight.keys()]) {
    if (key.startsWith(`${target}::`) || (resolvedPath && key.startsWith(`${resolvedPath}::`))) {
      sceneInflight.delete(key);
    }
  }

  for (const [key, entry] of soundFileCache.entries()) {
    if (!matchesTargetPath(entry.targetPaths, target, resolvedPath)) continue;
    soundFileCache.delete(key);
    await unlinkIfExists(entry.filePath);
  }

  for (const [key, entry] of soundFileInflight.entries()) {
    if (matchesTargetPath(entry.targetPaths, target, resolvedPath)) {
      soundFileInflight.delete(key);
    }
  }
}

function runRawImageWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ...args], {
      cwd: root,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }

      const errorText = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(errorText || `raw-image worker exited with code ${code}`));
    });
  });
}

function runRawImageWorkerBuffer(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ...args], {
      cwd: root,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }

      const errorText = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(errorText || `raw-image worker exited with code ${code}`));
    });
  });
}

async function getInspection(target, { refresh = false } = {}) {
  const cacheKey = String(target || '');
  if (!refresh && inspectCache.has(cacheKey)) {
    return inspectCache.get(cacheKey);
  }

  if (!refresh && inspectInflight.has(cacheKey)) {
    return inspectInflight.get(cacheKey);
  }

  const pending = runRawImageWorker(['inspect', cacheKey])
    .then((rawJson) => JSON.parse(rawJson))
    .then((result) => {
      inspectCache.set(cacheKey, result);
      if (result.resolvedPath) {
        inspectCache.set(result.resolvedPath, result);
      }
      return result;
    })
    .finally(() => {
      inspectInflight.delete(cacheKey);
    });

  inspectInflight.set(cacheKey, pending);
  return pending;
}

async function getRuleGraph(target, { refresh = false } = {}) {
  const cacheKey = String(target || '');
  if (!refresh && graphCache.has(cacheKey)) {
    return graphCache.get(cacheKey);
  }

  if (!refresh && graphInflight.has(cacheKey)) {
    return graphInflight.get(cacheKey);
  }

  const pending = runRawImageWorker(['graph', cacheKey])
    .then((rawJson) => JSON.parse(rawJson))
    .then((result) => {
      graphCache.set(cacheKey, result);
      if (result.resolvedPath) {
        graphCache.set(result.resolvedPath, result);
      }
      return result;
    })
    .finally(() => {
      graphInflight.delete(cacheKey);
    });

  graphInflight.set(cacheKey, pending);
  return pending;
}

function normalizeGraphToken(value) {
  return String(value || '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '');
}

function enrichGraphWithSounds(graphResult, inspection) {
  const graph = graphResult?.graph;
  if (!graph?.nodes || !graph?.edges) return graphResult;

  const soundScripts = inspection?.spike?.soundScripts || [];
  const namedScripts = soundScripts.filter((s) => s.label);
  if (!namedScripts.length) return graphResult;

  // Build a set of existing event family keys for matching.
  const familyNodes = new Map();
  for (const node of graph.nodes) {
    if (node.type === 'event_family') {
      familyNodes.set(node.familyKey, node);
    }
  }

  const newNodes = [];
  const newEdges = [];
  const matchedSoundIds = new Set();

  for (const script of namedScripts) {
    const label = String(script.label || '');
    if (!label) continue;

    const soundKey = normalizeGraphToken(label);
    if (!soundKey || soundKey.length < 4) continue;

    // Find matching event family by substring containment.
    let matchedFamily = null;
    for (const [familyKey, familyNode] of familyNodes) {
      if (familyKey.length < 4) continue;
      if (soundKey.includes(familyKey) || familyKey.includes(soundKey)) {
        matchedFamily = familyNode;
        break;
      }
    }

    const soundNodeId = `sound:${script.scriptIndex}`;
    if (matchedSoundIds.has(soundNodeId)) continue;
    matchedSoundIds.add(soundNodeId);

    newNodes.push({
      id: soundNodeId,
      type: 'sound',
      label,
      scriptIndex: script.scriptIndex,
      codec: script.codec,
      durationMs: script.durationMs,
      channels: script.channels,
      fragmentCount: script.fragmentCount,
      familyKey: matchedFamily?.familyKey || null,
    });

    if (matchedFamily) {
      newEdges.push({
        id: `triggers_audio:${matchedFamily.id}->${soundNodeId}`,
        type: 'triggers_audio',
        source: matchedFamily.id,
        target: soundNodeId,
        relation: 'event_to_sound',
      });
    }
  }

  if (!newNodes.length) return graphResult;

  return {
    ...graphResult,
    graph: {
      ...graph,
      counts: {
        ...graph.counts,
        sounds: newNodes.length,
        linkedSounds: newEdges.length,
      },
      nodes: [...graph.nodes, ...newNodes],
      edges: [...graph.edges, ...newEdges],
    },
  };
}

async function getSceneMetadata(target, scenePath, { refresh = false } = {}) {
  const cacheKey = `${target}::${scenePath}`;
  if (!refresh && sceneCache.has(cacheKey)) {
    return sceneCache.get(cacheKey);
  }

  if (!refresh && sceneInflight.has(cacheKey)) {
    return sceneInflight.get(cacheKey);
  }

  const pending = runRawImageWorker(['scene', target, scenePath])
    .then((rawJson) => JSON.parse(rawJson))
    .then((result) => {
      sceneCache.set(cacheKey, result);
      return result;
    })
    .finally(() => {
      sceneInflight.delete(cacheKey);
    });

  sceneInflight.set(cacheKey, pending);
  return pending;
}

async function getSoundFile(target, scriptIndex, { refresh = false } = {}) {
  const signature = await resolveTargetSignature(target);
  const cacheKey = soundCacheKey(signature, scriptIndex);
  const targetPaths = new Set([target, signature.resolvedPath]);

  if (!refresh && soundFileCache.has(cacheKey)) {
    const cached = soundFileCache.get(cacheKey);
    try {
      await fs.access(cached.filePath);
      return cached;
    } catch {
      soundFileCache.delete(cacheKey);
    }
  }

  if (!refresh && soundFileInflight.has(cacheKey)) {
    return soundFileInflight.get(cacheKey).promise;
  }

  const promise = (async () => {
    await fs.mkdir(soundCacheDir, { recursive: true });
    const filePath = buildSoundCachePath(soundCacheDir, signature, scriptIndex);
    const inspection = await getInspection(signature.resolvedPath);
    await runRawImageWorker([
      'sound-export',
      signature.resolvedPath,
      String(inspection?.spike?.gamePartitionIndex ?? ''),
      inspection?.spike?.gameRoot || '',
      String(scriptIndex),
      filePath,
    ]);

    const entry = {
      filePath,
      scriptIndex,
      signature,
      targetPaths,
    };
    soundFileCache.set(cacheKey, entry);
    return entry;
  })()
    .catch(async (error) => {
      await unlinkIfExists(buildSoundCachePath(soundCacheDir, signature, scriptIndex));
      throw error;
    })
    .finally(() => {
      soundFileInflight.delete(cacheKey);
    });

  soundFileInflight.set(cacheKey, {
    promise,
    targetPaths,
  });
  return promise;
}

function soundFileName(scriptIndex) {
  return `sound-script-${scriptIndex.toString(16).toUpperCase().padStart(2, '0')}.wav`;
}

function findAsset(inspection, assetPath) {
  const normalized = String(assetPath || '');
  return inspection?.spike?.assetFiles?.find((asset) => asset.path === normalized) || null;
}

async function spawnAssetWorker(target, assetPath, start, end, res) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, 'cat', target, assetPath, String(start), String(end)], {
      cwd: root,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderr = [];
    let settled = false;

    const abortChild = () => {
      if (!child.killed) child.kill('SIGTERM');
    };

    res.once('close', abortChild);
    res.once('error', abortChild);
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.stdout.pipe(res, { end: false });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      child.stdout.unpipe(res);
      if (code === 0 || res.destroyed) {
        resolve();
        return;
      }

      const errorText = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(errorText || `raw-image asset worker exited with code ${code}`));
    });
  });
}

async function spawnSceneFrameWorker(target, scenePath, assetPath, res) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, 'scene-frame', target, scenePath, assetPath], {
      cwd: root,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderr = [];
    let settled = false;

    const abortChild = () => {
      if (!child.killed) child.kill('SIGTERM');
    };

    res.once('close', abortChild);
    res.once('error', abortChild);
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.stdout.pipe(res, { end: false });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      child.stdout.unpipe(res);
      if (code === 0 || res.destroyed) {
        resolve();
        return;
      }

      const errorText = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(errorText || `scene frame worker exited with code ${code}`));
    });
  });
}

async function serveMountedAsset(req, res, target, assetPath) {
  const inspection = await getInspection(target);
  const asset = findAsset(inspection, assetPath);
  if (!asset) {
    sendJson(res, 404, { error: `Asset not found: ${assetPath}`, target, assetPath });
    return;
  }

  const totalLength = asset.storedSize;
  const range = parseRangeHeader(req.headers.range, totalLength);

  if (range?.error === 'invalid') {
    sendJson(res, 400, { error: 'Invalid Range header', target, assetPath });
    return;
  }

  if (range?.error === 'unsatisfiable') {
    res.writeHead(416, {
      'Content-Range': `bytes */${totalLength}`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : totalLength - 1;
  const length = end >= start ? end - start + 1 : 0;
  const headers = {
    'Content-Type': asset.contentType || 'application/octet-stream',
    'Content-Length': length,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename="${path.basename(assetPath)}"`,
  };

  if (range) {
    headers['Content-Range'] = `bytes ${start}-${end}/${totalLength}`;
  }

  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  await spawnAssetWorker(target, assetPath, start, end, res);
  if (!res.writableEnded) res.end();
}

async function serveLocalFile(req, res, filePath, { contentType, filename, disposition = 'inline' }) {
  const stats = await fs.stat(filePath);
  const totalLength = stats.size;
  const range = parseRangeHeader(req.headers.range, totalLength);

  if (range?.error === 'invalid') {
    sendJson(res, 400, { error: 'Invalid Range header', filePath });
    return;
  }

  if (range?.error === 'unsatisfiable') {
    res.writeHead(416, {
      'Content-Range': `bytes */${totalLength}`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : totalLength - 1;
  const headers = {
    'Content-Type': contentType,
    'Content-Length': end - start + 1,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${disposition}; filename="${filename}"`,
  };

  if (range) {
    headers['Content-Range'] = `bytes ${start}-${end}/${totalLength}`;
  }

  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath, { start, end });
    const abortStream = () => stream.destroy();

    req.once('aborted', abortStream);
    res.once('close', abortStream);
    res.once('error', abortStream);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res, { end: false });
  });

  if (!res.writableEnded) res.end();
}

async function streamRequestToFile(req, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(filePath);
    let written = 0;

    req.on('data', (chunk) => {
      written += chunk.length;
    });
    req.on('error', reject);
    output.on('error', reject);
    output.on('finish', () => resolve(written));
    req.pipe(output);
  });
}

// ---------------------------------------------------------------------------
// Exported entry point for Electron embedding.
// ---------------------------------------------------------------------------

export function startServer({ appRoot, dataRoot, port: requestedPort = 4274 } = {}) {
  if (appRoot) {
    root = appRoot;
    // In a packaged Electron app, worker scripts live outside the ASAR.
    const codeRoot = appRoot.replace('app.asar', 'app.asar.unpacked');
    publicDir = path.join(appRoot, 'public');
    workerPath = path.join(codeRoot, 'lib', 'raw-image-worker.js');
  }
  if (dataRoot) {
    assetMetadataPath = path.join(dataRoot, 'asset-metadata.json');
    cacheRoot = path.join(dataRoot, '.cache');
    soundCacheDir = path.join(cacheRoot, 'sound-cache');
    soundUploadDir = path.join(cacheRoot, 'sound-uploads');
    videoUploadDir = path.join(cacheRoot, 'video-uploads');
    imageUploadDir = path.join(cacheRoot, 'image-uploads');
  }

  return new Promise((resolve) => {
    const server = _createServer();
    server.listen(requestedPort, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`Pinball Explorer listening on http://127.0.0.1:${port}`);
      resolve({ server, port });
    });
  });
}

function _createServer() {
  return http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/pick-file' && req.method === 'GET') {
    try {
      const picked = await new Promise((resolve, reject) => {
        const child = spawn('osascript', [
          '-e',
          'set f to choose file with prompt "Select SD card image" of type {"public.data"}\nreturn POSIX path of f',
        ]);
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => { out += chunk; });
        child.stderr.on('data', (chunk) => { err += chunk; });
        child.on('close', (code) => {
          if (code === 0) resolve(out.trim());
          else reject(new Error(err.trim() || 'File picker cancelled'));
        });
      });
      sendJson(res, 200, { path: picked });
    } catch {
      sendJson(res, 200, { path: null });
    }
    return;
  }

  if (url.pathname === '/api/default-target' && req.method === 'GET') {
    sendJson(res, 200, { defaultTarget });
    return;
  }

  if (url.pathname === '/api/inspect' && req.method === 'GET') {
    const target = url.searchParams.get('path') || defaultTarget;
    try {
      assetMetadataCache ??= await readAssetMetadataStore(assetMetadataPath);
      const result = await getInspection(target, { refresh: true });
      sendJson(res, 200, applyAssetMetadataToInspection(result, assetMetadataCache.assets));
    } catch (error) {
      sendJson(res, 500, { error: error.message, target });
    }
    return;
  }

  if (url.pathname === '/api/rule-graph' && req.method === 'GET') {
    const target = url.searchParams.get('path') || defaultTarget;
    try {
      const result = await getRuleGraph(target);
      const inspection = await getInspection(target);
      const enriched = enrichGraphWithSounds(result, inspection);
      sendJson(res, 200, enriched);
    } catch (error) {
      sendJson(res, 500, { error: error.message, target });
    }
    return;
  }

  if (url.pathname === '/api/asset' && (req.method === 'GET' || req.method === 'HEAD')) {
    const target = url.searchParams.get('path') || defaultTarget;
    const assetPath = url.searchParams.get('asset');
    if (!assetPath) {
      sendJson(res, 400, { error: 'Missing asset query parameter', target });
      return;
    }

    try {
      await serveMountedAsset(req, res, target, assetPath);
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, assetPath });
    }
    return;
  }

  if (url.pathname === '/api/asset-preview' && (req.method === 'GET' || req.method === 'HEAD')) {
    const target = url.searchParams.get('path') || defaultTarget;
    const assetPath = url.searchParams.get('asset');
    if (!assetPath) {
      sendJson(res, 400, { error: 'Missing asset query parameter', target });
      return;
    }

    try {
      await serveMountedAsset(req, res, target, assetPath);
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, assetPath });
    }
    return;
  }

  if (url.pathname === '/api/scene-metadata' && req.method === 'GET') {
    const target = url.searchParams.get('path') || defaultTarget;
    const scenePath = url.searchParams.get('scene');
    if (!scenePath) {
      sendJson(res, 400, { error: 'Missing scene query parameter', target });
      return;
    }

    try {
      const result = await getSceneMetadata(target, scenePath, { refresh: true });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scenePath });
    }
    return;
  }

  if (url.pathname === '/api/scene-frame-preview' && (req.method === 'GET' || req.method === 'HEAD')) {
    const target = url.searchParams.get('path') || defaultTarget;
    const scenePath = url.searchParams.get('scene');
    const assetPath = url.searchParams.get('asset');
    if (!scenePath || !assetPath) {
      sendJson(res, 400, { error: 'Missing scene or asset query parameter', target, scenePath, assetPath });
      return;
    }

    try {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${path.basename(assetPath)}.png"`,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      await spawnSceneFrameWorker(target, scenePath, assetPath, res);
      if (!res.writableEnded) res.end();
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scenePath, assetPath });
    }
    return;
  }

  if (url.pathname === '/api/sound-preview' && (req.method === 'GET' || req.method === 'HEAD')) {
    const target = url.searchParams.get('path') || defaultTarget;
    const scriptIndex = parseScriptIndex(url.searchParams.get('script'));
    if (scriptIndex === null) {
      sendJson(res, 400, { error: 'Missing or invalid script query parameter', target });
      return;
    }

    try {
      const cached = await getSoundFile(target, scriptIndex);
      await serveLocalFile(req, res, cached.filePath, {
        contentType: 'audio/wav',
        disposition: 'inline',
        filename: soundFileName(scriptIndex),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scriptIndex });
    }
    return;
  }

  if (url.pathname === '/api/sound-export' && (req.method === 'GET' || req.method === 'HEAD')) {
    const target = url.searchParams.get('path') || defaultTarget;
    const scriptIndex = parseScriptIndex(url.searchParams.get('script'));
    if (scriptIndex === null) {
      sendJson(res, 400, { error: 'Missing or invalid script query parameter', target });
      return;
    }

    try {
      const cached = await getSoundFile(target, scriptIndex);
      await serveLocalFile(req, res, cached.filePath, {
        contentType: 'audio/wav',
        disposition: 'attachment',
        filename: soundFileName(scriptIndex),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scriptIndex });
    }
    return;
  }

  if (url.pathname === '/api/sound-replace' && req.method === 'POST') {
    const target = url.searchParams.get('path') || defaultTarget;
    const scriptIndex = parseScriptIndex(url.searchParams.get('script'));
    if (scriptIndex === null) {
      sendJson(res, 400, { error: 'Missing or invalid script query parameter', target });
      return;
    }

    const uploadPath = path.join(soundUploadDir, `${Date.now()}-${crypto.randomUUID()}.wav`);

    try {
      const written = await streamRequestToFile(req, uploadPath);
      if (!written) {
        throw new Error('Replacement upload was empty.');
      }

      const inspection = await getInspection(target);
      await replaceNativeSpikeSoundScript(
        target,
        inspection?.spike?.gamePartitionIndex,
        inspection?.spike?.gameRoot,
        scriptIndex,
        uploadPath,
      );
      await invalidateTargetCaches(target);
      sendJson(res, 200, {
        ok: true,
        target,
        scriptIndex,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scriptIndex });
    } finally {
      await unlinkIfExists(uploadPath);
    }
    return;
  }

  if (url.pathname === '/api/asset-metadata' && req.method === 'GET') {
    try {
      assetMetadataCache ??= await readAssetMetadataStore(assetMetadataPath);
      sendJson(res, 200, assetMetadataCache);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === '/api/asset-metadata' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const assetPath = typeof body.assetPath === 'string' ? body.assetPath : '';
      if (!assetPath.trim()) {
        sendJson(res, 400, { error: 'Missing assetPath in request body.' });
        return;
      }

      const metadata = await updateAssetMetadataEntry(assetMetadataPath, assetPath, {
        alias: body.alias,
        description: body.description,
      });
      assetMetadataCache = null;

      sendJson(res, 200, {
        ok: true,
        assetPath: assetPath.trim(),
        metadata,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === '/api/radium-scene' && req.method === 'GET') {
    const target = url.searchParams.get('path') || defaultTarget;
    const scenePath = url.searchParams.get('scene');
    if (!scenePath) {
      sendJson(res, 400, { error: 'Missing scene query parameter', target });
      return;
    }

    const cacheKey = `${target}::${scenePath}`;
    try {
      let result;
      if (radiumSceneCache.has(cacheKey)) {
        result = radiumSceneCache.get(cacheKey);
      } else if (radiumSceneInflight.has(cacheKey)) {
        result = await radiumSceneInflight.get(cacheKey);
      } else {
        const pending = runRawImageWorker(['radium-scene', target, scenePath])
          .then((rawJson) => JSON.parse(rawJson))
          .then((serializable) => {
            radiumSceneCache.set(cacheKey, serializable);
            return serializable;
          })
          .finally(() => radiumSceneInflight.delete(cacheKey));
        radiumSceneInflight.set(cacheKey, pending);
        result = await pending;
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scenePath });
    }
    return;
  }

  if (url.pathname === '/api/radium-image' && req.method === 'GET') {
    const target = url.searchParams.get('path') || defaultTarget;
    const scenePath = url.searchParams.get('scene');
    const imageId = url.searchParams.get('image');
    if (!scenePath || !imageId) {
      sendJson(res, 400, { error: 'Missing scene or image query parameter', target });
      return;
    }

    try {
      const buffer = await runRawImageWorkerBuffer(['radium-image', target, scenePath, imageId]);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buffer);
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scenePath, imageId });
    }
    return;
  }

  if (url.pathname === '/api/video-replace' && req.method === 'POST') {
    const target = url.searchParams.get('path') || defaultTarget;
    const assetPath = url.searchParams.get('asset');
    if (!assetPath) {
      sendJson(res, 400, { error: 'Missing asset query parameter', target });
      return;
    }

    await import('node:fs/promises').then((m) => m.mkdir(videoUploadDir, { recursive: true }));
    const uploadPath = path.join(videoUploadDir, `${Date.now()}-${crypto.randomUUID()}`);

    try {
      const written = await streamRequestToFile(req, uploadPath);
      if (!written) {
        throw new Error('Replacement upload was empty.');
      }

      const result = await runRawImageWorker(['asset-replace', target, assetPath, uploadPath]);
      const parsed = JSON.parse(result);
      await invalidateTargetCaches(target);
      sendJson(res, 200, { ok: true, target, assetPath, ...parsed });
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, assetPath });
    } finally {
      await unlinkIfExists(uploadPath);
    }
    return;
  }

  if (url.pathname === '/api/radium-image-replace' && req.method === 'POST') {
    const target = url.searchParams.get('path') || defaultTarget;
    const scenePath = url.searchParams.get('scene');
    const imageId = url.searchParams.get('image');
    if (!scenePath || !imageId) {
      sendJson(res, 400, { error: 'Missing scene or image query parameter', target });
      return;
    }

    await import('node:fs/promises').then((m) => m.mkdir(imageUploadDir, { recursive: true }));
    const uploadPath = path.join(imageUploadDir, `${Date.now()}-${crypto.randomUUID()}.png`);

    try {
      const written = await streamRequestToFile(req, uploadPath);
      if (!written) {
        throw new Error('Replacement upload was empty.');
      }

      const result = await runRawImageWorker(['radium-image-replace', target, scenePath, imageId, uploadPath]);
      const parsed = JSON.parse(result);

      // Invalidate server-side caches so re-fetches show the new image
      radiumSceneCache.clear();
      for (const key of radiumSceneInflight.keys()) radiumSceneInflight.delete(key);

      sendJson(res, 200, { ok: true, target, scenePath, imageId, ...parsed });
    } catch (error) {
      sendJson(res, 500, { error: error.message, target, scenePath, imageId });
    } finally {
      await unlinkIfExists(uploadPath);
    }
    return;
  }

  await serveStatic(res, url.pathname);
  });
}

// ---------------------------------------------------------------------------
// Standalone mode (node server.js)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  defaultTarget = '/Users/alex/Downloads/pinball/PinballBrowser852/venom_le-0_97_0.Release.8G.sdcard.raw';
  startServer({ port: Number(process.env.PORT || 4274) });
}
