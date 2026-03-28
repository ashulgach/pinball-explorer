// radium-player.js — Canvas 2D animation player for Radium scenes.
// Ported from ske-radium/radium-player.py's RadiumScene class.

// ---------------------------------------------------------------------------
// Pointer resolution — walk JSON tree, collect ptr_wrapper objects
// ---------------------------------------------------------------------------

function buildPtrMap(sceneData) {
  const ptrs = { 0: null };

  function collectPtrs(obj) {
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        for (const v of obj) collectPtrs(v);
        return;
      }
      if ('ptr_wrapper' in obj) {
        const pw = obj.ptr_wrapper;
        if (pw.data != null) {
          ptrs[pw.id] = { _id: pw.id, ...pw.data };
        }
      }
      for (const v of Object.values(obj)) collectPtrs(v);
    }
  }

  collectPtrs(sceneData);
  return ptrs;
}

function undoPtrStuff(ptrs, x) {
  if (!x || typeof x !== 'object') return [x, null];

  function getType(obj) {
    if (obj._polymorphic_type_old) return obj._polymorphic_type_old;
    if (obj._polymorphic_type_new) return obj._polymorphic_type_new;
    if (obj._polymorphic_type_unk) return obj._polymorphic_type_unk;
    return null;
  }

  const type = getType(x);
  if ('ptr_wrapper' in x) {
    const id = x.ptr_wrapper.id;
    return [ptrs[id], type];
  }
  return [x, type];
}

// ---------------------------------------------------------------------------
// Matrix math
// ---------------------------------------------------------------------------

function identity4x4() {
  return [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
}

function mat4Multiply(a, b) {
  const r = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        r[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return r;
}

function scale4x4(sx, sy) {
  return [[sx,0,0,0],[0,sy,0,0],[0,0,1,0],[0,0,0,1]];
}

function translate4x4(tx, ty) {
  return [[1,0,0,tx],[0,1,0,ty],[0,0,1,0],[0,0,0,1]];
}

function mat4Transpose(m) {
  return [
    [m[0][0], m[1][0], m[2][0], m[3][0]],
    [m[0][1], m[1][1], m[2][1], m[3][1]],
    [m[0][2], m[1][2], m[2][2], m[3][2]],
    [m[0][3], m[1][3], m[2][3], m[3][3]],
  ];
}

// Extract 2D affine from a transposed 4x4 matrix for Canvas 2D setTransform(a,b,c,d,e,f).
// In the Python renderer, matrices are stored row-major and used as mat @ vec (row vectors on left).
// After transposing (as Python does with loadMat4(...).T), the 2D affine is:
//   a=m[0][0], b=m[1][0], c=m[0][1], d=m[1][1], e=m[0][3], f=m[1][3]
function mat4ToCanvas(m) {
  return { a: m[0][0], b: m[1][0], c: m[0][1], d: m[1][1], e: m[0][3], f: m[1][3] };
}

function lerpVal(a, b, t) {
  return a * (1.0 - t) + b * t;
}

function lerpVec4(a, b, t) {
  return [lerpVal(a[0],b[0],t), lerpVal(a[1],b[1],t), lerpVal(a[2],b[2],t), lerpVal(a[3],b[3],t)];
}

function lerpMat4(a, b, t) {
  const r = [];
  for (let i = 0; i < 4; i++) {
    r.push([]);
    for (let j = 0; j < 4; j++) {
      r[i].push(lerpVal(a[i][j], b[i][j], t));
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Keyframe interpolation
// ---------------------------------------------------------------------------

function findStartFrame(time, keyframes, timeField) {
  for (let i = 0; i < keyframes.length; i++) {
    if (time < keyframes[i][timeField]) return i - 1;
  }
  return keyframes.length - 1;
}

function findSurroundingFrames(time, keyframes, timeField) {
  const frame = findStartFrame(time, keyframes, timeField);
  const a = keyframes[Math.max(0, frame)];
  const b = keyframes[Math.min(frame + 1, keyframes.length - 1)];
  let t = 0.5;
  if (a !== b) {
    const rel = time - a[timeField];
    const span = b[timeField] - a[timeField];
    t = span < 1e-6 ? 0.5 : rel / span;
  }
  return [a, b, t];
}

function interpolateVisible(frame, keyframes) {
  if (!keyframes.length) return true;
  const [a] = findSurroundingFrames(frame, keyframes, 'Frame');
  return a.Value;
}

function interpolateColorTransform(frame, keyframes) {
  const defaultCT = { Multiplication: [1,1,1,1], Addition: [0,0,0,0] };
  if (!keyframes.length || keyframes[0].Frame !== 1) {
    keyframes = [{ Frame: 1, Value: defaultCT }, ...keyframes];
  }
  const [a] = findSurroundingFrames(frame, keyframes, 'Frame');
  return a.Value;
}

function interpolateTransform(frame, keyframes) {
  const [a, b, t] = findSurroundingFrames(frame, keyframes, 'Frame');
  const mA = mat4Transpose(a.Value.Matrix4x4);
  const mB = mat4Transpose(b.Value.Matrix4x4);
  return lerpMat4(mA, mB, t);
}

function interpolateCharacter(frame, keyframes) {
  const [a] = findSurroundingFrames(frame, keyframes, 'Frame');
  return a.Value;
}

// ---------------------------------------------------------------------------
// StreamingImageLRU — browser-side LRU cache for lazy-loaded flipbook frames
// ---------------------------------------------------------------------------

const STREAMING_CACHE_MAX = 30; // keep at most 30 decoded HTMLImageElements

class StreamingImageLRU {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this._cache = new Map();
    this._pending = new Set();
  }

  get(imageId) {
    const img = this._cache.get(imageId);
    if (img) {
      this._cache.delete(imageId);
      this._cache.set(imageId, img);
    }
    return img || null;
  }

  set(imageId, img) {
    if (this._cache.has(imageId)) {
      this._cache.delete(imageId);
    }
    this._cache.set(imageId, img);
    while (this._cache.size > this.maxSize) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
  }

  has(imageId) { return this._cache.has(imageId); }
  isPending(imageId) { return this._pending.has(imageId); }
  setPending(imageId) { this._pending.add(imageId); }
  clearPending(imageId) { this._pending.delete(imageId); }

  clear() {
    this._cache.clear();
    this._pending.clear();
  }
}

// ---------------------------------------------------------------------------
// RadiumPlayer class
// ---------------------------------------------------------------------------

class RadiumPlayer {
  constructor(canvas, sceneData, imageManifest, imageBaseUrl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sceneData = sceneData;
    this.imageManifest = imageManifest;
    this.imageBaseUrl = imageBaseUrl;

    this.ptrs = buildPtrMap(sceneData);
    this.loadedImages = {};
    this.objs = {};

    this._frame = 0;
    this._playing = false;
    this._loop = true;
    this._speedFactor = 1.0;
    this._rafId = null;
    this._lastTimestamp = null;

    const fs = sceneData.FrameSize;
    this._frameWidth = fs.Right - fs.Left;
    this._frameHeight = fs.Bottom - fs.Top;
    this._frameRate = sceneData.FrameRate || 30;
    this._frameCount = sceneData.Sprite.FrameCount;
    this._frameLabels = sceneData.Sprite.FrameLabels || {};

    canvas.width = this._frameWidth;
    canvas.height = this._frameHeight;

    // Separate static images (load upfront) from streaming frames (lazy LRU)
    this._staticManifest = {};
    this._streamingManifest = {};
    for (const [id, info] of Object.entries(imageManifest)) {
      if (info.streaming) {
        this._streamingManifest[id] = info;
      } else {
        this._staticManifest[id] = info;
      }
    }
    this._streamingCache = new StreamingImageLRU(STREAMING_CACHE_MAX);
  }

  get frameCount() { return this._frameCount; }
  get frameRate() { return this._frameRate; }
  get frameLabels() { return this._frameLabels; }
  get currentFrame() { return Math.floor(this._frame); }
  get playing() { return this._playing; }

  set speedFactor(v) { this._speedFactor = v; }
  get speedFactor() { return this._speedFactor; }

  set loop(v) { this._loop = v; }
  get loop() { return this._loop; }

  /**
   * Load all static (non-streaming) images in controlled batches.
   * Streaming flipbook frames are fetched lazily during rendering.
   *
   * Batching prevents flooding the server with concurrent requests — each
   * request triggers a WASM filesystem mount + DXT decode, and too many
   * concurrent mounts exhaust the Emscripten heap (the "Aborted(OOM)" crash).
   */
  async loadImages() {
    const BATCH_SIZE = 4;
    const ids = Object.keys(this._staticManifest).filter((id) => !this.loadedImages[id]);

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((imageId) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.loadedImages[imageId] = img;
          resolve();
        };
        img.onerror = () => {
          console.warn(`Failed to load radium image: ${imageId}`);
          resolve();
        };
        img.src = `${this.imageBaseUrl}&image=${encodeURIComponent(imageId)}`;
      })));
    }
  }

  play() {
    if (this._playing) return;
    this._playing = true;
    this._lastTimestamp = null;
    this._rafId = requestAnimationFrame((ts) => this._tick(ts));
  }

  pause() {
    this._playing = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  step(delta) {
    this._frame += delta;
    this._clampFrame();
    this._render();
  }

  seekFrame(f) {
    this._frame = f;
    this._clampFrame();
    this._render();
  }

  destroy() {
    this.pause();
    this.loadedImages = {};
    this.objs = {};
    this._streamingCache.clear();
    this._staticManifest = {};
    this._streamingManifest = {};
  }

  _clampFrame() {
    if (this._loop) {
      if (this._frameCount > 0) {
        this._frame = ((this._frame % this._frameCount) + this._frameCount) % this._frameCount;
      }
    } else {
      this._frame = Math.max(0, Math.min(this._frame, this._frameCount - 1));
    }
  }

  _tick(timestamp) {
    if (!this._playing) return;

    if (this._lastTimestamp !== null) {
      const dtSeconds = (timestamp - this._lastTimestamp) / 1000;
      this._frame += dtSeconds * this._frameRate * this._speedFactor;
      this._clampFrame();
    }
    this._lastTimestamp = timestamp;

    this._render();
    this._rafId = requestAnimationFrame((ts) => this._tick(ts));
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Fill with background color
    const bg = this.sceneData.BackgroundColor;
    if (bg) {
      ctx.fillStyle = `rgba(${Math.round(bg[0]*255)},${Math.round(bg[1]*255)},${Math.round(bg[2]*255)},${bg[3]})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    const rootCtx = {
      speedFactor: this._frameRate / 30.0 * this._speedFactor,
      transform: identity4x4(),
      color: { Multiplication: [1,1,1,1], Addition: [0,0,0,0] },
    };

    this._renderSprite(this.sceneData.Sprite, rootCtx, this._frame);

    // Fire frame change callback
    if (this.onFrameChange) this.onFrameChange(this.currentFrame);
  }

  _undoPtrStuff(x) {
    return undoPtrStuff(this.ptrs, x);
  }

  _getImage(imageId) {
    return this.loadedImages[imageId] || null;
  }

  /**
   * Get a streaming image, loading it lazily if needed.
   * Returns the HTMLImageElement if cached, or null if still loading.
   */
  _getStreamingImage(imageId) {
    // Check static images first (backward compat for embedded streaming frames)
    if (this.loadedImages[imageId]) return this.loadedImages[imageId];

    // Check streaming LRU cache
    const cached = this._streamingCache.get(imageId);
    if (cached) return cached;

    // Trigger async fetch if not already pending
    if (!this._streamingCache.isPending(imageId)) {
      this._streamingCache.setPending(imageId);
      const img = new Image();
      img.onload = () => {
        this._streamingCache.set(imageId, img);
        this._streamingCache.clearPending(imageId);
      };
      img.onerror = () => {
        console.warn(`Failed to load streaming image: ${imageId}`);
        this._streamingCache.clearPending(imageId);
      };
      img.src = `${this.imageBaseUrl}&image=${encodeURIComponent(imageId)}`;
    }

    return null;
  }

  /**
   * Prefetch streaming frames around the current playback position.
   */
  _prefetchStreamingFrames(imageFrames, currentIdx, range) {
    const lo = Math.max(0, currentIdx - range);
    const hi = Math.min(imageFrames.length - 1, currentIdx + range);
    for (let i = lo; i <= hi; i++) {
      const [frame] = this._undoPtrStuff(imageFrames[i]);
      if (!frame) continue;
      const [buffer] = this._undoPtrStuff(frame.Buffer);
      if (!buffer) continue;
      const imgId = buffer.Buffer?._imageId;
      if (imgId) this._getStreamingImage(imgId);
    }
  }

  _resolveImageFromPtrWrapper(imagePW) {
    const [imageObj] = this._undoPtrStuff(imagePW);
    if (!imageObj) return null;
    const buf = imageObj.Buffer;
    if (!buf || !buf.Buffer) return null;
    const imageId = buf.Buffer._imageId;
    return imageId ? this._getImage(imageId) : null;
  }

  _applyTransform(ctx, transform, colorTransform) {
    const { a, b, c, d, e, f } = mat4ToCanvas(transform);
    ctx.save();
    ctx.transform(a, b, c, d, e, f);

    // Apply alpha from color multiplication
    if (colorTransform && colorTransform.Multiplication) {
      const alpha = colorTransform.Multiplication[3];
      if (alpha < 1) ctx.globalAlpha *= alpha;
    }
  }

  _renderSprite(spriteData, parentCtx, frameOverride) {
    const frame = frameOverride !== undefined ? Math.floor(frameOverride) : 1;

    for (const elementPW of spriteData.Elements) {
      const [element] = this._undoPtrStuff(elementPW);
      if (!element) continue;

      const visible = interpolateVisible(frame, element.Visible.Keyframes);
      if (!visible) continue;

      const colorTransform = interpolateColorTransform(frame, element.ColorTransform.Keyframes);
      const transform = interpolateTransform(frame, element.Transform.Keyframes);
      const characterPtr = interpolateCharacter(frame, element.Character.Keyframes);

      const childTransform = mat4Multiply(parentCtx.transform, transform);
      const childColor = {
        Multiplication: [
          Math.min(1, parentCtx.color.Multiplication[0] * colorTransform.Multiplication[0]),
          Math.min(1, parentCtx.color.Multiplication[1] * colorTransform.Multiplication[1]),
          Math.min(1, parentCtx.color.Multiplication[2] * colorTransform.Multiplication[2]),
          Math.min(1, parentCtx.color.Multiplication[3] * colorTransform.Multiplication[3]),
        ],
        Addition: [
          Math.min(1, parentCtx.color.Addition[0] + colorTransform.Addition[0]),
          Math.min(1, parentCtx.color.Addition[1] + colorTransform.Addition[1]),
          Math.min(1, parentCtx.color.Addition[2] + colorTransform.Addition[2]),
          Math.min(1, parentCtx.color.Addition[3] + colorTransform.Addition[3]),
        ],
      };

      const childCtx = {
        speedFactor: parentCtx.speedFactor,
        transform: childTransform,
        color: childColor,
      };

      const [character, type] = this._undoPtrStuff(characterPtr);
      if (!character) continue;

      this._renderCharacter(character, type, childCtx);
    }
  }

  _renderCharacter(character, type, ctx) {
    switch (type) {
      case 'Bitmap': this._renderBitmap(character, ctx); break;
      case 'Shape': this._renderShape(character, ctx); break;
      case 'Sprite': this._renderChildSprite(character, ctx); break;
      case 'Text': this._renderText(character, ctx); break;
      case 'StreamingFlipbook': this._renderStreamingFlipbook(character, ctx); break;
      case 'Video': this._renderVideo(character, ctx); break;
      case 'Spine': this._renderSpinePlaceholder(character, ctx); break;
      default:
        // Unknown character type — skip
        break;
    }
  }

  _renderBitmap(bitmap, ctx) {
    const [image] = this._undoPtrStuff(bitmap.Image);
    if (!image) return;

    const htmlImg = this._resolveImageFromPtrWrapper(bitmap.Image);
    if (!htmlImg) return;

    const canvasCtx = this.ctx;
    this._applyTransform(canvasCtx, ctx.transform, ctx.color);

    // Crop to bitmap dimensions (image may be larger due to power-of-2 padding)
    const bw = bitmap.Dimensions.Width;
    const bh = bitmap.Dimensions.Height;
    const iw = image.Dimensions.Width;
    const ih = image.Dimensions.Height;
    const sw = Math.min(htmlImg.naturalWidth, htmlImg.naturalWidth * bw / iw);
    const sh = Math.min(htmlImg.naturalHeight, htmlImg.naturalHeight * bh / ih);

    canvasCtx.drawImage(htmlImg, 0, 0, sw, sh, 0, 0, bw, bh);
    canvasCtx.restore();
  }

  _renderShape(shape, ctx) {
    const [bitmapChar] = this._undoPtrStuff(shape.Bitmap);
    if (!bitmapChar) return;

    const [image] = this._undoPtrStuff(bitmapChar.Image);
    if (!image) return;
    const htmlImg = this._resolveImageFromPtrWrapper(bitmapChar.Image);
    if (!htmlImg) return;

    const canvasCtx = this.ctx;
    this._applyTransform(canvasCtx, ctx.transform, ctx.color);

    const rect = shape.Rectangle;
    const bw = bitmapChar.Dimensions.Width;
    const bh = bitmapChar.Dimensions.Height;
    const iw = image.Dimensions.Width;
    const ih = image.Dimensions.Height;
    const sw = htmlImg.naturalWidth * bw / iw;
    const sh = htmlImg.naturalHeight * bh / ih;

    canvasCtx.drawImage(htmlImg, 0, 0, sw, sh, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
    canvasCtx.restore();
  }

  _renderChildSprite(spriteData, ctx) {
    // Get or create playback state for this sprite
    const id = spriteData._id || spriteData.Character?.Id;
    let state = this.objs[id];
    if (!state) {
      state = { frame: 0 };
      this.objs[id] = state;
    }

    state.frame += ctx.speedFactor;
    const fc = spriteData.FrameCount;
    if (fc > 0) {
      state.frame = ((state.frame % fc) + fc) % fc;
    }

    this._renderSprite(spriteData, ctx, state.frame);
  }

  _renderText(textData, ctx) {
    const canvasCtx = this.ctx;
    this._applyTransform(canvasCtx, ctx.transform, ctx.color);

    // Simplified text rendering — use canvas text APIs
    const bounds = textData.Bounds;
    const color = textData.Color;
    const text = textData.Text || '';

    // Font resolution from the parsed scene
    const [font] = this._undoPtrStuff(textData.Font);
    let fontSize = 24;
    let lineHeight = 30;
    if (font) {
      lineHeight = font.LineHeight || 30;
      fontSize = lineHeight * 0.8;
    }

    canvasCtx.fillStyle = `rgba(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)},${color[3]})`;
    canvasCtx.font = `${fontSize}px sans-serif`;
    canvasCtx.textBaseline = 'top';

    const boundsWidth = bounds.Right - bounds.Left;
    const alignment = textData.Alignment;

    // Simple line-by-line rendering
    const lines = text.split('\n');
    let y = bounds.Top;
    const lineSpacing = textData.LineSpacing || 0;

    for (const line of lines) {
      let x = bounds.Left;
      if (alignment === 1) {
        // Center
        const measured = canvasCtx.measureText(line);
        x = bounds.Left + (boundsWidth - measured.width) / 2;
      } else if (alignment === 2) {
        // Right
        const measured = canvasCtx.measureText(line);
        x = bounds.Right - measured.width;
      }
      canvasCtx.fillText(line, x, y);
      y += lineHeight + lineSpacing;
    }

    canvasCtx.restore();
  }

  _renderStreamingFlipbook(flipbookData, ctx) {
    // Get playback state
    const id = flipbookData.Sprite?.Character?.Id || Math.random();
    let state = this.objs[`sfb_${id}`];
    if (!state) {
      state = { frame: 0 };
      this.objs[`sfb_${id}`] = state;
    }

    state.frame += ctx.speedFactor;
    const fc = flipbookData.Sprite.FrameCount;
    if (fc > 0) state.frame = ((state.frame % fc) + fc) % fc;

    const imageFrames = flipbookData.Images?.Frames || [];
    if (!imageFrames.length) return;

    const frameIdx = Math.max(0, Math.min(Math.round(state.frame / 2), imageFrames.length - 1));
    const [imageFrame] = this._undoPtrStuff(imageFrames[frameIdx]);
    if (!imageFrame) return;

    // Get the streaming image frame's file
    const [buffer] = this._undoPtrStuff(imageFrame.Buffer);
    if (!buffer) return;

    const imageId = buffer.Buffer?._imageId;
    // Use lazy streaming loader (LRU) instead of requiring all images upfront
    const htmlImg = imageId ? this._getStreamingImage(imageId) : null;

    if (htmlImg) {
      // Apply the frame's matrix transform
      const frameMatrix = mat4Transpose(imageFrame.Matrix);
      const frameTransform = mat4Multiply(ctx.transform, frameMatrix);

      const canvasCtx = this.ctx;
      this._applyTransform(canvasCtx, frameTransform, ctx.color);

      const fw = flipbookData.Dimensions.Width;
      const fh = flipbookData.Dimensions.Height;
      canvasCtx.drawImage(htmlImg, 0, 0, htmlImg.naturalWidth, htmlImg.naturalHeight, 0, 0, fw, fh);
      canvasCtx.restore();
    }

    // Prefetch nearby frames to stay ahead of playback
    this._prefetchStreamingFrames(imageFrames, frameIdx, 5);

    // Also render the child sprite
    this._renderSprite(flipbookData.Sprite, ctx, state.frame);
  }

  _renderVideo(videoData, ctx) {
    // Video placeholder — full video playback requires HTML5 video element integration
    const canvasCtx = this.ctx;
    this._applyTransform(canvasCtx, ctx.transform, ctx.color);

    const w = videoData.Dimensions.Width;
    const h = videoData.Dimensions.Height;
    canvasCtx.fillStyle = 'rgba(40, 40, 60, 0.8)';
    canvasCtx.fillRect(0, 0, w, h);
    canvasCtx.fillStyle = '#aaa';
    canvasCtx.font = '14px sans-serif';
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.fillText('Video', w / 2, h / 2);
    canvasCtx.restore();
  }

  _renderSpinePlaceholder(spineData, ctx) {
    const canvasCtx = this.ctx;
    this._applyTransform(canvasCtx, ctx.transform, ctx.color);

    canvasCtx.fillStyle = 'rgba(60, 40, 60, 0.5)';
    canvasCtx.fillRect(-50, -50, 100, 100);
    canvasCtx.fillStyle = '#c8a';
    canvasCtx.font = '12px sans-serif';
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.fillText('Spine', 0, 0);
    canvasCtx.restore();
  }
}

// Expose globally for app.js integration
window.RadiumPlayer = RadiumPlayer;
