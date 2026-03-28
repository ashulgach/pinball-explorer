/**
 * raw-image-core.js — Pure functions shared between Node and browser backends.
 *
 * Contains: DXT codec, PNG encode/decode, asset sniffing, classification,
 * and utility functions. No Node-specific imports — uses fflate for zlib.
 */

import { deflateSync, inflateSync } from 'fflate';

// Re-export for consumers
export { deflateSync, inflateSync };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RAW_IMAGE_EXTENSIONS = new Set(['.raw', '.img', '.iso']);
export const LINUX_PARTITION_TYPES = new Set([0x83]);
export const STREAM_CHUNK_SIZE = 256 * 1024;
export const READ_CHUNK_LIMIT = 4 * 1024 * 1024;

const PRINTABLE_ASCII_MIN = 0x20;
const PRINTABLE_ASCII_MAX = 0x7e;

export const MIME_TYPES = new Map([
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

// ---------------------------------------------------------------------------
// Path utilities (use posix-style paths; caller provides path.posix or shim)
// ---------------------------------------------------------------------------

export function posixBasename(filePath) {
  const parts = String(filePath || '').split('/');
  return parts[parts.length - 1] || '';
}

export function posixExtname(filePath) {
  const base = posixBasename(filePath);
  const dotIndex = base.lastIndexOf('.');
  return dotIndex <= 0 ? '' : base.slice(dotIndex);
}

export function posixDirname(filePath) {
  const parts = String(filePath || '').split('/');
  parts.pop();
  const dir = parts.join('/');
  return dir || (filePath && filePath.startsWith('/') ? '/' : '.');
}

export function posixJoin(...parts) {
  return posixNormalize(parts.filter(Boolean).join('/'));
}

export function posixNormalize(p) {
  const parts = String(p || '').split('/');
  const result = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..' && result.length > 0 && result[result.length - 1] !== '..') {
      result.pop();
    } else {
      result.push(part);
    }
  }
  const normalized = result.join('/');
  return String(p).startsWith('/') ? '/' + normalized : normalized || '.';
}

// ---------------------------------------------------------------------------
// String / classification utilities
// ---------------------------------------------------------------------------

export function toPosixAbsolute(filePath) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function trimText(value) {
  return String(value || '').replace(/\0/g, '').trim();
}

export function basename(filePath) {
  return posixBasename(String(filePath || ''));
}

export function contentTypeForPath(filePath) {
  return MIME_TYPES.get(posixExtname(String(filePath || '')).toLowerCase()) || 'application/octet-stream';
}

export function normalizeMountedPath(filePath) {
  return posixNormalize(toPosixAbsolute(filePath));
}

export function isRawImagePath(targetPath) {
  return RAW_IMAGE_EXTENSIONS.has(posixExtname(String(targetPath || '')).toLowerCase());
}

export function isPrintableAsciiByte(byte) {
  return byte >= PRINTABLE_ASCII_MIN && byte <= PRINTABLE_ASCII_MAX;
}

export function isKnownSceneType(value) {
  return ['Bitmap', 'Font', 'Spine', 'Sprite', 'StreamingFlipbook', 'Video'].includes(value);
}

export function looksLikeVideoReference(value) {
  return /^[^/]+\.asset\/[^/]+\.asset$/i.test(value);
}

export function looksLikeFlipbookFrameReference(value) {
  return /^\d+\.asset$/i.test(value);
}

export function resolveSceneAssetReference(sceneDir, reference, assetMap) {
  const candidates = [
    normalizeMountedPath(posixJoin(sceneDir, reference)),
    normalizeMountedPath(posixJoin(sceneDir, 'scene.assets', reference)),
  ];

  for (const candidate of candidates) {
    if (assetMap.has(candidate)) return candidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Buffer sniffing
// ---------------------------------------------------------------------------

export function sniffBufferContent(buffer) {
  if (!buffer || !buffer.length) {
    return {
      kind: 'data',
      format: 'asset',
      contentType: 'application/octet-stream',
      previewKind: null,
      previewable: false,
    };
  }

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8) {
    let isPng = true;
    for (let i = 0; i < 8; i++) {
      if (buffer[i] !== PNG_SIG[i]) { isPng = false; break; }
    }
    if (isPng) {
      return {
        kind: 'image',
        format: 'png',
        contentType: 'image/png',
        previewKind: 'image',
        previewable: true,
      };
    }
  }

  if (buffer.length >= 12) {
    const ftyp = String.fromCharCode(buffer[4], buffer[5], buffer[6], buffer[7]);
    if (ftyp === 'ftyp') {
      const brand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
      if (brand === 'qt  ') {
        return { kind: 'video', format: 'mov', contentType: 'video/quicktime', previewKind: 'video', previewable: true };
      }
      if (brand === 'mp42' || brand === 'isom') {
        return { kind: 'video', format: 'mp4', contentType: 'video/mp4', previewKind: 'video', previewable: true };
      }
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

// ---------------------------------------------------------------------------
// CRC32 + PNG chunk helpers
// ---------------------------------------------------------------------------

export function crc32(buffer) {
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

export function makePngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

// ---------------------------------------------------------------------------
// DXT decode
// ---------------------------------------------------------------------------

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

export function decodeDXT1(buffer, width, height) {
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

export function decodeDXT5(buffer, width, height) {
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
// DXT encode
// ---------------------------------------------------------------------------

function packRgb565(r, g, b) {
  return ((r * 31 / 255 + 0.5 | 0) << 11) | ((g * 63 / 255 + 0.5 | 0) << 5) | (b * 31 / 255 + 0.5 | 0);
}

function colorDistance(r0, g0, b0, r1, g1, b1) {
  const dr = r0 - r1, dg = g0 - g1, db = b0 - b1;
  return dr * dr + dg * dg + db * db;
}

function encodeDXT1Block(pixels, pixOffset, width, dst, dstOffset) {
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
      [0, 0, 0],
    ];
  }

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
  const block = new Uint8Array(16 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const src = (pixOffset + y * width + x) * 4;
      const d = (y * 4 + x) * 4;
      block[d] = pixels[src]; block[d + 1] = pixels[src + 1];
      block[d + 2] = pixels[src + 2]; block[d + 3] = pixels[src + 3];
    }
  }

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

  dst[dstOffset] = a0;
  dst[dstOffset + 1] = a1;
  let alphaBits = 0n;
  for (let i = 0; i < 16; i++) {
    alphaBits |= BigInt(alphaIndices[i]) << BigInt(i * 3);
  }
  for (let b = 0; b < 6; b++) {
    dst[dstOffset + 2 + b] = Number((alphaBits >> BigInt(b * 8)) & 0xFFn);
  }

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

export function encodeDXT1(pixels, width, height) {
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

export function encodeDXT5(pixels, width, height) {
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

export function decodeDxtToPng(raw, width, height, format) {
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

export function encodeRgbaToDxt(pixels, width, height, format) {
  if (format === 5) return encodeDXT5(pixels, width, height);
  if (format === 4) return encodeDXT1(pixels, width, height);
  throw new Error(`Unsupported DXT format for encoding: ${format}`);
}

export function expectedDxtSize(width, height, format) {
  const tilesAcross = (width + 3) >> 2;
  const tilesDown = (height + 3) >> 2;
  const blockSize = format === 5 ? 16 : 8;
  return tilesAcross * tilesDown * blockSize;
}

// ---------------------------------------------------------------------------
// PNG decode / encode (uses fflate instead of node:zlib)
// ---------------------------------------------------------------------------

export function decodePngToRgba(pngBuffer) {
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

    offset += 12 + length;
  }

  if (!width || !height) throw new Error('PNG missing IHDR');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth} (only 8-bit supported)`);

  const compressed = Buffer.concat(idatChunks);
  const raw = Buffer.from(inflateSync(new Uint8Array(compressed)));

  const rgba = Buffer.alloc(width * height * 4);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = 1 + width * bpp;

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
        case 4: {
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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * bpp;
      const dst = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[dst] = unfiltered[src]; rgba[dst + 1] = unfiltered[src + 1];
        rgba[dst + 2] = unfiltered[src + 2]; rgba[dst + 3] = unfiltered[src + 3];
      } else if (colorType === 2) {
        rgba[dst] = unfiltered[src]; rgba[dst + 1] = unfiltered[src + 1];
        rgba[dst + 2] = unfiltered[src + 2]; rgba[dst + 3] = 255;
      } else if (colorType === 4) {
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = unfiltered[src];
        rgba[dst + 3] = unfiltered[src + 1];
      } else {
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = unfiltered[src];
        rgba[dst + 3] = 255;
      }
    }
  }

  return { width, height, pixels: rgba };
}

export function encodeRgbaPng(width, height, pixels) {
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
  const idat = Buffer.from(deflateSync(new Uint8Array(raw)));
  return Buffer.concat([signature, makePngChunk('IHDR', ihdr), makePngChunk('IDAT', idat), makePngChunk('IEND', Buffer.alloc(0))]);
}

export function encodeGrayPng(width, height, pixels) {
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
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = Buffer.from(deflateSync(new Uint8Array(raw)));
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Tagged strings + gray untiling
// ---------------------------------------------------------------------------

export function untile4x4Gray8(buffer, width, height) {
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

export function extractTaggedStrings(buffer) {
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

// ---------------------------------------------------------------------------
// Classification + source support
// ---------------------------------------------------------------------------

export function classifyAsset(assetPath) {
  const ext = posixExtname(assetPath).toLowerCase();
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

  return { kind, format, contentType, previewKind, previewable, scenePath, sceneType };
}

export function describeSourceSupport(targetPath) {
  const extension = posixExtname(String(targetPath || '')).toLowerCase();
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

export function buildAssetManifest(assetFiles) {
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

// ---------------------------------------------------------------------------
// Mounted filesystem helpers (environment-agnostic; work with ext2fs mountedFs)
// ---------------------------------------------------------------------------

export async function mountedExists(mountedFs, mountedPath) {
  try {
    await mountedFs.promises.lstat(mountedPath);
    return true;
  } catch {
    return false;
  }
}

export async function readSmallMountedTextFile(mountedFs, mountedPath) {
  const data = await mountedFs.promises.readFile(mountedPath, 'utf8');
  return trimText(data);
}

export async function discoverGameRoot(mountedFs) {
  if (await mountedExists(mountedFs, '/game')) {
    try {
      const gameLink = await mountedFs.promises.readlink('/game');
      const candidate = toPosixAbsolute(gameLink).replace(/\/game$/, '');
      if (candidate && await mountedExists(mountedFs, `${candidate}/assets`) && await mountedExists(mountedFs, `${candidate}/image.bin`)) {
        return candidate;
      }
    } catch {
      // Ignore symlink resolution failures
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

export async function collectAssetFilesFromMountedFs(mountedFs, assetRoot) {
  const files = [];
  const stack = [assetRoot];

  while (stack.length) {
    const currentDir = stack.pop();
    const entries = (await mountedFs.promises.readdir(currentDir)).sort();

    for (const entry of entries) {
      const mountedPath = posixJoin(currentDir, entry);
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

      if (posixExtname(mountedPath).toLowerCase() === '.asset') {
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
