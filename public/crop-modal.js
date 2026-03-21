// ---------------------------------------------------------------------------
// Image crop modal for radium image replacement.
// ---------------------------------------------------------------------------

import { state, targetInput, scheduleRenderAll } from './state.js';
import { clamp } from './utils.js';
import { loadRadiumScene } from './scenes.js';

// --- DOM refs ---
const cropModalBackdrop = document.getElementById('cropModalBackdrop');
const cropModalCanvas = document.getElementById('cropModalCanvas');
const cropModalCanvasWrap = document.getElementById('cropModalCanvasWrap');
const cropModalInfo = document.getElementById('cropModalInfo');
const cropModalClose = document.getElementById('cropModalClose');
const cropModalCancel = document.getElementById('cropModalCancel');
const cropModalConfirm = document.getElementById('cropModalConfirm');

// --- State ---
const cropState = {
  sourceImage: null,
  targetWidth: 0,
  targetHeight: 0,
  scenePath: '',
  imageId: '',
  cropX: 0,
  cropY: 0,
  cropW: 0,
  cropH: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  displayScale: 1,
};

// --- Functions ---

export function openCropModal(sourceImage, targetWidth, targetHeight, scenePath, imageId) {
  cropState.sourceImage = sourceImage;
  cropState.targetWidth = targetWidth;
  cropState.targetHeight = targetHeight;
  cropState.scenePath = scenePath;
  cropState.imageId = imageId;

  const targetAspect = targetWidth / targetHeight;
  const srcW = sourceImage.naturalWidth;
  const srcH = sourceImage.naturalHeight;
  let cw, ch;
  if (srcW / srcH > targetAspect) {
    ch = srcH;
    cw = Math.round(ch * targetAspect);
  } else {
    cw = srcW;
    ch = Math.round(cw / targetAspect);
  }
  cropState.cropX = Math.round((srcW - cw) / 2);
  cropState.cropY = Math.round((srcH - ch) / 2);
  cropState.cropW = cw;
  cropState.cropH = ch;

  cropModalInfo.textContent =
    `Source: ${srcW}\u00D7${srcH}  \u2192  Target: ${targetWidth}\u00D7${targetHeight}. ` +
    `Drag to reposition the crop area.`;

  cropModalBackdrop.hidden = false;
  drawCropCanvas();
}

export function closeCropModal() {
  cropModalBackdrop.hidden = true;
  cropState.sourceImage = null;
}

function drawCropCanvas() {
  const img = cropState.sourceImage;
  if (!img) return;

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const wrapRect = cropModalCanvasWrap.getBoundingClientRect();
  const maxW = wrapRect.width - 40;
  const maxH = wrapRect.height - 40;
  const scale = Math.min(1, maxW / srcW, maxH / srcH);
  const dispW = Math.round(srcW * scale);
  const dispH = Math.round(srcH * scale);

  cropModalCanvas.width = dispW;
  cropModalCanvas.height = dispH;
  cropState.displayScale = 1 / scale;

  const ctx = cropModalCanvas.getContext('2d');
  ctx.clearRect(0, 0, dispW, dispH);
  ctx.drawImage(img, 0, 0, dispW, dispH);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  const cx = cropState.cropX / cropState.displayScale;
  const cy = cropState.cropY / cropState.displayScale;
  const cw = cropState.cropW / cropState.displayScale;
  const ch = cropState.cropH / cropState.displayScale;

  ctx.fillRect(0, 0, dispW, cy);
  ctx.fillRect(0, cy + ch, dispW, dispH - cy - ch);
  ctx.fillRect(0, cy, cx, ch);
  ctx.fillRect(cx + cw, cy, dispW - cx - cw, ch);

  ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx, cy, cw, ch);

  const handleSize = 8;
  ctx.fillStyle = 'rgba(250, 204, 21, 1)';
  for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }
}

function cropCanvasPointerDown(e) {
  const rect = cropModalCanvas.getBoundingClientRect();
  cropState.dragging = true;
  cropState.dragStartX = e.clientX - rect.left;
  cropState.dragStartY = e.clientY - rect.top;
  cropState._origCropX = cropState.cropX;
  cropState._origCropY = cropState.cropY;
  e.preventDefault();
}

function cropCanvasPointerMove(e) {
  if (!cropState.dragging) return;
  const rect = cropModalCanvas.getBoundingClientRect();
  const curX = e.clientX - rect.left;
  const curY = e.clientY - rect.top;
  const dx = (curX - cropState.dragStartX) * cropState.displayScale;
  const dy = (curY - cropState.dragStartY) * cropState.displayScale;

  const img = cropState.sourceImage;
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  cropState.cropX = clamp(Math.round(cropState._origCropX + dx), 0, srcW - cropState.cropW);
  cropState.cropY = clamp(Math.round(cropState._origCropY + dy), 0, srcH - cropState.cropH);
  drawCropCanvas();
}

function cropCanvasPointerUp() {
  cropState.dragging = false;
}

function cropCanvasWheel(e) {
  e.preventDefault();
  const img = cropState.sourceImage;
  if (!img) return;
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const targetAspect = cropState.targetWidth / cropState.targetHeight;

  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  let newW = cropState.cropW * (1 + delta);
  let newH = newW / targetAspect;

  if (newW > srcW) { newW = srcW; newH = newW / targetAspect; }
  if (newH > srcH) { newH = srcH; newW = newH * targetAspect; }
  if (newW < 16 || newH < 16) return;

  newW = Math.round(newW);
  newH = Math.round(newH);

  const cx = cropState.cropX + cropState.cropW / 2;
  const cy = cropState.cropY + cropState.cropH / 2;
  cropState.cropW = newW;
  cropState.cropH = newH;
  cropState.cropX = clamp(Math.round(cx - newW / 2), 0, srcW - newW);
  cropState.cropY = clamp(Math.round(cy - newH / 2), 0, srcH - newH);
  drawCropCanvas();
}

function cropAndExport() {
  return new Promise((resolve) => {
    const offscreen = document.createElement('canvas');
    offscreen.width = cropState.targetWidth;
    offscreen.height = cropState.targetHeight;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(
      cropState.sourceImage,
      cropState.cropX, cropState.cropY, cropState.cropW, cropState.cropH,
      0, 0, cropState.targetWidth, cropState.targetHeight,
    );
    offscreen.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

// --- Radium image replace ---

export async function replaceRadiumImage(scenePath, imageId, file) {
  if (!scenePath || !imageId || !file) return;

  state.imageReplacePending = true;
  state.imageReplaceError = '';
  state.imageReplaceSuccess = null;
  scheduleRenderAll();

  try {
    const target = targetInput.value.trim();
    const res = await fetch(
      `/api/radium-image-replace?path=${encodeURIComponent(target)}&scene=${encodeURIComponent(scenePath)}&image=${encodeURIComponent(imageId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Image replace failed');
    }

    delete state.radiumScenesByPath[scenePath];
    state.imageReplaceSuccess = imageId;
    loadRadiumScene(scenePath);
  } catch (error) {
    state.imageReplaceError = error.message;
  } finally {
    state.imageReplacePending = false;
    scheduleRenderAll();
  }
}

export async function handleRadiumImageReplace(file, scenePath, imageId) {
  const sceneData = state.radiumScenesByPath[scenePath];
  const imageNode = sceneData?.assetTree?.images?.find((img) => img.id === imageId);

  if (!imageNode) {
    await replaceRadiumImage(scenePath, imageId, file);
    return;
  }

  const img = await loadImageFromFile(file);
  const targetW = imageNode.width;
  const targetH = imageNode.height;

  if (img.naturalWidth === targetW && img.naturalHeight === targetH) {
    URL.revokeObjectURL(img.src);
    await replaceRadiumImage(scenePath, imageId, file);
  } else {
    openCropModal(img, targetW, targetH, scenePath, imageId);
  }
}

// --- Init: wire crop modal event listeners ---

export function initCropModal() {
  cropModalCanvas.addEventListener('pointerdown', cropCanvasPointerDown);
  window.addEventListener('pointermove', cropCanvasPointerMove);
  window.addEventListener('pointerup', cropCanvasPointerUp);
  cropModalCanvasWrap.addEventListener('wheel', cropCanvasWheel, { passive: false });

  cropModalClose.addEventListener('click', closeCropModal);
  cropModalCancel.addEventListener('click', closeCropModal);
  cropModalBackdrop.addEventListener('click', (e) => {
    if (e.target === cropModalBackdrop) closeCropModal();
  });

  cropModalConfirm.addEventListener('click', async () => {
    const blob = await cropAndExport();
    const { scenePath, imageId } = cropState;
    closeCropModal();
    await replaceRadiumImage(scenePath, imageId, blob);
  });
}
