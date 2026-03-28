// Minimal crypto shim for browser use.
// Only createHash('sha1') is used by radium-parser.js for cache keys.

class Hash {
  constructor() {
    this.data = [];
  }
  update(input) {
    if (typeof input === 'string') {
      this.data.push(new TextEncoder().encode(input));
    } else {
      this.data.push(new Uint8Array(input));
    }
    return this;
  }
  digest(encoding) {
    // Simple FNV-1a hash as a replacement — not cryptographic but sufficient for cache keys
    let hash = 0x811c9dc5;
    for (const chunk of this.data) {
      for (const byte of chunk) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
      }
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return encoding === 'hex' ? hex : hex;
  }
}

export function createHash(_algorithm) {
  return new Hash();
}

export default { createHash };
