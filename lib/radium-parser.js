// radium-parser.js — Binary parser for Stern Spike Radium scene files.
// Ported from ske-radium/radium.py (star-wars-elg V1.04.0 based).

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// RadiumReader — cursor-based little-endian binary reader
// ---------------------------------------------------------------------------

class RadiumReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.cursor = 0;
  }

  read(length) {
    const slice = this.buffer.subarray(this.cursor, this.cursor + length);
    this.cursor += length;
    return slice;
  }

  readU8() {
    const v = this.buffer.readUInt8(this.cursor);
    this.cursor += 1;
    return v;
  }

  readU16() {
    const v = this.buffer.readUInt16LE(this.cursor);
    this.cursor += 2;
    return v;
  }

  readU32() {
    const v = this.buffer.readUInt32LE(this.cursor);
    this.cursor += 4;
    return v;
  }

  readU64() {
    // Read as BigInt, convert to Number (safe for lengths we encounter)
    const v = this.buffer.readBigUInt64LE(this.cursor);
    this.cursor += 8;
    return Number(v);
  }

  readF32() {
    const v = this.buffer.readFloatLE(this.cursor);
    this.cursor += 4;
    return v;
  }

  readBool() {
    const v = this.readU8();
    if (v !== 0 && v !== 1) throw new Error(`Invalid bool value: ${v}`);
    return v === 1;
  }

  readString() {
    const length = this.readU64();
    const bytes = this.read(length);
    return bytes.toString('utf-8');
  }

  readVec4() {
    return [this.readF32(), this.readF32(), this.readF32(), this.readF32()];
  }

  readMatrix4x4() {
    return [this.readVec4(), this.readVec4(), this.readVec4(), this.readVec4()];
  }

  readSizeT() {
    return { Width: this.readU32(), Height: this.readU32() };
  }

  readRectangleT() {
    return { Left: this.readF32(), Top: this.readF32(), Right: this.readF32(), Bottom: this.readF32() };
  }

  readColorT() {
    return this.readVec4();
  }

  // Aliases matching Python code
  readSize() { return this.readU64(); }
  readUint() { return this.readU32(); }
  readInt() { return this.readU32(); }
}

// ---------------------------------------------------------------------------
// Pointer system — cereal-style serialization
// ---------------------------------------------------------------------------

function createParseContext() {
  return {
    polyTypes: {},
    imageIdCounter: 0,
    images: {},       // imageId -> { width, height, format, isExternal, fileName, data? }
  };
}

function loadPtrWrapper(reader, type, ctx) {
  const ref = reader.readU32();
  const id = ref & 0x3FFFFFFF;
  const obj = { id };

  if (ref & 0x80000000) {
    obj.data = readers[type](reader, ctx);
  }

  return { ptr_wrapper: obj };
}

function loadSharedPtr(reader, unktype, ctx) {
  const poly = reader.readU32();
  const index = poly & 0x3FFFFFFF;

  if ((poly & 0x40000000) === 0) {
    if (poly === 0) {
      throw new Error(`Null shared pointer at cursor 0x${reader.cursor.toString(16)}`);
    }

    if (poly & 0x80000000) {
      // New polymorphic type
      const type = reader.readString();
      ctx.polyTypes[index] = type;
      return {
        id: index,
        polymorphic_id: poly,
        _polymorphic_type_new: type,
        ...loadPtrWrapper(reader, type, ctx),
      };
    }

    // Previously seen polymorphic type
    const type = ctx.polyTypes[index];
    return {
      id: index,
      polymorphic_id: poly,
      _polymorphic_type_old: type,
      ...loadPtrWrapper(reader, type, ctx),
    };
  }

  // Unknown type — caller specifies
  ctx.polyTypes[index] = unktype;
  return {
    id: index,
    polymorphic_id: poly,
    _polymorphic_type_unk: unktype,
    ...loadPtrWrapper(reader, unktype, ctx),
  };
}

// ---------------------------------------------------------------------------
// Type readers — dispatch table
// ---------------------------------------------------------------------------

function readCharacter(reader) {
  return { Id: reader.readU32(), Name: reader.readString() };
}

function readBinaryFile(reader, ctx) {
  const FileName = reader.readString();
  const Length = reader.readU32();
  let Buffer_ = null;

  if (FileName === '') {
    const dataOffset = reader.cursor;  // byte offset of raw data within the scene file
    const raw = reader.read(Length);
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 10);
    const imageId = `blob_${hash}`;
    Buffer_ = { _imageId: imageId, _length: Length, _dataOffset: dataOffset };
    // Store the raw data so we can serve it later
    ctx.images[imageId] = { rawBuffer: global.Buffer.from(raw), dataOffset, dataLength: Length };
  }

  return { FileName, Length, Buffer: Buffer_ };
}

function readImage(reader, ctx) {
  const Dimensions = reader.readSizeT();
  const Format = reader.readU32();
  const BufferData = readBinaryFile(reader, ctx);

  // Attach image metadata to the images store
  if (BufferData.Buffer && BufferData.Buffer._imageId) {
    const entry = ctx.images[BufferData.Buffer._imageId];
    if (entry) {
      entry.width = Dimensions.Width;
      entry.height = Dimensions.Height;
      entry.format = Format;
      entry.isExternal = false;
    }
  } else if (BufferData.FileName) {
    // External file reference
    const hash = crypto.createHash('sha256').update(BufferData.FileName).digest('hex').slice(0, 10);
    const imageId = `ext_${hash}`;
    BufferData.Buffer = { _imageId: imageId, _length: 0 };
    ctx.images[imageId] = {
      width: Dimensions.Width,
      height: Dimensions.Height,
      format: Format,
      isExternal: true,
      fileName: BufferData.FileName,
    };
  }

  return { Dimensions, Format, Buffer: BufferData };
}

function readBitmap(reader, ctx) {
  return {
    Character: readCharacter(reader),
    Dimensions: reader.readSizeT(),
    Image: loadPtrWrapper(reader, 'Image', ctx),
  };
}

function readFontGlyph(reader, ctx) {
  const Width = reader.readF32();
  const Height = reader.readF32();
  const XOrigin = reader.readF32();
  const YOrigin = reader.readF32();
  const XCellIncrement = reader.readF32();
  const YCellIncrement = reader.readF32();
  const Padding = reader.readF32();
  const TextureRotated = reader.readBool();
  const TextureCoordinates = reader.readRectangleT();
  const Image = loadPtrWrapper(reader, 'Image', ctx);

  // Kerning: map<u16, f32>
  const kerningCount = reader.readSize();
  const Kerning = {};
  for (let i = 0; i < kerningCount; i++) {
    const key = reader.readU16();
    Kerning[key] = reader.readF32();
  }

  return { Width, Height, XOrigin, YOrigin, XCellIncrement, YCellIncrement, Padding, TextureRotated, TextureCoordinates, Image, Kerning };
}

function readFontInstance(reader, ctx) {
  const FontId = reader.readUint();
  const LineHeight = reader.readF32();
  const Ascent = reader.readF32();
  const Descent = reader.readF32();
  const Custom = reader.readBool();

  // Glyphs: map<u16, PtrWrapper<FontGlyph>>
  const glyphCount = reader.readSize();
  const Glyphs = {};
  for (let i = 0; i < glyphCount; i++) {
    const key = reader.readU16();
    Glyphs[key] = loadPtrWrapper(reader, 'FontGlyph', ctx);
  }

  return { FontId, LineHeight, Ascent, Descent, Custom, Glyphs };
}

function readFont(reader, ctx) {
  const Character = readCharacter(reader);
  const FontName = reader.readString();
  const Bold = reader.readBool();
  const Italic = reader.readBool();

  // Characters: vector<u16>
  const charCount = reader.readSize();
  const Characters = [];
  for (let i = 0; i < charCount; i++) {
    Characters.push(reader.readU16());
  }

  // Instances: map<int, PtrWrapper<FontInstance>>
  const instanceCount = reader.readSize();
  const Instances = {};
  for (let i = 0; i < instanceCount; i++) {
    const key = reader.readInt();
    Instances[key] = loadPtrWrapper(reader, 'FontInstance', ctx);
  }

  // CustomInstances: map<string, map<int, PtrWrapper<FontInstance>>>
  const customCount = reader.readSize();
  const CustomInstances = {};
  for (let i = 0; i < customCount; i++) {
    const key = reader.readString();
    const innerCount = reader.readSize();
    const inner = {};
    for (let j = 0; j < innerCount; j++) {
      const innerKey = reader.readInt();
      inner[innerKey] = loadPtrWrapper(reader, 'FontInstance', ctx);
    }
    CustomInstances[key] = inner;
  }

  return { Character, FontName, Bold, Italic, Characters, Instances, CustomInstances };
}

function readSoundEvent(reader, ctx) {
  return {
    SyncStop: reader.readBool(),
    SyncNoMultiple: reader.readBool(),
    Sound: loadSharedPtr(reader, 'Sound', ctx),
  };
}

function readSound(reader, ctx) {
  return {
    Character: readCharacter(reader),
    SampleRate: reader.readUint(),
    SampleSize: reader.readUint(),
    Channels: reader.readUint(),
    Compression: reader.readInt(),
    Buffer: readBinaryFile(reader, ctx),
  };
}

function readElement(reader, ctx) {
  const Name = reader.readString();
  const Depth = reader.readUint();

  function readKeyframeList(valueReader) {
    const count = reader.readSize();
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({ Frame: reader.readUint(), Value: valueReader() });
    }
    return list;
  }

  const Visible = { Keyframes: readKeyframeList(() => reader.readBool()) };
  const ColorTransform = {
    Keyframes: readKeyframeList(() => ({
      Multiplication: reader.readColorT(),
      Addition: reader.readColorT(),
    })),
  };
  const Transform = {
    Keyframes: readKeyframeList(() => ({ Matrix4x4: reader.readMatrix4x4() })),
  };
  const Character = {
    Keyframes: readKeyframeList(() => loadSharedPtr(reader, 'Character', ctx)),
  };

  // FrameFunctions: map<uint, FunctionBag>
  const ffCount = reader.readSize();
  const FrameFunctions = {};
  for (let i = 0; i < ffCount; i++) {
    const key = reader.readUint();
    // FunctionBag: { Functions: [...] }
    const funcCount = reader.readSize();
    const Functions = [];
    for (let j = 0; j < funcCount; j++) {
      const funcName = reader.readString();
      const argCount = reader.readSize();
      const Arguments = [];
      for (let k = 0; k < argCount; k++) {
        Arguments.push(reader.readString());
      }
      Functions.push({ Name: funcName, Arguments });
    }
    FrameFunctions[key] = { Functions };
  }

  return { Name, Depth, Visible, ColorTransform, Transform, Character, FrameFunctions };
}

function readSprite(reader, ctx) {
  const Character = readCharacter(reader);
  const FrameCount = reader.readUint();

  // Elements: vector<PtrWrapper<Element>>
  const elemCount = reader.readSize();
  const Elements = [];
  for (let i = 0; i < elemCount; i++) {
    Elements.push(loadPtrWrapper(reader, 'Element', ctx));
  }

  // SoundEvents: map<uint, vector<SoundEvent>>
  const seCount = reader.readSize();
  const SoundEvents = {};
  for (let i = 0; i < seCount; i++) {
    const key = reader.readUint();
    const vecCount = reader.readSize();
    const vec = [];
    for (let j = 0; j < vecCount; j++) {
      vec.push(readSoundEvent(reader, ctx));
    }
    SoundEvents[key] = vec;
  }

  // FrameLabels: map<string, uint>
  const flCount = reader.readSize();
  const FrameLabels = {};
  for (let i = 0; i < flCount; i++) {
    const key = reader.readString();
    FrameLabels[key] = reader.readUint();
  }

  return { Character, FrameCount, Elements, SoundEvents, FrameLabels };
}

function readText(reader, ctx) {
  const Character = readCharacter(reader);
  const Bounds = reader.readRectangleT();
  const Color = reader.readColorT();
  const Multiline = reader.readBool();
  const WordWrap = reader.readBool();
  const Alignment = reader.readU32();
  const LineSpacing = reader.readF32();
  const LetterSpacing = reader.readF32();
  const Text = reader.readString();

  const Font = loadPtrWrapper(reader, 'FontInstance', ctx);

  // LinkedFont: map<string, PtrWrapper<FontInstance>>
  const lfCount = reader.readSize();
  const LinkedFont = {};
  for (let i = 0; i < lfCount; i++) {
    const key = reader.readString();
    LinkedFont[key] = loadPtrWrapper(reader, 'FontInstance', ctx);
  }

  // AnimatedFonts: vector<PtrWrapper<FontInstance>>
  const afCount = reader.readSize();
  const AnimatedFonts = [];
  for (let i = 0; i < afCount; i++) {
    AnimatedFonts.push(loadPtrWrapper(reader, 'FontInstance', ctx));
  }

  // Try to read ScaleToBounds and VerticalAlignment (added in post-legacy format)
  let ScaleToBounds = false;
  let VerticalAlignment = 0;
  let isLegacy = false;

  // Heuristic: if we're not at the end and the next bytes look like a bool+u32,
  // try to read them. If it fails we'll handle in the catch.
  const savedCursor = reader.cursor;
  try {
    ScaleToBounds = reader.readBool();
    VerticalAlignment = reader.readU32();
  } catch {
    // Legacy format (batman66 0.65): no ScaleToBounds/VerticalAlignment
    reader.cursor = savedCursor;
    isLegacy = true;
  }

  const result = { Character, Bounds, Color, Multiline, WordWrap, Alignment, LineSpacing, LetterSpacing, Text, Font, LinkedFont, AnimatedFonts };
  if (!isLegacy) {
    result.ScaleToBounds = ScaleToBounds;
    result.VerticalAlignment = VerticalAlignment;
  }
  return result;
}

function readShape(reader, ctx) {
  return {
    Character: readCharacter(reader),
    Rectangle: reader.readRectangleT(),
    Bitmap: loadSharedPtr(reader, 'Bitmap', ctx),
  };
}

function readVideoClipFrameCallbackData(reader) {
  const CallbackFramerate = reader.readInt();
  const mapCount = reader.readSize();
  const CallbackMap = {};
  for (let i = 0; i < mapCount; i++) {
    const key = reader.readUint();
    CallbackMap[key] = reader.readString();
  }
  return { CallbackFramerate, CallbackMap };
}

function readVideo(reader, ctx) {
  const Character = readCharacter(reader);
  const Dimensions = reader.readSizeT();
  const FrameCount = reader.readInt();
  const AudioStream = reader.readBool();

  // Buffer: map<string, PtrWrapper<BinaryFile>>
  const bufCount = reader.readSize();
  const BufferMap = {};
  for (let i = 0; i < bufCount; i++) {
    const key = reader.readString();
    BufferMap[key] = loadPtrWrapper(reader, 'BinaryFile', ctx);
  }

  // CallbackData: map<string, PtrWrapper<VideoClipFrameCallbackData>>
  const cbCount = reader.readSize();
  const CallbackData = {};
  for (let i = 0; i < cbCount; i++) {
    const key = reader.readString();
    CallbackData[key] = loadPtrWrapper(reader, 'VideoClipFrameCallbackData', ctx);
  }

  return { Character, Dimensions, FrameCount, AudioStream, Buffer: BufferMap, CallbackData };
}

function readStreamingImageFrame(reader, ctx) {
  const Dimensions = reader.readSizeT();
  const Format = reader.readUint();
  const BufferPW = loadPtrWrapper(reader, 'BinaryFile', ctx);
  const ImageAssetId = reader.readUint();
  const Matrix = reader.readMatrix4x4();

  // Register external streaming frame images in the manifest so the player
  // can request them on-demand.  Tag them as streaming so the client knows
  // to lazy-load instead of fetching everything upfront.
  const bfData = BufferPW.ptr_wrapper?.data;
  if (bfData && bfData.FileName && !bfData.Buffer) {
    const hash = crypto.createHash('sha256').update(bfData.FileName).digest('hex').slice(0, 10);
    const imageId = `ext_${hash}`;
    bfData.Buffer = { _imageId: imageId, _length: 0 };
    ctx.images[imageId] = {
      width: Dimensions.Width,
      height: Dimensions.Height,
      format: Format,
      isExternal: true,
      fileName: bfData.FileName,
      streaming: true,
    };
  } else if (bfData?.Buffer?._imageId) {
    // Embedded streaming frame — attach dimensions and tag as streaming
    const entry = ctx.images[bfData.Buffer._imageId];
    if (entry) {
      entry.width = Dimensions.Width;
      entry.height = Dimensions.Height;
      entry.format = Format;
      entry.streaming = true;
    }
  }

  return { Dimensions, Format, Buffer: BufferPW, ImageAssetId, Matrix };
}

function readStreamingFlipbook(reader, ctx) {
  const Sprite = readSprite(reader, ctx);
  const Dimensions = reader.readSizeT();
  const frameCount = reader.readSize();
  const Frames = [];
  for (let i = 0; i < frameCount; i++) {
    Frames.push(loadPtrWrapper(reader, 'StreamingImageFrame', ctx));
  }
  return { Sprite, Dimensions, Images: { Frames } };
}

function readSpine(reader, ctx) {
  const Character = readCharacter(reader);

  // JsonData and AtlasData are stored as strings (binary blobs)
  const jsonBytes = reader.readString();
  const atlasBytes = reader.readString();

  const jsonHash = crypto.createHash('sha256').update(jsonBytes).digest('hex').slice(0, 10);
  const atlasHash = crypto.createHash('sha256').update(atlasBytes).digest('hex').slice(0, 10);

  const JsonData = { _ref: `blob_${jsonHash}_Spine_JsonData.json`, _content: jsonBytes };
  const AtlasData = { _ref: `blob_${atlasHash}_Spine_AtlasData.txt`, _content: atlasBytes };

  // Images: vector<PtrWrapper<Image>>
  const imgCount = reader.readSize();
  const Images = [];
  for (let i = 0; i < imgCount; i++) {
    Images.push(loadPtrWrapper(reader, 'Image', ctx));
  }

  return { Character, JsonData, AtlasData, Images };
}

function readComposition(reader, ctx) {
  // Dictionary: map<u32, SharedPtr<Character>>
  const dictCount = reader.readSize();
  const Dictionary = {};
  for (let i = 0; i < dictCount; i++) {
    const key = reader.readU32();
    Dictionary[key] = loadSharedPtr(reader, 'Character', ctx);
  }

  const FrameSize = {
    Left: reader.readInt(),
    Top: reader.readInt(),
    Right: reader.readInt(),
    Bottom: reader.readInt(),
  };
  const FrameRate = reader.readF32();
  const BackgroundColor = reader.readColorT();
  const Sprite = readSprite(reader, ctx);

  return { Dictionary: { Dictionary }, FrameSize, FrameRate, BackgroundColor, Sprite };
}

// ---------------------------------------------------------------------------
// Reader dispatch table
// ---------------------------------------------------------------------------

const readers = {
  Font: readFont,
  Bitmap: readBitmap,
  Text: readText,
  Sprite: readSprite,
  Video: readVideo,
  RectangleT: (r) => r.readRectangleT(),
  ColorT: (r) => r.readColorT(),
  FontInstance: readFontInstance,
  FontGlyph: readFontGlyph,
  Image: readImage,
  Sound: readSound,
  Element: readElement,
  Character: (r) => readCharacter(r),
  Shape: readShape,
  BinaryFile: readBinaryFile,
  StreamingFlipbook: readStreamingFlipbook,
  StreamingImageFrame: readStreamingImageFrame,
  VideoClipFrameCallbackData: (r) => readVideoClipFrameCallbackData(r),
  Spine: readSpine,
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseRadiumScene(buffer) {
  const reader = new RadiumReader(buffer);
  const ctx = createParseContext();

  // Endianness marker
  const marker = reader.readU8();
  if (marker !== 0x01) {
    throw new Error(`Invalid endianness marker: 0x${marker.toString(16)} (expected 0x01)`);
  }

  const composition = readComposition(reader, ctx);

  if (reader.cursor !== buffer.length) {
    throw new Error(`Parser did not consume entire buffer: cursor=${reader.cursor}, length=${buffer.length} (${buffer.length - reader.cursor} bytes remaining)`);
  }

  return { composition, images: ctx.images };
}

export function collectImageManifest(parseResult) {
  const manifest = {};
  for (const [imageId, entry] of Object.entries(parseResult.images)) {
    manifest[imageId] = {
      width: entry.width,
      height: entry.height,
      format: entry.format,
      isExternal: entry.isExternal || false,
      fileName: entry.fileName || null,
      streaming: entry.streaming || false,
    };
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Asset tree — groups all leaf assets by type for the sidebar tree view
// ---------------------------------------------------------------------------

const FORMAT_NAMES = { 4: 'DXT1', 5: 'DXT5' };

function getPolyType(entry) {
  return entry?._polymorphic_type_new || entry?._polymorphic_type_old || entry?._polymorphic_type_unk || '';
}

function extractImageInfo(imageId, entry) {
  const formatName = FORMAT_NAMES[entry.format] || `fmt${entry.format}`;
  const label = entry.fileName
    ? entry.fileName.split('/').pop()
    : imageId;
  return {
    id: imageId,
    label,
    width: entry.width || 0,
    height: entry.height || 0,
    format: formatName,
    isExternal: entry.isExternal || false,
    fileName: entry.fileName || null,
    streaming: entry.streaming || false,
  };
}

export function collectAssetTree(parseResult) {
  const images = [];
  const sounds = [];
  const videoClips = [];
  const fonts = [];
  const spineAssets = [];
  const texts = [];

  // Collect all images from the images store (covers Bitmap, Font glyph,
  // Sprite Element keyframe, Video BufferMap, StreamingFlipbook, and Spine images)
  const seenImageIds = new Set();
  for (const [imageId, entry] of Object.entries(parseResult.images)) {
    if (seenImageIds.has(imageId)) continue;
    seenImageIds.add(imageId);
    images.push(extractImageInfo(imageId, entry));
  }

  // Walk the Dictionary for Sounds, Videos, Fonts, Spine, Text characters
  const dict = parseResult.composition?.Dictionary?.Dictionary;
  if (dict) {
    for (const [dictKey, entry] of Object.entries(dict)) {
      const polyType = getPolyType(entry);
      const data = entry?.ptr_wrapper?.data;
      if (!data) continue;

      if (polyType === 'Sound') {
        const buf = data.Buffer;
        const blobId = buf?.Buffer?._imageId || `sound_${dictKey}`;
        sounds.push({
          id: blobId,
          label: buf?.FileName ? buf.FileName.split('/').pop() : blobId,
          sampleRate: data.SampleRate || 0,
          sampleSize: data.SampleSize || 0,
          channels: data.Channels || 0,
          compression: data.Compression || 0,
          blobId,
        });
      }

      if (polyType === 'Video') {
        const dims = data.Dimensions || {};
        for (const [clipName, bufPW] of Object.entries(data.Buffer || {})) {
          const bf = bufPW?.ptr_wrapper?.data;
          const fileName = bf?.FileName || '';
          videoClips.push({
            id: `video_${dictKey}_${clipName}`,
            label: clipName,
            clipName,
            dimensions: `${dims.Width || 0}\u00D7${dims.Height || 0}`,
            frameCount: data.FrameCount || 0,
            fileName,
          });
        }
      }

      if (polyType === 'Font') {
        const charName = data.Character?.Name || `Font ${dictKey}`;
        let glyphCount = 0;
        if (data.Instances) {
          for (const inst of Object.values(data.Instances)) {
            const glyphs = inst?.ptr_wrapper?.data?.Glyphs;
            if (glyphs) glyphCount += Object.keys(glyphs).length;
          }
        }
        fonts.push({
          id: `font_${dictKey}`,
          label: data.FontName || charName,
          fontName: data.FontName || '',
          bold: data.Bold || false,
          italic: data.Italic || false,
          glyphCount,
        });
      }

      if (polyType === 'Spine') {
        const charName = data.Character?.Name || `Spine ${dictKey}`;
        spineAssets.push({
          id: `spine_${dictKey}`,
          label: charName,
          characterName: charName,
          imageCount: data.Images?.length || 0,
        });
      }

      if (polyType === 'Text') {
        const charName = data.Character?.Name || `Text ${dictKey}`;
        const textContent = data.Text || '';
        texts.push({
          id: `text_${dictKey}`,
          label: charName,
          text: textContent.length > 80 ? textContent.slice(0, 80) + '\u2026' : textContent,
          fontRef: data.Font?.ptr_wrapper?.data?.FontId || null,
        });
      }
    }
  }

  // Also collect sounds from Sprite SoundEvents in the root composition Sprite
  // and any nested Sprite characters in the dictionary.
  // (Sounds referenced via SoundEvents are already SharedPtrs that appear in
  // the Dictionary, so they'll be caught by the loop above.)

  return { images, sounds, videoClips, fonts, spineAssets, texts };
}
