/**
 * BrowserDisk — A Disk implementation that reads from a browser File object.
 *
 * Implements the same interface as file-disk's Disk class (read, write,
 * getCapacity, flush, discard) but uses the File API for byte-range access.
 * File.slice() is lazy — it never loads the full multi-GB file into memory.
 *
 * For write support, maintains a copy-on-write overlay in memory.
 */

import { Buffer } from 'buffer';

/** Sorted, non-overlapping write overlay chunks */
class WriteOverlay {
  constructor() {
    this.chunks = []; // [{ start, end, data: Buffer }]
  }

  write(data, fileOffset) {
    const newChunk = { start: fileOffset, end: fileOffset + data.length, data: Buffer.from(data) };
    const merged = [];
    let inserted = false;

    for (const chunk of this.chunks) {
      if (chunk.end < newChunk.start || chunk.start > newChunk.end) {
        // No overlap
        if (!inserted && chunk.start > newChunk.end) {
          merged.push(newChunk);
          inserted = true;
        }
        merged.push(chunk);
      } else {
        // Overlap — merge into newChunk
        const mergedStart = Math.min(chunk.start, newChunk.start);
        const mergedEnd = Math.max(chunk.end, newChunk.end);
        const buf = Buffer.alloc(mergedEnd - mergedStart);

        // Copy existing chunk data
        chunk.data.copy(buf, chunk.start - mergedStart);
        // New data overwrites
        newChunk.data.copy(buf, newChunk.start - mergedStart);

        newChunk.start = mergedStart;
        newChunk.end = mergedEnd;
        newChunk.data = buf;
      }
    }
    if (!inserted) merged.push(newChunk);

    this.chunks = merged;
  }

  /**
   * Read from overlay, filling provided buffer where overlay data exists.
   * Returns the number of bytes filled from the overlay.
   */
  readInto(buffer, bufferOffset, length, fileOffset) {
    const readEnd = fileOffset + length;
    let bytesFilled = 0;

    for (const chunk of this.chunks) {
      if (chunk.start >= readEnd) break;
      if (chunk.end <= fileOffset) continue;

      const overlapStart = Math.max(fileOffset, chunk.start);
      const overlapEnd = Math.min(readEnd, chunk.end);
      const overlapLen = overlapEnd - overlapStart;

      const srcOffset = overlapStart - chunk.start;
      const dstOffset = bufferOffset + (overlapStart - fileOffset);

      chunk.data.copy(buffer, dstOffset, srcOffset, srcOffset + overlapLen);
      bytesFilled += overlapLen;
    }

    return bytesFilled;
  }

  hasOverlap(fileOffset, length) {
    const readEnd = fileOffset + length;
    for (const chunk of this.chunks) {
      if (chunk.start >= readEnd) break;
      if (chunk.end > fileOffset) return true;
    }
    return false;
  }
}

export class BrowserDisk {
  /**
   * @param {File} file — browser File object from <input type="file"> or drag-and-drop
   * @param {boolean} readOnly — if true, writes are recorded but not flushed
   */
  constructor(file, readOnly = true) {
    this.file = file;
    this.readOnly = readOnly;
    this.overlay = new WriteOverlay();
    this.capacity = null;
  }

  async getCapacity() {
    if (this.capacity === null) {
      this.capacity = this.file.size;
    }
    return this.capacity;
  }

  /**
   * Read bytes from the file (or overlay if written to).
   * Matches the file-disk Disk.read() signature exactly.
   *
   * @param {Buffer} buffer - target buffer to read into
   * @param {number} bufferOffset - offset within buffer to start writing
   * @param {number} length - number of bytes to read
   * @param {number} fileOffset - byte offset within the file
   * @returns {{ bytesRead: number, buffer: Buffer }}
   */
  async read(buffer, bufferOffset, length, fileOffset) {
    // Clamp to file size
    const cap = await this.getCapacity();
    const actualLength = Math.min(length, cap - fileOffset);
    if (actualLength <= 0) {
      return { bytesRead: 0, buffer };
    }

    // Read underlying file bytes via File.slice()
    const blob = this.file.slice(fileOffset, fileOffset + actualLength);
    const arrayBuffer = await blob.arrayBuffer();
    const src = Buffer.from(arrayBuffer);
    src.copy(buffer, bufferOffset, 0, actualLength);

    // Apply any write overlay on top
    this.overlay.readInto(buffer, bufferOffset, actualLength, fileOffset);

    return { bytesRead: actualLength, buffer };
  }

  /**
   * Write bytes — stored in the copy-on-write overlay.
   * Matches the file-disk Disk.write() signature.
   */
  async write(buffer, bufferOffset, length, fileOffset) {
    const data = buffer.slice(bufferOffset, bufferOffset + length);
    this.overlay.write(data, fileOffset);
    return { bytesWritten: length, buffer };
  }

  /**
   * Flush — no-op for browser (writes stay in overlay until explicitly saved).
   */
  async flush() {
    // In the future, use File System Access API to write back
  }

  /**
   * Discard — no-op for browser.
   */
  async discard(_offset, _length) {
    // Not needed for read-only browser use
  }
}
