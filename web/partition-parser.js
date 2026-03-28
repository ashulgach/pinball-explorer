/**
 * Minimal MBR partition table parser for browser use.
 *
 * Reads the 512-byte Master Boot Record and extracts partition entries.
 * Returns the same { offset, size, type, index } format as the
 * `partitioninfo` npm package.
 *
 * Pinball SD card images use standard MBR with Linux (0x83) partitions.
 * GPT is not needed for this use case.
 */

const MBR_SIZE = 512;
const PARTITION_TABLE_OFFSET = 446;
const PARTITION_ENTRY_SIZE = 16;
const MAX_PRIMARY_PARTITIONS = 4;
const SECTOR_SIZE = 512;
const MBR_SIGNATURE = 0xAA55;

// Extended partition types (for logical partition support)
const EXTENDED_TYPES = new Set([0x05, 0x0F, 0x85]);

/**
 * Parse a single 16-byte MBR partition entry.
 * @param {DataView} view
 * @param {number} entryOffset - byte offset of the entry within the view
 * @returns {{ type: number, lbaStart: number, sectors: number, extended: boolean } | null}
 */
function parseEntry(view, entryOffset) {
  const type = view.getUint8(entryOffset + 4);
  if (type === 0) return null; // empty entry

  const lbaStart = view.getUint32(entryOffset + 8, true); // little-endian
  const sectors = view.getUint32(entryOffset + 12, true);

  return {
    type,
    lbaStart,
    sectors,
    extended: EXTENDED_TYPES.has(type),
  };
}

/**
 * Parse primary partitions from an MBR buffer.
 * @param {ArrayBuffer} mbrBuffer - 512-byte MBR
 * @returns {Array<{ type: number, lbaStart: number, sectors: number, extended: boolean }>}
 */
function parsePrimaryPartitions(mbrBuffer) {
  const view = new DataView(mbrBuffer);

  // Verify MBR signature
  const sig = view.getUint16(510, true);
  if (sig !== MBR_SIGNATURE) {
    throw new Error(`Invalid MBR signature: 0x${sig.toString(16)} (expected 0xAA55)`);
  }

  const entries = [];
  for (let i = 0; i < MAX_PRIMARY_PARTITIONS; i++) {
    const offset = PARTITION_TABLE_OFFSET + i * PARTITION_ENTRY_SIZE;
    const entry = parseEntry(view, offset);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Read logical partitions from an extended partition chain.
 * @param {File} file - browser File object
 * @param {number} extendedOffset - byte offset of the extended partition
 * @param {number} startIndex - starting index for logical partitions
 * @returns {Promise<Array<{ offset: number, size: number, type: number, index: number }>>}
 */
async function readLogicalPartitions(file, extendedOffset, startIndex) {
  const result = [];
  let currentOffset = extendedOffset;
  let index = startIndex;
  const maxIterations = 128; // safety limit

  for (let iter = 0; iter < maxIterations; iter++) {
    const blob = file.slice(currentOffset, currentOffset + MBR_SIZE);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);

    // Check signature
    const sig = view.getUint16(510, true);
    if (sig !== MBR_SIGNATURE) break;

    let dataEntry = null;
    let nextExtended = null;

    for (let i = 0; i < MAX_PRIMARY_PARTITIONS; i++) {
      const offset = PARTITION_TABLE_OFFSET + i * PARTITION_ENTRY_SIZE;
      const entry = parseEntry(view, offset);
      if (!entry) continue;

      if (EXTENDED_TYPES.has(entry.type)) {
        nextExtended = entry;
      } else if (!dataEntry) {
        dataEntry = entry;
      }
    }

    if (dataEntry) {
      result.push({
        offset: currentOffset + dataEntry.lbaStart * SECTOR_SIZE,
        size: dataEntry.sectors * SECTOR_SIZE,
        type: dataEntry.type,
        index: index++,
      });
    }

    if (!nextExtended) break;
    currentOffset = extendedOffset + nextExtended.lbaStart * SECTOR_SIZE;
  }

  return result;
}

/**
 * Get all partitions from a raw disk image file.
 * Returns the same format as `partitioninfo.getPartitions()`.
 *
 * @param {File} file - browser File object
 * @returns {Promise<{ type: string, partitions: Array<{ offset: number, size: number, type: number, index: number }> }>}
 */
export async function getPartitions(file) {
  // Read the first 512 bytes (MBR)
  const blob = file.slice(0, MBR_SIZE);
  const mbrBuffer = await blob.arrayBuffer();

  const primaryEntries = parsePrimaryPartitions(mbrBuffer);
  const partitions = [];
  let index = 1;

  for (const entry of primaryEntries) {
    if (entry.extended) {
      // Read logical partitions from extended partition
      const extOffset = entry.lbaStart * SECTOR_SIZE;
      const logicals = await readLogicalPartitions(file, extOffset, index + MAX_PRIMARY_PARTITIONS);
      // Store the extended partition itself but also add its logicals
      partitions.push({
        offset: extOffset,
        size: entry.sectors * SECTOR_SIZE,
        type: entry.type,
        index,
      });
      partitions.push(...logicals);
    } else {
      partitions.push({
        offset: entry.lbaStart * SECTOR_SIZE,
        size: entry.sectors * SECTOR_SIZE,
        type: entry.type,
        index,
      });
    }
    index++;
  }

  return { type: 'mbr', partitions };
}
