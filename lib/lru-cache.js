// lru-cache.js — Simple LRU cache with entry-count and optional byte-size limits.

export class LRUCache {
  /**
   * @param {number} maxEntries  Maximum number of entries (0 = unlimited).
   * @param {number} maxBytes    Maximum total byte size (0 = unlimited).
   *                             Requires entries to carry a `_byteSize` property.
   */
  constructor(maxEntries, maxBytes = 0) {
    this._map = new Map();
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this._totalBytes = 0;
  }

  get size() { return this._map.size; }

  has(key) { return this._map.has(key); }

  get(key) {
    const entry = this._map.get(key);
    if (entry === undefined) return undefined;
    // Move to end (most recently used)
    this._map.delete(key);
    this._map.set(key, entry);
    return entry;
  }

  set(key, value) {
    if (this._map.has(key)) {
      const old = this._map.get(key);
      this._totalBytes -= (old && old._byteSize) || 0;
      this._map.delete(key);
    }
    this._totalBytes += (value && value._byteSize) || 0;
    this._map.set(key, value);
    this._evict();
  }

  delete(key) {
    const old = this._map.get(key);
    if (old !== undefined) {
      this._totalBytes -= (old && old._byteSize) || 0;
      this._map.delete(key);
    }
  }

  clear() {
    this._map.clear();
    this._totalBytes = 0;
  }

  _evict() {
    while (
      (this.maxEntries > 0 && this._map.size > this.maxEntries) ||
      (this.maxBytes > 0 && this._totalBytes > this.maxBytes)
    ) {
      const oldest = this._map.keys().next().value;
      const entry = this._map.get(oldest);
      this._totalBytes -= (entry && entry._byteSize) || 0;
      this._map.delete(oldest);
    }
  }
}

/**
 * Simple counting semaphore for limiting concurrent async operations.
 */
export class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this._queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => this._queue.push(resolve));
  }

  release() {
    this.current--;
    if (this._queue.length > 0) {
      this.current++;
      this._queue.shift()();
    }
  }
}
