import { interact } from 'balena-image-fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { VENOM_LE_097_SOUND_STATE } from './spike-sound-native-constants.generated.js';
import { VENOM_LE_097_SOUND_NATIVE_MAP } from './spike-sound-native-script-map.generated.js';

const PAGE_SIZE = 64 * 1024;
const MAX_PAGES = 128;

function unsupportedNativeReplace(message) {
  const error = new Error(message);
  error.code = 'UNSUPPORTED_NATIVE_REPLACE';
  return error;
}

function mapStruct(value) {
  const uint = value >>> 0;
  return ((uint & 0x007fffff) | ((uint & 0xff800000) >>> 1)) >>> 0;
}

class PagedBinaryReader {
  constructor(handle) {
    this.handle = handle;
    this.pages = new Map();
  }

  async readU8(offset) {
    const buffer = await this.readBuffer(offset, 1);
    return buffer[0] ?? 0;
  }

  async readU32LE(offset) {
    const buffer = await this.readBuffer(offset, 4);
    return buffer.readUInt32LE(0);
  }

  async readBuffer(offset, length) {
    const pageIndex = Math.floor(offset / PAGE_SIZE);
    const pageOffset = offset % PAGE_SIZE;
    if (pageOffset + length <= PAGE_SIZE) {
      const page = await this.getPage(pageIndex);
      return page.subarray(pageOffset, pageOffset + length);
    }

    const buffer = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      const absolute = offset + written;
      const currentPageIndex = Math.floor(absolute / PAGE_SIZE);
      const currentPageOffset = absolute % PAGE_SIZE;
      const take = Math.min(length - written, PAGE_SIZE - currentPageOffset);
      const page = await this.getPage(currentPageIndex);
      page.copy(buffer, written, currentPageOffset, currentPageOffset + take);
      written += take;
    }
    return buffer;
  }

  async getPage(pageIndex) {
    const existing = this.pages.get(pageIndex);
    if (existing) {
      this.pages.delete(pageIndex);
      this.pages.set(pageIndex, existing);
      return existing;
    }

    const buffer = Buffer.alloc(PAGE_SIZE);
    const { bytesRead } = await this.handle.read(buffer, 0, PAGE_SIZE, pageIndex * PAGE_SIZE);
    const page = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
    this.pages.set(pageIndex, page);

    while (this.pages.size > MAX_PAGES) {
      const oldest = this.pages.keys().next().value;
      this.pages.delete(oldest);
    }

    return page;
  }
}

function isSupportedState(gameRoot, stat) {
  return gameRoot === VENOM_LE_097_SOUND_STATE.gameRoot
    && stat.size === VENOM_LE_097_SOUND_STATE.imageBinSize;
}

function toUint16(value) {
  return value & 0xffff;
}

function stopCustomer(value, invert) {
  const sample = toUint16(value);
  return invert ? (~sample) & 0xffff : sample;
}

function rateCustomer(value, shift) {
  const sample = toUint16(value);
  const right = shift & 0xf;
  const left = (-shift) & 0xf;
  return ((sample >>> right) | ((sample << left) & 0xffff)) & 0xffff;
}

function getScriptFragments(scriptIndex) {
  const script = VENOM_LE_097_SOUND_NATIVE_MAP.scripts[scriptIndex];
  if (!script) {
    throw new Error(`Unknown native sound script ${scriptIndex}.`);
  }

  const fragments = script.fragmentIndices.map((fragmentIndex) => {
    const fragment = VENOM_LE_097_SOUND_NATIVE_MAP.fragments[fragmentIndex];
    if (!fragment) {
      throw new Error(`Missing native sound fragment ${fragmentIndex} for script ${scriptIndex}.`);
    }
    return fragment;
  });

  return {
    script,
    fragments,
  };
}

function applyPrintCustomer(buffer, channelCount, fragment, { hasLast = false } = {}) {
  const mapper = VENOM_LE_097_SOUND_STATE.publisherMappers[fragment.codec];
  if (!mapper) {
    throw new Error(`Unsupported publisher mapper ${fragment.codec}.`);
  }

  const mockIdentifier = VENOM_LE_097_SOUND_STATE.mockIdentifier;
  const instanceIdentifier = VENOM_LE_097_SOUND_STATE.instanceIdentifier;
  const sampleCount = Math.floor(buffer.length / 2);
  let carrySample = 0;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const originalSample = buffer.readUInt16LE(sampleIndex * 2);
    let sample = originalSample;
    const priorState = channelCount !== 1 && (sampleIndex & 1) !== 0
      ? carrySample
      : fragment.status;

    if (hasLast) {
      carrySample = originalSample;
    }

    if (channelCount === 1) {
      const sampleState = toUint16(sampleIndex + fragment.processException);
      const rotateAmount = mapper.m_ContextException[(sampleState >> 3) & 7];
      const xorRotateAmount = (sampleState + (sampleState >> 4)) & 0xf;
      if (!hasLast) {
        sample = rateCustomer(sample, rotateAmount);
      }
      sample ^= rateCustomer(priorState, -xorRotateAmount);
      sample ^= rateCustomer(mapper.listenerException[sampleState & 7], xorRotateAmount);
      sample ^= mockIdentifier[
        instanceIdentifier[fragment.policy + (stopCustomer(sampleState, mapper.clientException) & 0xff)]
      ];
      sample ^= mockIdentifier[
        128 + ((
          stopCustomer(sampleState, mapper.m_ClassException)
          >> mapper.m_AdvisorException[((sampleState >> 3) + sampleState) & 7]
        ) & 0xff)
      ];
      sample ^= mockIdentifier[
        256 + instanceIdentifier[
          fragment.policy + (stopCustomer(sampleState, mapper.m_ReponseException) & 0xff)
        ]
      ];
      if (hasLast) {
        sample = rateCustomer(sample, -rotateAmount);
      }
      if (mapper.m_BroadcasterException) {
        sample = (~sample) & 0xffff;
      }
    } else {
      const sampleState = toUint16((sampleIndex >> 1) + fragment.processException + (sampleIndex & 1));
      const rotateAmount = ((sampleState >> 4) + sampleState) & 0xf;

      if ((sampleIndex & 1) === 0) {
        sample ^= rateCustomer(priorState, -rotateAmount);
        sample ^= rateCustomer(mapper.m_ProxyException[sampleState & 7], rotateAmount);
        sample ^= mockIdentifier[
          (
            stopCustomer(sampleState, mapper._InterceptorException)
            >> mapper._AuthenticationException[((sampleState >> 3) + sampleState) & 7]
          ) & 0xff
        ];
        sample ^= mockIdentifier[
          256 + instanceIdentifier[
            fragment.policy + (stopCustomer(sampleState, mapper.m_MessageException) & 0xff)
          ]
        ];
        if (mapper.m_PoolException) {
          sample = (~sample) & 0xffff;
        }
      } else {
        sample ^= rateCustomer(priorState, rotateAmount);
        sample ^= rateCustomer(mapper.m_MappingException[sampleState & 7], -rotateAmount);
        sample ^= mockIdentifier[
          instanceIdentifier[
            fragment.policy + (stopCustomer(sampleState, mapper._CollectionException) & 0xff)
          ]
        ];
        sample ^= mockIdentifier[
          256 + (
            ~(
              stopCustomer(sampleState, mapper.dispatcherException)
              >> mapper.m_ContainerException[((sampleState >> 3) + sampleState) & 7]
            )
          & 0xff)
        ];
        if (mapper._TokenizerException) {
          sample = (~sample) & 0xffff;
        }
      }
    }

    sample = toUint16(sample);
    if (!hasLast) {
      carrySample = sample;
    }
    buffer.writeUInt16LE(sample, sampleIndex * 2);
  }
}

function createWavHeader({ sampleRate, channelCount, dataLength }) {
  const bitsPerSample = 16;
  const blockAlign = channelCount * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function parseWaveFormatSubType(buffer, chunkDataOffset, chunkSize) {
  if (chunkSize < 40) {
    throw unsupportedNativeReplace('Unsupported WAV extensible fmt chunk.');
  }

  const guid = buffer.subarray(chunkDataOffset + 24, chunkDataOffset + 40).toString('hex');
  if (guid === '0100000000001000800000aa00389b71') {
    return 1;
  }
  if (guid === '0300000000001000800000aa00389b71') {
    return 3;
  }

  throw unsupportedNativeReplace('Unsupported WAV extensible subtype.');
}

function clampUnitSample(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= -1) return -1;
  if (value >= 1) return 1;
  return value;
}

function decodeWaveSample(data, offset, audioFormat, bitsPerSample) {
  if (audioFormat === 1) {
    switch (bitsPerSample) {
      case 8:
        return (data.readUInt8(offset) - 128) / 128;
      case 16:
        return data.readInt16LE(offset) / 32768;
      case 24: {
        const unsigned = data.readUIntLE(offset, 3);
        const signed = unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
        return signed / 8388608;
      }
      case 32:
        return data.readInt32LE(offset) / 2147483648;
      default:
        throw unsupportedNativeReplace(`Unsupported PCM WAV bit depth ${bitsPerSample}.`);
    }
  }

  if (audioFormat === 3) {
    switch (bitsPerSample) {
      case 32:
        return clampUnitSample(data.readFloatLE(offset));
      case 64:
        return clampUnitSample(data.readDoubleLE(offset));
      default:
        throw unsupportedNativeReplace(`Unsupported float WAV bit depth ${bitsPerSample}.`);
    }
  }

  throw unsupportedNativeReplace(`Unsupported WAV audio format ${audioFormat}.`);
}

function floatSampleToInt16(sample) {
  const clamped = clampUnitSample(sample);
  if (clamped <= -1) return -32768;
  if (clamped >= 1) return 32767;
  return clamped < 0
    ? Math.round(clamped * 32768)
    : Math.round(clamped * 32767);
}

function resampleInterleavedLinear(samples, channelCount, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return samples;
  }

  const sourceFrameCount = Math.floor(samples.length / channelCount);
  if (sourceFrameCount <= 0) {
    return new Float32Array(0);
  }

  const targetFrameCount = Math.max(1, Math.round(sourceFrameCount * targetRate / sourceRate));
  const result = new Float32Array(targetFrameCount * channelCount);

  for (let targetFrame = 0; targetFrame < targetFrameCount; targetFrame += 1) {
    const sourcePosition = targetFrame * sourceRate / targetRate;
    const leftFrame = Math.min(Math.floor(sourcePosition), sourceFrameCount - 1);
    const rightFrame = Math.min(leftFrame + 1, sourceFrameCount - 1);
    const mix = sourcePosition - leftFrame;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const left = samples[(leftFrame * channelCount) + channel];
      const right = samples[(rightFrame * channelCount) + channel];
      result[(targetFrame * channelCount) + channel] = (left * (1 - mix)) + (right * mix);
    }
  }

  return result;
}

function parseWaveFile(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw unsupportedNativeReplace('Native Venom replace currently expects a RIFF/WAVE file.');
  }

  let fmt = null;
  let data = null;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    const chunkDataEnd = chunkDataOffset + chunkSize;
    if (chunkDataEnd > buffer.length) {
      throw new Error('Invalid WAV chunk layout.');
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new Error('Unsupported WAV fmt chunk.');
      }
      const baseAudioFormat = buffer.readUInt16LE(chunkDataOffset);
      fmt = {
        audioFormat: baseAudioFormat === 0xfffe
          ? parseWaveFormatSubType(buffer, chunkDataOffset, chunkSize)
          : baseAudioFormat,
        channelCount: buffer.readUInt16LE(chunkDataOffset + 2),
        sampleRate: buffer.readUInt32LE(chunkDataOffset + 4),
        byteRate: buffer.readUInt32LE(chunkDataOffset + 8),
        blockAlign: buffer.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: buffer.readUInt16LE(chunkDataOffset + 14),
      };
    } else if (chunkId === 'data') {
      data = buffer.subarray(chunkDataOffset, chunkDataEnd);
    }

    offset = chunkDataEnd + (chunkSize & 1);
  }

  if (!fmt || !data) {
    throw unsupportedNativeReplace('Invalid WAV file: missing fmt or data chunk.');
  }

  if (fmt.channelCount < 1 || fmt.channelCount > 6) {
    throw unsupportedNativeReplace(`Unsupported WAV channel count ${fmt.channelCount}.`);
  }

  if (fmt.sampleRate < 1) {
    throw unsupportedNativeReplace('Unsupported WAV sample rate.');
  }

  const bytesPerSample = Math.ceil(fmt.bitsPerSample / 8);
  if (fmt.blockAlign !== fmt.channelCount * bytesPerSample) {
    throw unsupportedNativeReplace('Unexpected WAV block alignment.');
  }

  const frameCount = Math.floor(data.length / fmt.blockAlign);
  const decoded = new Float32Array(frameCount * fmt.channelCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameOffset = frameIndex * fmt.blockAlign;
    for (let channelIndex = 0; channelIndex < fmt.channelCount; channelIndex += 1) {
      const sampleOffset = frameOffset + (channelIndex * bytesPerSample);
      decoded[(frameIndex * fmt.channelCount) + channelIndex] = decodeWaveSample(
        data,
        sampleOffset,
        fmt.audioFormat,
        fmt.bitsPerSample,
      );
    }
  }

  const targetSampleRate = VENOM_LE_097_SOUND_STATE.sampleRate;
  const resampled = resampleInterleavedLinear(decoded, fmt.channelCount, fmt.sampleRate, targetSampleRate);
  const pcm = new Int16Array(resampled.length);
  for (let index = 0; index < resampled.length; index += 1) {
    pcm[index] = floatSampleToInt16(resampled[index]);
  }

  return {
    channelCount: fmt.channelCount,
    sampleRate: targetSampleRate,
    frameCount: Math.floor(pcm.length / fmt.channelCount),
    samples: pcm,
  };
}

class WavSampleSource {
  constructor(wave) {
    this.channelCount = wave.channelCount;
    this.samples = wave.samples;
    this.frameCount = wave.frameCount;
    this.position = 0;
  }

  popSamples(outputLength) {
    const result = new Array(outputLength).fill(0);
    if (outputLength <= 0) {
      return result;
    }

    let lastSample = 0;
    if (this.position < this.frameCount) {
      const frameOffset = this.position * this.channelCount;
      for (let sourceIndex = 0; sourceIndex < this.channelCount; sourceIndex += 1) {
        const sample = this.samples[frameOffset + sourceIndex] ?? 0;
        result[Math.min(sourceIndex, outputLength - 1)] = sample;
        lastSample = sample;
      }
      this.position += 1;
    }

    for (let outputIndex = this.channelCount; outputIndex < outputLength; outputIndex += 1) {
      result[outputIndex] = lastSample;
    }

    return result;
  }
}

async function readFragmentPayload(handle, fragment) {
  const length = fragment.frameCount * fragment.channelCount * 2;
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, fragment.offset);
  if (bytesRead !== length) {
    throw new Error(
      `Short read for fragment at 0x${fragment.offset.toString(16)}: expected ${length}, got ${bytesRead}.`,
    );
  }
  return buffer;
}

function applyFragmentHelperRanges(encodedPayload, existingPayload, fragment) {
  for (const [start, length] of fragment.helperRanges ?? []) {
    const end = start + length;
    if (start < 0 || length < 0 || end > encodedPayload.length || end > existingPayload.length) {
      throw new Error(`Invalid helper range ${start}:${length} for fragment at 0x${fragment.offset.toString(16)}.`);
    }
    existingPayload.copy(encodedPayload, start, start, end);
  }
}

function buildModeZeroReplacementPayload(fragment, sampleSource, existingPayload) {
  const payload = Buffer.allocUnsafe(fragment.frameCount * fragment.channelCount * 2);
  let writeOffset = 0;

  for (let frameIndex = 0; frameIndex < fragment.frameCount; frameIndex += 1) {
    const samples = sampleSource.popSamples(fragment.channelCount);
    for (let channelIndex = 0; channelIndex < fragment.channelCount; channelIndex += 1) {
      payload.writeInt16LE(samples[channelIndex], writeOffset);
      writeOffset += 2;
    }
  }

  applyPrintCustomer(payload, fragment.channelCount, fragment, { hasLast: true });
  applyFragmentHelperRanges(payload, existingPayload, fragment);
  return payload;
}

async function buildNativeSpikeScriptWav(mountedFs, scriptIndex) {
  const { script, fragments } = getScriptFragments(scriptIndex);

  const channelCount = script.channelCount || 1;
  const pcmLength = fragments.reduce(
    (total, fragment) => total + (fragment.frameCount * fragment.channelCount * 2),
    0,
  );
  const pcmBuffer = Buffer.allocUnsafe(pcmLength);
  const handle = await mountedFs.promises.open(VENOM_LE_097_SOUND_STATE.imageBinPath, 'r');
  let writeOffset = 0;

  try {
    for (const fragment of fragments) {
      const payload = await readFragmentPayload(handle, fragment);
      applyPrintCustomer(payload, fragment.channelCount, fragment);
      payload.copy(pcmBuffer, writeOffset);
      writeOffset += payload.length;
    }
  } finally {
    await handle.close();
  }

  return Buffer.concat([
    createWavHeader({
      sampleRate: VENOM_LE_097_SOUND_STATE.sampleRate,
      channelCount,
      dataLength: pcmBuffer.length,
    }),
    pcmBuffer,
  ]);
}

function buildScriptLabel(scriptIndex) {
  return `Script 0x${scriptIndex.toString(16).toUpperCase().padStart(2, '0')}`;
}

async function manageScriptPointer(reader, scriptIndex, fieldIndex) {
  const entryIndex = (scriptIndex * 5) + fieldIndex;
  const raw = await reader.readU32LE(
    VENOM_LE_097_SOUND_STATE.scriptTableOffset + (entryIndex * 4),
  );
  let decoded = raw >>> 0;
  let keyIndex = (entryIndex & 0x7f) + (((entryIndex >> 6) & 0x3f) << 8);
  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    decoded ^= VENOM_LE_097_SOUND_STATE.instanceIdentifier[keyIndex++] << (byteIndex * 8);
  }
  return mapStruct(decoded);
}

async function collectScriptFragments(reader, scriptIndex) {
  const fragments = [];
  const seen = new Set();
  const scriptOffset = await manageScriptPointer(reader, scriptIndex, 0);
  if (scriptOffset === 0) {
    return fragments;
  }
  const xorBase = (scriptOffset ^ VENOM_LE_097_SOUND_STATE.procIdentifier) & VENOM_LE_097_SOUND_STATE.readerMask;
  const { readerMap, serviceMap } = VENOM_LE_097_SOUND_STATE.scriptParser;

  let relativeOffset = 0;
  while (true) {
    let opcode = await reader.readU8(scriptOffset + relativeOffset);
    opcode ^= VENOM_LE_097_SOUND_STATE.instanceIdentifier[xorBase + relativeOffset];
    relativeOffset += 1;

    const fieldType = opcode < readerMap.length ? readerMap[opcode] : -1;
    let operandLength = opcode < serviceMap.length ? serviceMap[opcode] : 0;

    if (fieldType === 0) {
      return fragments;
    }

    if (fieldType === 11) {
      if (operandLength === 11) {
        relativeOffset += 2;
        operandLength -= 2;
      }

      let descriptorOffset = await reader.readU32LE(scriptOffset + relativeOffset);
      for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
        descriptorOffset ^= VENOM_LE_097_SOUND_STATE.instanceIdentifier[xorBase + relativeOffset + byteIndex] << (byteIndex * 8);
      }
      relativeOffset += 4;

      descriptorOffset &= 0xffffffff;
      if (!seen.has(descriptorOffset)) {
        seen.add(descriptorOffset);
        fragments.push(descriptorOffset);
      }

      operandLength -= 9;
    } else if (fieldType < 0 || fieldType > 18) {
      if (scriptIndex === 0) {
        return [];
      }
      throw new Error(`Unsupported script opcode ${opcode} at script ${scriptIndex}.`);
    }

    if (operandLength > 0) {
      relativeOffset += operandLength;
    }
  }
}

async function readFragmentDescriptor(reader, descriptorOffset) {
  return {
    descriptorOffset,
    payloadOffset: descriptorOffset + 8,
    frameCount: await reader.readU32LE(descriptorOffset),
    channelCount: await reader.readU8(descriptorOffset + 4),
    unknown: await reader.readU8(descriptorOffset + 5),
    multiplier: await reader.readU8(descriptorOffset + 6),
    fragmentType: await reader.readU8(descriptorOffset + 7),
  };
}

function buildScriptMetadata(scriptIndex, descriptors) {
  let durationMs = 0;
  let totalFrames = 0;
  let channelCount = 0;
  let codec = 0;

  for (const descriptor of descriptors) {
    totalFrames += descriptor.frameCount;
    channelCount = Math.max(channelCount, descriptor.channelCount);
    codec = descriptor.fragmentType;
    durationMs += Math.floor(
      (1000 * descriptor.frameCount * descriptor.multiplier) / VENOM_LE_097_SOUND_STATE.sampleRate,
    );
  }

  return {
    scriptIndex,
    requestIndex: 0,
    fragmentType: codec,
    channelCount,
    durationMs,
    codec,
    fragmentCount: descriptors.length,
    byteLength: totalFrames,
    stereo: channelCount === 2,
    defaultLabel: buildScriptLabel(scriptIndex),
    label: buildScriptLabel(scriptIndex),
    sortKey: scriptIndex,
  };
}

export async function inspectNativeSpikeSoundsMounted(mountedFs, gameRoot) {
  const stat = await mountedFs.promises.stat(VENOM_LE_097_SOUND_STATE.imageBinPath);
  if (!isSupportedState(gameRoot, stat)) {
    throw new Error('No native sound parser is available for this mounted SPIKE image yet.');
  }

  const soundScripts = VENOM_LE_097_SOUND_NATIVE_MAP.scripts.map((script) => ({
    ...script,
    defaultLabel: buildScriptLabel(script.scriptIndex),
    label: buildScriptLabel(script.scriptIndex),
    sortKey: script.scriptIndex,
    stereo: script.channelCount === 2,
  }));

  return {
    soundSystem: {
      sampleRate: VENOM_LE_097_SOUND_STATE.sampleRate,
      requestCount: VENOM_LE_097_SOUND_STATE.requestCount,
      scriptCount: VENOM_LE_097_SOUND_STATE.scriptCount,
      fragmentCount: VENOM_LE_097_SOUND_NATIVE_MAP.fragmentCount,
    },
    soundScripts,
  };
}

export async function inspectNativeSpikeSounds(targetPath, partitionIndex, gameRoot) {
  return interact(targetPath, partitionIndex, async (mountedFs) => inspectNativeSpikeSoundsMounted(mountedFs, gameRoot));
}

async function replaceNativeSpikeSoundScriptInternal(mountedFs, scriptIndex, inputPath) {
  const { script, fragments } = getScriptFragments(scriptIndex);
  if (!fragments.length) {
    throw new Error(`Script ${scriptIndex} has no replaceable fragments.`);
  }

  const wave = parseWaveFile(await fs.readFile(inputPath));
  const sampleSource = new WavSampleSource(wave);
  const handle = await mountedFs.promises.open(VENOM_LE_097_SOUND_STATE.imageBinPath, 'r+');

  try {
    for (const fragment of fragments) {
      if (fragment.channelCount !== 1 && fragment.channelCount !== 2) {
        throw new Error(`Unsupported Venom fragment channel count ${fragment.channelCount}.`);
      }

      const existingPayload = await readFragmentPayload(handle, fragment);
      const encodedPayload = buildModeZeroReplacementPayload(fragment, sampleSource, existingPayload);
      const { bytesWritten } = await handle.write(encodedPayload, 0, encodedPayload.length, fragment.offset);
      if (bytesWritten !== encodedPayload.length) {
        throw new Error(
          `Short write for fragment at 0x${fragment.offset.toString(16)}: expected ${encodedPayload.length}, got ${bytesWritten}.`,
        );
      }
    }
  } finally {
    await handle.close();
  }

  return {
    scriptIndex,
    channelCount: script.channelCount,
    fragmentCount: fragments.length,
  };
}

export async function exportNativeSpikeSoundScript(targetPath, partitionIndex, gameRoot, scriptIndex, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  return interact(targetPath, partitionIndex, async (mountedFs) => {
    const stat = await mountedFs.promises.stat(VENOM_LE_097_SOUND_STATE.imageBinPath);
    if (!isSupportedState(gameRoot, stat)) {
      throw new Error('No native sound exporter is available for this mounted SPIKE image yet.');
    }

    const wavBuffer = await buildNativeSpikeScriptWav(mountedFs, scriptIndex);
    await fs.writeFile(outputPath, wavBuffer);
    return outputPath;
  });
}

export async function replaceNativeSpikeSoundScript(targetPath, partitionIndex, gameRoot, scriptIndex, inputPath) {
  return interact(targetPath, partitionIndex, async (mountedFs) => {
    const stat = await mountedFs.promises.stat(VENOM_LE_097_SOUND_STATE.imageBinPath);
    if (!isSupportedState(gameRoot, stat)) {
      throw unsupportedNativeReplace('No native sound replacer is available for this mounted SPIKE image yet.');
    }

    return replaceNativeSpikeSoundScriptInternal(mountedFs, scriptIndex, inputPath);
  });
}
