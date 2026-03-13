/**
 * Quad→rect warp: map section image (rect) to target rectangle using perspective.
 * Section image is drawn into the target rect (output space).
 */

import {
  getInversePerspectiveTransform,
  applyHomography,
  sampleBilinear,
} from './perspective.js';

/**
 * Draw section image onto a canvas with rotation applied (0, 90, 180, 270).
 * @param {HTMLImageElement} sectionImage
 * @param {number} rotationDegrees - 0, 90, 180, or 270
 * @returns {{ canvas: HTMLCanvasElement, srcW: number, srcH: number }}
 */
function sectionImageWithRotation(sectionImage, rotationDegrees) {
  const rot = ((rotationDegrees % 360) + 360) % 360;
  const w = sectionImage.naturalWidth;
  const h = sectionImage.naturalHeight;

  const canvas = document.createElement('canvas');
  if (rot === 90 || rot === 270) {
    canvas.width = h;
    canvas.height = w;
  } else {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, srcW: w, srcH: h };

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.drawImage(sectionImage, 0, 0);
  ctx.restore();

  const srcW = rot === 90 || rot === 270 ? h : w;
  const srcH = rot === 90 || rot === 270 ? w : h;
  return { canvas, srcW, srcH };
}

/**
 * Warp a section image into a target rectangle on the given context.
 * Uses inverse homography: target rect (axis-aligned) corresponds to section image (0,0)-(srcW,srcH).
 * @param {CanvasRenderingContext2D} ctx - destination (e.g. export canvas)
 * @param {HTMLImageElement} sectionImage
 * @param {number} srcW - section image logical width (output_width_px)
 * @param {number} srcH - section image logical height (output_height_px)
 * @param {{ x: number, y: number, width: number, height: number }} targetRect - in ctx coordinates
 * @param {number} [rotationDegrees=0] - orientation to apply (0, 90, 180, 270); from manifest
 */
export function warpSectionToRect(ctx, sectionImage, srcW, srcH, targetRect, rotationDegrees = 0) {
  const rot = ((rotationDegrees % 360) + 360) % 360;
  let srcCanvas;
  let logicalW = srcW;
  let logicalH = srcH;

  if (rot !== 0) {
    const { canvas, srcW: rW, srcH: rH } = sectionImageWithRotation(sectionImage, rot);
    srcCanvas = canvas;
    logicalW = rW;
    logicalH = rH;
  } else {
    srcCanvas = document.createElement('canvas');
    srcCanvas.width = sectionImage.naturalWidth;
    srcCanvas.height = sectionImage.naturalHeight;
    const srcCtx = srcCanvas.getContext('2d');
    if (srcCtx) srcCtx.drawImage(sectionImage, 0, 0);
  }

  const tw = Math.max(1, Math.round(targetRect.width));
  const th = Math.max(1, Math.round(targetRect.height));
  const tx0 = targetRect.x;
  const ty0 = targetRect.y;

  const targetQuad = [
    [tx0, ty0],
    [tx0 + tw, ty0],
    [tx0 + tw, ty0 + th],
    [tx0, ty0 + th],
  ];

  const Hinv = getInversePerspectiveTransform(logicalW, logicalH, targetQuad);
  if (!Hinv) return;

  const srcData = srcCanvas.getContext('2d')?.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  if (!srcData) return;

  const scaleX = srcCanvas.width / logicalW;
  const scaleY = srcCanvas.height / logicalH;

  const outData = ctx.getImageData(tx0, ty0, tw, th);

  for (let dy = 0; dy < th; dy++) {
    for (let dx = 0; dx < tw; dx++) {
      const px = tx0 + dx + 0.5;
      const py = ty0 + dy + 0.5;
      const [s, t] = applyHomography(Hinv, px, py);
      if (s >= 0 && s < logicalW && t >= 0 && t < logicalH) {
        const [r, g, b, a] = sampleBilinear(srcData, s * scaleX, t * scaleY);
        const idx = (dy * tw + dx) * 4;
        outData.data[idx] = r;
        outData.data[idx + 1] = g;
        outData.data[idx + 2] = b;
        outData.data[idx + 3] = a;
      }
    }
  }
  ctx.putImageData(outData, tx0, ty0);
}
