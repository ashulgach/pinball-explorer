import fs from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import zlib from 'node:zlib';

import ext2fs from 'ext2fs';
import imageFs from 'balena-image-fs';
import fileDisk from 'file-disk';
import partitioninfo from 'partitioninfo';

import { inspectNativeSpikeSoundsMounted } from './spike-sound-native.js';
import { parseRadiumScene, collectImageManifest, collectAssetTree } from './radium-parser.js';
import { LRUCache, Semaphore } from './lru-cache.js';

const { interact } = imageFs;
const { FileDisk } = fileDisk;

const RAW_IMAGE_EXTENSIONS = new Set(['.raw', '.img', '.iso']);
const LINUX_PARTITION_TYPES = new Set([0x83]);
const STREAM_CHUNK_SIZE = 256 * 1024;
const IMAGE_CACHE = new Map();
const PARTITION_TABLE_CACHE = new Map();
const PRINTABLE_ASCII_MIN = 0x20;
const PRINTABLE_ASCII_MAX = 0x7e;

const MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.bmp', 'image/bmp'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.m4a', 'audio/mp4'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
]);

function isRawImagePath(targetPath) {
  return RAW_IMAGE_EXTENSIONS.has(path.extname(String(targetPath || '')).toLowerCase());
}

function toPosixAbsolute(filePath) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function trimText(value) {
  return String(value || '').replace(/\0/g, '').trim();
}

function basename(filePath) {
  return path.posix.basename(String(filePath || ''));
}

function contentTypeForPath(filePath) {
  return MIME_TYPES.get(path.posix.extname(String(filePath || '')).toLowerCase()) || 'application/octet-stream';
}

function normalizeMountedPath(filePath) {
  return path.posix.normalize(toPosixAbsolute(filePath));
}

function isPrintableAsciiByte(byte) {
  return byte >= PRINTABLE_ASCII_MIN && byte <= PRINTABLE_ASCII_MAX;
}

function isKnownSceneType(value) {
  return ['Bitmap', 'Font', 'Spine', 'Sprite', 'StreamingFlipbook', 'Video'].includes(value);
}

function looksLikeVideoReference(value) {
  return /^[^/]+\.asset\/[^/]+\.asset$/i.test(value);
}

function looksLikeFlipbookFrameReference(value) {
  return /^\d+\.asset$/i.test(value);
}

function resolveSceneAssetReference(sceneDir, reference, assetMap) {
  const candidates = [
    normalizeMountedPath(path.posix.join(sceneDir, reference)),
    normalizeMountedPath(path.posix.join(sceneDir, 'scene.assets', reference)),
  ];

  for (const candidate of candidates) {
    if (assetMap.has(candidate)) return candidate;
  }

  return null;
}

function sniffBufferContent(buffer) {
  if (!buffer || !buffer.length) {
    return {
      kind: 'data',
      format: 'asset',
      contentType: 'application/octet-stream',
      previewKind: null,
      previewable: false,
    };
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      kind: 'image',
      format: 'png',
      contentType: 'image/png',
      previewKind: 'image',
      previewable: true,
    };
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'qt  ') {
      return {
        kind: 'video',
        format: 'mov',
        contentType: 'video/quicktime',
        previewKind: 'video',
        previewable: true,
      };
    }
    if (brand === 'mp42' || brand === 'isom') {
      return {
        kind: 'video',
        format: 'mp4',
        contentType: 'video/mp4',
        previewKind: 'video',
        previewable: true,
      };
    }
  }

  return {
    kind: 'data',
    format: 'asset',
    contentType: 'application/octet-stream',
    previewKind: null,
    previewable: false,
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

// Radium image format codes (confirmed from ske-radium/radium-player.py loadTex):
//   4 → DXT1 (GL_COMPRESSED_RGBA_S3TC_DXT1_EXT)
//   5 → DXT5 (GL_COMPRESSED_RGBA_S3TC_DXT5_EXT)

function rgb565(c) {
  return [
    ((c >> 11) & 0x1f) * 255 / 31 | 0,
    ((c >> 5) & 0x3f) * 255 / 63 | 0,
    (c & 0x1f) * 255 / 31 | 0,
  ];
}

function decodeDXT1Block(src, srcOffset, dst, dstX, dstY, width) {
  const c0v = src.readUInt16LE(srcOffset);
  const c1v = src.readUInt16LE(srcOffset + 2);
  const indices = src.readUInt32LE(srcOffset + 4);
  const [r0, g0, b0] = rgb565(c0v);
  const [r1, g1, b1] = rgb565(c1v);
  const colors = c0v > c1v ? [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [(2 * r0 + r1) / 3 | 0, (2 * g0 + g1) / 3 | 0, (2 * b0 + b1) / 3 | 0, 255],
    [(r0 + 2 * r1) / 3 | 0, (g0 + 2 * g1) / 3 | 0, (b0 + 2 * b1) / 3 | 0, 255],
  ] : [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [(r0 + r1) / 2 | 0, (g0 + g1) / 2 | 0, (b0 + b1) / 2 | 0, 255],
    [0, 0, 0, 0],
  ];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const [r, g, b, a] = colors[(indices >>> (2 * (y * 4 + x))) & 3];
      const pos = ((dstY + y) * width + (dstX + x)) * 4;
      dst[pos] = r; dst[pos + 1] = g; dst[pos + 2] = b; dst[pos + 3] = a;
    }
  }
}

function decodeDXT5Block(src, srcOffset, dst, dstX, dstY, width) {
  const a0 = src[srcOffset];
  const a1 = src[srcOffset + 1];
  const alphas = a0 > a1 ? [
    a0, a1,
    ((6 * a0 + a1) / 7) | 0, ((5 * a0 + 2 * a1) / 7) | 0,
    ((4 * a0 + 3 * a1) / 7) | 0, ((3 * a0 + 4 * a1) / 7) | 0,
    ((2 * a0 + 5 * a1) / 7) | 0, ((a0 + 6 * a1) / 7) | 0,
  ] : [
    a0, a1,
    ((4 * a0 + a1) / 5) | 0, ((3 * a0 + 2 * a1) / 5) | 0,
    ((2 * a0 + 3 * a1) / 5) | 0, ((a0 + 4 * a1) / 5) | 0,
    0, 255,
  ];
  const c0v = src.readUInt16LE(srcOffset + 8);
  const c1v = src.readUInt16LE(srcOffset + 10);
  const cIndices = src.readUInt32LE(srcOffset + 12);
  const [r0, g0, b0] = rgb565(c0v);
  const [r1, g1, b1] = rgb565(c1v);
  const colors = [
    [r0, g0, b0],
    [r1, g1, b1],
    [(2 * r0 + r1) / 3 | 0, (2 * g0 + g1) / 3 | 0, (2 * b0 + b1) / 3 | 0],
    [(r0 + 2 * r1) / 3 | 0, (g0 + 2 * g1) / 3 | 0, (b0 + 2 * b1) / 3 | 0],
  ];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const i = y * 4 + x;
      const bit = i * 3;
      const bOff = srcOffset + 2 + (bit >> 3);
      const aIdx = ((src[bOff] | ((bit >> 3) + 1 < 6 ? src[bOff + 1] << 8 : 0)) >> (bit & 7)) & 7;
      const [r, g, b] = colors[(cIndices >>> (2 * i)) & 3];
      const a = alphas[aIdx];
      const pos = ((dstY + y) * width + (dstX + x)) * 4;
      dst[pos] = r; dst[pos + 1] = g; dst[pos + 2] = b; dst[pos + 3] = a;
    }
  }
}

function decodeDXT1(buffer, width, height) {
  const output = Buffer.alloc(width * height * 4);
  const tilesAcross = (width + 3) >> 2;
  const tilesDown = (height + 3) >> 2;
  for (let ty = 0; ty < tilesDown; ty += 1) {
    for (let tx = 0; tx < tilesAcross; tx += 1) {
      decodeDXT1Block(buffer, (ty * tilesAcross + tx) * 8, output, tx * 4, ty * 4, width);
    }
  }
  return output;
}

function decodeDXT5(buffer, width, height) {
  const output = Buffer.alloc(width * height * 4);
  const tilesAcross = (width + 3) >> 2;
  const tilesDown = (height + 3) >> 2;
  for (let ty = 0; ty < tilesDown; ty += 1) {
    for (let tx = 0; tx < tilesAcross; tx += 1) {
      decodeDXT5Block(buffer, (ty * tilesAcross + tx) * 16, output, tx * 4, ty * 4, width);
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// DXT encoding — RGBA → DXT1/DXT5 (matching the decode direction above)
// ---------------------------------------------------------------------------

function packRgb565(r, g, b) {
  return ((r * 31 / 255 + 0.5 | 0) << 11) | ((g * 63 / 255 + 0.5 | 0) << 5) | (b * 31 / 255 + 0.5 | 0);
}

function colorDistance(r0, g0, b0, r1, g1, b1) {
  const dr = r0 - r1, dg = g0 - g1, db = b0 - b1;
  return dr * dr + dg * dg + db * db;
}

function encodeDXT1Block(pixels, pixOffset, width, dst, dstOffset) {
  // Extract 4x4 block colors
  const block = new Uint8Array(16 * 4);
  let hasTransparent = false;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const src = (pixOffset + y * width + x) * 4;
      const d = (y * 4 + x) * 4;
      block[d] = pixels[src]; block[d + 1] = pixels[src + 1];
      block[d + 2] = pixels[src + 2]; block[d + 3] = pixels[src + 3];
      if (pixels[src + 3] < 128) hasTransparent = true;
    }
  }

  // Find min/max colors (simple bounding box)
  let minR = 255, minG = 255, minB = 255;
  let maxR = 0, maxG = 0, maxB = 0;
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4], g = block[i * 4 + 1], b = block[i * 4 + 2];
    if (block[i * 4 + 3] < 128 && hasTransparent) continue;
    if (r < minR) minR = r; if (g < minG) minG = g; if (b < minB) minB = b;
    if (r > maxR) maxR = r; if (g > maxG) maxG = g; if (b > maxB) maxB = b;
  }

  let c0 = packRgb565(maxR, maxG, maxB);
  let c1 = packRgb565(minR, minG, minB);

  // For 4-color mode c0 > c1; for transparent mode c0 <= c1
  if (!hasTransparent && c0 < c1) { const tmp = c0; c0 = c1; c1 = tmp; }
  if (hasTransparent && c0 > c1) { const tmp = c0; c0 = c1; c1 = tmp; }
  if (c0 === c1 && !hasTransparent) { c0 = Math.min(c0 + 1, 0xFFFF); }

  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);

  let palette;
  if (c0 > c1) {
    palette = [
      [r0, g0, b0], [r1, g1, b1],
      [(2 * r0 + r1) / 3 | 0, (2 * g0 + g1) / 3 | 0, (2 * b0 + b1) / 3 | 0],
      [(r0 + 2 * r1) / 3 | 0, (g0 + 2 * g1) / 3 | 0, (b0 + 2 * b1) / 3 | 0],
    ];
  } else {
    palette = [
      [r0, g0, b0], [r1, g1, b1],
      [(r0 + r1) / 2 | 0, (g0 + g1) / 2 | 0, (b0 + b1) / 2 | 0],
      [0, 0, 0],  // transparent
    ];
  }

  // Find closest palette entry for each pixel
  let indices = 0;
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4], g = block[i * 4 + 1], b = block[i * 4 + 2], a = block[i * 4 + 3];
    let best = 0, bestDist = Infinity;
    if (hasTransparent && a < 128) {
      best = 3;
    } else {
      for (let p = 0; p < (hasTransparent ? 3 : 4); p++) {
        const d = colorDistance(r, g, b, palette[p][0], palette[p][1], palette[p][2]);
        if (d < bestDist) { bestDist = d; best = p; }
      }
    }
    indices |= (best << (2 * i));
  }

  dst.writeUInt16LE(c0, dstOffset);
  dst.writeUInt16LE(c1, dstOffset + 2);
  dst.writeUInt32LE(indices >>> 0, dstOffset + 4);
}

function encodeDXT5Block(pixels, pixOffset, width, dst, dstOffset) {
  // Extract 4x4 block
  const block = new Uint8Array(16 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const src = (pixOffset + y * width + x) * 4;
      const d = (y * 4 + x) * 4;
      block[d] = pixels[src]; block[d + 1] = pixels[src + 1];
      block[d + 2] = pixels[src + 2]; block[d + 3] = pixels[src + 3];
    }
  }

  // Alpha: find min/max
  let minA = 255, maxA = 0;
  for (let i = 0; i < 16; i++) {
    const a = block[i * 4 + 3];
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }

  const a0 = maxA, a1 = minA;
  let alphas;
  if (a0 > a1) {
    alphas = [a0, a1,
      ((6 * a0 + a1) / 7) | 0, ((5 * a0 + 2 * a1) / 7) | 0,
      ((4 * a0 + 3 * a1) / 7) | 0, ((3 * a0 + 4 * a1) / 7) | 0,
      ((2 * a0 + 5 * a1) / 7) | 0, ((a0 + 6 * a1) / 7) | 0,
    ];
  } else {
    alphas = [a0, a1,
      ((4 * a0 + a1) / 5) | 0, ((3 * a0 + 2 * a1) / 5) | 0,
      ((2 * a0 + 3 * a1) / 5) | 0, ((a0 + 4 * a1) / 5) | 0,
      0, 255,
    ];
  }

  // Find closest alpha index for each pixel
  const alphaIndices = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const a = block[i * 4 + 3];
    let best = 0, bestDist = Infinity;
    for (let p = 0; p < 8; p++) {
      const d = Math.abs(a - alphas[p]);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    alphaIndices[i] = best;
  }

  // Write alpha: 2 reference bytes + 6 bytes of 3-bit indices (48 bits for 16 pixels)
  dst[dstOffset] = a0;
  dst[dstOffset + 1] = a1;
  // Pack 16 3-bit alpha indices into 6 bytes (48 bits)
  let alphaBits = 0n;
  for (let i = 0; i < 16; i++) {
    alphaBits |= BigInt(alphaIndices[i]) << BigInt(i * 3);
  }
  for (let b = 0; b < 6; b++) {
    dst[dstOffset + 2 + b] = Number((alphaBits >> BigInt(b * 8)) & 0xFFn);
  }

  // Color: same as DXT1 (always 4-color mode)
  let minR = 255, minG = 255, minB = 255;
  let maxR = 0, maxG = 0, maxB = 0;
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4], g = block[i * 4 + 1], b = block[i * 4 + 2];
    if (r < minR) minR = r; if (g < minG) minG = g; if (b < minB) minB = b;
    if (r > maxR) maxR = r; if (g > maxG) maxG = g; if (b > maxB) maxB = b;
  }

  let c0 = packRgb565(maxR, maxG, maxB);
  let c1 = packRgb565(minR, minG, minB);
  if (c0 < c1) { const tmp = c0; c0 = c1; c1 = tmp; }
  if (c0 === c1) { c0 = Math.min(c0 + 1, 0xFFFF); }

  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  const palette = [
    [r0, g0, b0], [r1, g1, b1],
    [(2 * r0 + r1) / 3 | 0, (2 * g0 + g1) / 3 | 0, (2 * b0 + b1) / 3 | 0],
    [(r0 + 2 * r1) / 3 | 0, (g0 + 2 * g1) / 3 | 0, (b0 + 2 * b1) / 3 | 0],
  ];

  let colorIndices = 0;
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4], g = block[i * 4 + 1], b = block[i * 4 + 2];
    let best = 0, bestDist = Infinity;
    for (let p = 0; p < 4; p++) {
      const d = colorDistance(r, g, b, palette[p][0], palette[p][1], palette[p][2]);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    colorIndices |= (best << (2 * i));
  }

  dst.writeUInt16LE(c0, dstOffset + 8);
  dst.writeUInt16LE(c1, dstOffset + 10);
  dst.writeUInt32LE(colorIndices >>> 0, dstOffset + 12);
}

function encodeDXT1(pixels, width, height) {
  const tilesAcross = (width + 3) >> 2;
  const tilesDown = (height + 3) >> 2;
  const output = Buffer.alloc(tilesAcross * tilesDown * 8);
  for (let ty = 0; ty < tilesDown; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      encodeDXT1Block(pixels, ty * 4 * width + tx * 4, width, output, (ty * tilesAcross + tx) * 8);
    }
  }
  return output;
}

function encodeDXT5(pixels, width, height) {
  const tilesAcross = (width + 3) >> 2;
  const tilesDown = (height + 3) >> 2;
  const output = Buffer.alloc(tilesAcross * tilesDown * 16);
  for (let ty = 0; ty < tilesDown; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      encodeDXT5Block(pixels, ty * 4 * width + tx * 4, width, output, (ty * tilesAcross + tx) * 16);
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// PNG decoding — extract RGBA pixels from a PNG buffer
// ---------------------------------------------------------------------------

function decodePngToRgba(pngBuffer) {
  // Validate PNG signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (pngBuffer[i] !== sig[i]) throw new Error('Invalid PNG signature');
  }

  let width, height, bitDepth, colorType;
  const idatChunks = [];
  let offset = 8;

  while (offset < pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');

    if (type === 'IHDR') {
      width = pngBuffer.readUInt32BE(offset + 8);
      height = pngBuffer.readUInt32BE(offset + 12);
      bitDepth = pngBuffer[offset + 16];
      colorType = pngBuffer[offset + 17];
    } else if (type === 'IDAT') {
      idatChunks.push(pngBuffer.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length; // 4 (length) + 4 (type) + length + 4 (crc)
  }

  if (!width || !height) throw new Error('PNG missing IHDR');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth} (only 8-bit supported)`);

  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);

  const rgba = Buffer.alloc(width * height * 4);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = 1 + width * bpp; // filter byte + pixel data

  // Unfilter
  const unfiltered = Buffer.alloc(height * width * bpp);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * stride];
    const rowStart = y * stride + 1;
    const outRow = y * width * bpp;
    const prevRow = (y - 1) * width * bpp;

    for (let x = 0; x < width * bpp; x++) {
      const rawByte = raw[rowStart + x];
      const a = x >= bpp ? unfiltered[outRow + x - bpp] : 0;
      const b = y > 0 ? unfiltered[prevRow + x] : 0;
      const c = (x >= bpp && y > 0) ? unfiltered[prevRow + x - bpp] : 0;

      let decoded;
      switch (filterType) {
        case 0: decoded = rawByte; break;
        case 1: decoded = (rawByte + a) & 0xFF; break;
        case 2: decoded = (rawByte + b) & 0xFF; break;
        case 3: decoded = (rawByte + ((a + b) >> 1)) & 0xFF; break;
        case 4: { // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          decoded = (rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
          break;
        }
        default: throw new Error(`Unknown PNG filter type: ${filterType}`);
      }
      unfiltered[outRow + x] = decoded;
    }
  }

  // Convert to RGBA
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * bpp;
      const dst = (y * width + x) * 4;
      if (colorType === 6) { // RGBA
        rgba[dst] = unfiltered[src]; rgba[dst + 1] = unfiltered[src + 1];
        rgba[dst + 2] = unfiltered[src + 2]; rgba[dst + 3] = unfiltered[src + 3];
      } else if (colorType === 2) { // RGB
        rgba[dst] = unfiltered[src]; rgba[dst + 1] = unfiltered[src + 1];
        rgba[dst + 2] = unfiltered[src + 2]; rgba[dst + 3] = 255;
      } else if (colorType === 4) { // Gray+Alpha
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = unfiltered[src];
        rgba[dst + 3] = unfiltered[src + 1];
      } else { // Grayscale
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = unfiltered[src];
        rgba[dst + 3] = 255;
      }
    }
  }

  return { width, height, pixels: rgba };
}

function encodeRgbaPng(width, height, pixels) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const srcStart = y * width * 4;
    const destStart = y * stride;
    raw[destStart] = 0;
    pixels.copy(raw, destStart + 1, srcStart, srcStart + width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([signature, makePngChunk('IHDR', ihdr), makePngChunk('IDAT', idat), makePngChunk('IEND', Buffer.alloc(0))]);
}

function encodeGrayPng(width, height, pixels) {
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * width;
    const destStart = y * stride;
    raw[destStart] = 0;
    pixels.copy(raw, destStart + 1, sourceStart, sourceStart + width);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function untile4x4Gray8(buffer, width, height) {
  if (width % 4 !== 0 || height % 4 !== 0) {
    return Buffer.from(buffer);
  }

  const output = Buffer.alloc(buffer.length);
  const tilesAcross = width / 4;
  const tileSize = 16;

  for (let tileIndex = 0; tileIndex * tileSize < buffer.length; tileIndex += 1) {
    const tileOffset = tileIndex * tileSize;
    const tileX = (tileIndex % tilesAcross) * 4;
    const tileY = Math.floor(tileIndex / tilesAcross) * 4;

    for (let localY = 0; localY < 4; localY += 1) {
      for (let localX = 0; localX < 4; localX += 1) {
        const sourceIndex = tileOffset + (localY * 4) + localX;
        const destIndex = ((tileY + localY) * width) + tileX + localX;
        if (sourceIndex < buffer.length && destIndex < output.length) {
          output[destIndex] = buffer[sourceIndex];
        }
      }
    }
  }

  return output;
}

function extractTaggedStrings(buffer) {
  const strings = [];

  for (let offset = 0; offset + 12 <= buffer.length; offset += 1) {
    const tag = buffer.readUInt32LE(offset);
    if ((tag >>> 24) !== 0x80) continue;

    const length = Number(buffer.readBigUInt64LE(offset + 4));
    if (!Number.isFinite(length) || length <= 0 || length > 512) continue;

    const stringStart = offset + 12;
    const stringEnd = stringStart + length;
    if (stringEnd > buffer.length) continue;

    let ascii = true;
    for (let i = stringStart; i < stringEnd; i += 1) {
      const byte = buffer[i];
      if (byte === 0 || isPrintableAsciiByte(byte)) continue;
      ascii = false;
      break;
    }

    if (!ascii) continue;

    const value = trimText(buffer.subarray(stringStart, stringEnd).toString('ascii'));
    if (!value) continue;

    strings.push({
      value,
      offset: stringStart,
    });
  }

  return strings;
}

function describeSourceSupport(targetPath) {
  const extension = path.extname(String(targetPath || '')).toLowerCase();
  if (RAW_IMAGE_EXTENSIONS.has(extension)) {
    return {
      driver: 'mounted-raw-image',
      mode: 'image',
      status: 'supported',
      note: 'Pinball Explorer mounts /game and /etc directly from the raw image and reads files through stream-backed filesystem handles.',
    };
  }

  if (extension === '.spk' || extension === '.000') {
    return {
      driver: 'mounted-raw-image',
      mode: 'deprecated',
      status: 'rejected',
      note: 'This standalone web app supports mounted raw SD images only.',
    };
  }

  return {
    driver: 'unknown',
    mode: 'unknown',
    status: 'unsupported',
    note: 'Pinball Explorer currently supports mounted raw SD images only.',
  };
}

async function statHostPath(targetPath) {
  const st = await fs.stat(targetPath);
  return {
    resolvedPath: await fs.realpath(targetPath),
    size: st.size,
    mtimeMs: st.mtimeMs,
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

async function readSmallMountedTextFile(mountedFs, mountedPath) {
  const data = await mountedFs.promises.readFile(mountedPath, 'utf8');
  return trimText(data);
}

async function discoverGameRoot(mountedFs) {
  if (await mountedExists(mountedFs, '/game')) {
    try {
      const gameLink = await mountedFs.promises.readlink('/game');
      const candidate = toPosixAbsolute(gameLink).replace(/\/game$/, '');
      if (candidate && await mountedExists(mountedFs, `${candidate}/assets`) && await mountedExists(mountedFs, `${candidate}/image.bin`)) {
        return candidate;
      }
    } catch {
      // Ignore symlink resolution failures and fall back to directory probing.
    }
  }

  const rootEntries = (await mountedFs.promises.readdir('/')).sort();
  for (const entry of rootEntries) {
    if (entry === 'lost+found' || entry === 'spk' || entry === 'game' || entry === 'conagent') continue;
    const candidate = `/${entry}`;
    try {
      const stats = await mountedFs.promises.stat(candidate);
      if (!stats.isDirectory()) continue;
      if (await mountedExists(mountedFs, `${candidate}/assets`) && await mountedExists(mountedFs, `${candidate}/image.bin`)) {
        return candidate;
      }
    } catch {
      // Skip entries that cannot be inspected.
    }
  }

  return null;
}

async function collectAssetFilesFromMountedFs(mountedFs, assetRoot) {
  const files = [];
  const stack = [assetRoot];

  while (stack.length) {
    const currentDir = stack.pop();
    const entries = (await mountedFs.promises.readdir(currentDir)).sort();

    for (const entry of entries) {
      const mountedPath = path.posix.join(currentDir, entry);
      let stats;
      try {
        stats = await mountedFs.promises.lstat(mountedPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        stack.push(mountedPath);
        continue;
      }

      if (!stats.isFile()) continue;

      const classified = classifyAsset(mountedPath);

      // Sniff .asset file headers inline to avoid separate interact() calls.
      if (path.posix.extname(mountedPath).toLowerCase() === '.asset') {
        try {
          const handle = await mountedFs.promises.open(mountedPath, 'r');
          try {
            const headerBuf = Buffer.alloc(32);
            await handle.read(headerBuf, 0, 32, 0);
            Object.assign(classified, sniffBufferContent(headerBuf));
          } finally {
            await handle.close();
          }
        } catch {
          // Keep the generic .asset classification if sniffing fails.
        }
      }

      files.push({
        path: mountedPath,
        entryName: basename(mountedPath),
        size: stats.size,
        storedSize: stats.size,
        offset: null,
        detectionSource: 'mounted-filesystem',
        ...classified,
      });
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

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

function classifyAsset(assetPath) {
  const ext = path.posix.extname(assetPath).toLowerCase();
  const contentType = contentTypeForPath(assetPath);
  const sceneAssetIndex = assetPath.indexOf('/scene.assets/');

  let kind = 'data';
  let format = ext ? ext.slice(1) : 'unknown';
  let previewKind = null;
  let previewable = false;
  let scenePath = null;
  let sceneType = null;

  if (ext === '.radium') {
    kind = 'scene';
    format = 'radium';
    scenePath = assetPath;
    sceneType = 'RawScene';
  } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) {
    kind = 'image';
    previewKind = 'image';
    previewable = true;
  } else if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
    kind = 'font';
    previewable = true;
  } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
    kind = 'audio';
    previewKind = 'audio';
    previewable = true;
  } else if (['.mp4', '.webm'].includes(ext)) {
    kind = 'video';
    previewKind = 'video';
    previewable = true;
  } else if (ext === '.asset') {
    kind = 'data';
    format = 'asset';
  }

  if (!scenePath && sceneAssetIndex >= 0) {
    scenePath = `${assetPath.slice(0, sceneAssetIndex)}/scene.radium`;
    sceneType = 'MountedScene';
  }

  return {
    kind,
    format,
    contentType,
    previewKind,
    previewable,
    scenePath,
    sceneType,
  };
}

// Maximum bytes to read in a single interact() session.  The ext2fs WASM
// module has a fixed 16 MB heap; keeping each mount+read cycle well under
// that limit avoids "Aborted(OOM)" for large files.  The filesystem metadata
// overhead is typically 2-4 MB, so 4 MB of payload per session is safe.
const READ_CHUNK_LIMIT = 4 * 1024 * 1024;

async function readMountedFileRangeByResolvedPath(resolvedPath, partitionIndex, mountedPath, start = 0, end = null) {
  const finalStart = Math.max(0, Number(start) || 0);
  const explicitEnd = end === null || end === undefined ? null : Math.max(-1, Number(end));
  let finalEnd = explicitEnd;

  // Only stat when the caller did not already provide the byte range.
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

  // Small files: read in a single interact() session (no overhead from extra mounts).
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

  // Large files: read in chunks across separate interact() sessions so the
  // WASM heap is freed between chunks, preventing OOM.
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
    if (chunk.length < chunkLength) break; // EOF before expected end
    offset = chunkEnd + 1;
  }

  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
}

async function sniffAssetMetadataByPath(resolvedPath, partitionIndex, mountedPath) {
  const ext = path.posix.extname(mountedPath).toLowerCase();
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

function buildAssetManifest(assetFiles) {
  const byKind = {};
  const paths = assetFiles.map((asset) => asset.path);

  for (const asset of assetFiles) {
    byKind[asset.kind] = (byKind[asset.kind] || 0) + 1;
  }

  return {
    totalPaths: paths.length,
    paths,
    gameAssets: paths,
    likelyAssets: paths,
    byKind,
  };
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
  const sceneDir = path.posix.dirname(normalizedScenePath);

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

      // Format code at offset-16: 4=DXT1, 5=DXT5 (per ske-radium loadTex mapping)
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

  // Fallback for unrecognised format codes: untile 4×4 blocks and treat as gray8
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

// Bounded caches and concurrency control for radium scene/image operations.
// - radiumParseCache: keeps at most 10 parsed scenes (composition + raw image buffers)
// - imageRenderCache: rendered PNGs with ~200 MB byte-size ceiling
// - interactSemaphore: limits concurrent balena-image-fs interact() calls — each one
//   mounts the WASM ext2fs driver which shares a fixed heap; too many concurrent mounts
//   cause "Aborted(OOM)" from the Emscripten runtime
const radiumParseCache = new LRUCache(10);
const imageRenderCache = new LRUCache(0, 200 * 1024 * 1024); // 200 MB byte-size limit
// The ext2fs WASM module has a fixed 16 MB heap that cannot grow.  Every
// balena-image-fs interact() call mounts the filesystem inside that heap.
// Concurrent mounts share the same 16 MB and crash with "Aborted(OOM)".
// We serialize ALL interact() paths (scene parsing + image rendering)
// through a single semaphore to ensure only one mount is active at a time.
// Large file reads are chunked across separate interact() sessions (see
// readMountedFileRangeByResolvedPath) so each mount stays within the heap.
const interactSemaphore = new Semaphore(1);

// In-flight deduplication for parseRadiumSceneFull — prevents N concurrent
// image requests from each triggering their own scene parse + interact().
const parseInflight = new Map();

export async function parseRadiumSceneFull(targetPath, scenePath) {
  const cacheKey = `${targetPath}::${scenePath}`;
  if (radiumParseCache.has(cacheKey)) {
    return radiumParseCache.get(cacheKey);
  }

  // Deduplicate: if a parse for this scene is already in flight, wait for it
  if (parseInflight.has(cacheKey)) {
    return parseInflight.get(cacheKey);
  }

  const pending = (async () => {
    await interactSemaphore.acquire();
    try {
      // Re-check cache after acquiring semaphore
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

      const sceneDir = path.posix.dirname(normalizedScenePath);

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
  // Check the rendered-image cache first (avoids re-decoding)
  const renderCacheKey = `${targetPath}::${scenePath}::${imageId}`;
  const cached = imageRenderCache.get(renderCacheKey);
  if (cached) return cached;

  // Resolve the parsed scene first — this has its own semaphore handling
  // internally, so we must NOT hold the semaphore here (would deadlock).
  const parsed = await parseRadiumSceneFull(targetPath, scenePath);
  const imageEntry = parsed._parseResult.images[imageId];

  if (!imageEntry) {
    throw new Error(`Image not found: ${imageId}`);
  }

  let result;

  if (imageEntry.isExternal) {
    // External images need interact() to read from the mounted filesystem.
    // Acquire the semaphore to prevent concurrent WASM mounts.
    await interactSemaphore.acquire();
    try {
      // Re-check cache — another request may have rendered it while we waited
      const cached2 = imageRenderCache.get(renderCacheKey);
      if (cached2) return cached2;

      const context = await getImageContext(targetPath);
      const assetPath = normalizeMountedPath(
        path.posix.join(parsed.sceneDir, 'scene.assets', imageEntry.fileName),
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
    // Embedded images — raw DXT buffer is already in memory, no interact() needed.
    // No semaphore required; just CPU-bound decode work.
    const cached2 = imageRenderCache.get(renderCacheKey);
    if (cached2) return cached2;

    const raw = imageEntry.rawBuffer;
    if (!raw) {
      throw new Error(`No raw buffer for embedded image: ${imageId}`);
    }

    result = decodeDxtToPng(raw, imageEntry.width, imageEntry.height, imageEntry.format);

    // Evict the raw DXT buffer after rendering — the PNG is now cached and the
    // raw bytes can be re-parsed from the scene file if the cache entry is evicted.
    imageEntry.rawBuffer = null;
  }

  // Tag with byte size so the LRU can enforce its byte-size ceiling
  result._byteSize = result.buffer.length;
  imageRenderCache.set(renderCacheKey, result);
  return result;
}

function decodeDxtToPng(raw, width, height, format) {
  if (format === 5) {
    const rgba = decodeDXT5(raw, width, height);
    return { contentType: 'image/png', buffer: encodeRgbaPng(width, height, rgba) };
  }
  if (format === 4) {
    const rgba = decodeDXT1(raw, width, height);
    return { contentType: 'image/png', buffer: encodeRgbaPng(width, height, rgba) };
  }
  throw new Error(`Unsupported image format: ${format}`);
}

function encodeRgbaToDxt(pixels, width, height, format) {
  if (format === 5) return encodeDXT5(pixels, width, height);
  if (format === 4) return encodeDXT1(pixels, width, height);
  throw new Error(`Unsupported DXT format for encoding: ${format}`);
}

function expectedDxtSize(width, height, format) {
  const tilesAcross = (width + 3) >> 2;
  const tilesDown = (height + 3) >> 2;
  const blockSize = format === 5 ? 16 : 8;
  return tilesAcross * tilesDown * blockSize;
}

async function interactPartitionWritable(imagePath, partitionIndex, fn) {
  const partition = await getPartitionInfo(imagePath, partitionIndex);
  // balena-image-fs interact() supports writes natively — the mounted fs
  // provides 'r+' mode file handles.  The ext2fs direct-mount path opens
  // read-only, so we always use interact() for write operations.
  return interact(imagePath, partition.index, fn);
}

export async function replaceRadiumImage(targetPath, scenePath, imageId, pngBuffer) {
  // 1. Parse the scene to get image entry metadata
  const parsed = await parseRadiumSceneFull(targetPath, scenePath);
  const imageEntry = parsed._parseResult.images[imageId];
  if (!imageEntry) {
    throw new Error(`Image not found in scene: ${imageId}`);
  }

  // 2. Decode uploaded PNG to RGBA pixels
  const png = decodePngToRgba(pngBuffer);

  // 3. Validate dimensions match exactly
  if (png.width !== imageEntry.width || png.height !== imageEntry.height) {
    throw new Error(
      `Dimension mismatch: replacement is ${png.width}\u00D7${png.height} ` +
      `but original is ${imageEntry.width}\u00D7${imageEntry.height}. ` +
      `Replacement must have identical dimensions.`,
    );
  }

  // 4. Encode RGBA → DXT (matching original format)
  const dxtData = encodeRgbaToDxt(png.pixels, png.width, png.height, imageEntry.format);

  // 5. Validate encoded size matches expected slot size
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
      // 6a. External image — overwrite the asset file directly
      const assetPath = normalizeMountedPath(
        path.posix.join(parsed.sceneDir, 'scene.assets', imageEntry.fileName),
      );
      const asset = context.assetMap.get(assetPath);
      if (!asset) {
        throw new Error(`External image asset file not found: ${assetPath}`);
      }

      // Validate the DXT data fits the existing file size
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
      // 6b. Embedded image — patch bytes within the scene .radium file
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

  // 7. Invalidate caches so the next read shows the replacement
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
