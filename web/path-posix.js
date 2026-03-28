/**
 * Minimal path.posix shim for browser use.
 * Only implements the subset used by raw-image-backend.js.
 */

export function join(...parts) {
  return normalize(parts.filter(Boolean).join('/'));
}

export function normalize(p) {
  const parts = p.split('/');
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
  return p.startsWith('/') ? '/' + normalized : normalized || '.';
}

export function basename(p, ext) {
  const base = p.split('/').filter(Boolean).pop() || '';
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
}

export function dirname(p) {
  const parts = p.split('/');
  parts.pop();
  const dir = parts.join('/');
  return dir || (p.startsWith('/') ? '/' : '.');
}

export function extname(p) {
  const base = basename(p);
  const dotIndex = base.lastIndexOf('.');
  return dotIndex <= 0 ? '' : base.slice(dotIndex);
}

export function resolve(...parts) {
  let resolved = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    resolved = parts[i] + (resolved ? '/' + resolved : '');
    if (resolved.startsWith('/')) break;
  }
  return normalize(resolved);
}

export default { join, normalize, basename, dirname, extname, resolve };
