/**
 * Seam blending / feathering along internal grid edges.
 * Reduces visible seams where sections meet so the combined painting looks like one surface.
 */

/**
 * Blend pixels in a strip along a vertical edge (between two sections side-by-side).
 * Cross-fade: left side of strip uses left pixel more, right side uses right pixel more.
 * @param {ImageData} data - full canvas ImageData
 * @param {number} edgeX - x position of the seam (center of strip)
 * @param {number} y1 - top of edge
 * @param {number} y2 - bottom of edge
 * @param {number} stripWidth - pixels to blend on each side (total strip = 2 * stripWidth)
 */
function blendVerticalStrip(data, edgeX, y1, y2, stripWidth) {
  const w = data.width;
  const h = data.height;
  const half = Math.max(1, Math.min(stripWidth, Math.floor(w / 4)));

  for (let y = Math.max(0, y1); y < Math.min(h, y2); y++) {
    for (let d = -half; d <= half; d++) {
      const px = edgeX + d;
      if (px < 0 || px >= w) continue;
      const idx = (y * w + px) * 4;
      const leftX = Math.max(0, edgeX - half - 1);
      const rightX = Math.min(w - 1, edgeX + half + 1);
      const leftIdx = (y * w + leftX) * 4;
      const rightIdx = (y * w + rightX) * 4;
      const t = (d + half) / (2 * half + 1);
      const t1 = 1 - t;
      data.data[idx] = Math.round(data.data[leftIdx] * t1 + data.data[rightIdx] * t);
      data.data[idx + 1] = Math.round(data.data[leftIdx + 1] * t1 + data.data[rightIdx + 1] * t);
      data.data[idx + 2] = Math.round(data.data[leftIdx + 2] * t1 + data.data[rightIdx + 2] * t);
      data.data[idx + 3] = Math.round(data.data[leftIdx + 3] * t1 + data.data[rightIdx + 3] * t);
    }
  }
}

/**
 * Blend pixels in a strip along a horizontal edge (between two sections stacked).
 */
function blendHorizontalStrip(data, x1, x2, edgeY, stripWidth) {
  const w = data.width;
  const h = data.height;
  const half = Math.max(1, Math.min(stripWidth, Math.floor(h / 4)));

  for (let x = Math.max(0, x1); x < Math.min(w, x2); x++) {
    for (let d = -half; d <= half; d++) {
      const py = edgeY + d;
      if (py < 0 || py >= h) continue;
      const idx = (py * w + x) * 4;
      const topY = Math.max(0, edgeY - half - 1);
      const bottomY = Math.min(h - 1, edgeY + half + 1);
      const topIdx = (topY * w + x) * 4;
      const bottomIdx = (bottomY * w + x) * 4;
      const t = (d + half) / (2 * half + 1);
      const t1 = 1 - t;
      data.data[idx] = Math.round(data.data[topIdx] * t1 + data.data[bottomIdx] * t);
      data.data[idx + 1] = Math.round(data.data[topIdx + 1] * t1 + data.data[bottomIdx + 1] * t);
      data.data[idx + 2] = Math.round(data.data[topIdx + 2] * t1 + data.data[bottomIdx + 2] * t);
      data.data[idx + 3] = Math.round(data.data[topIdx + 3] * t1 + data.data[bottomIdx + 3] * t);
    }
  }
}

/**
 * Apply seam blending along all internal edges (section-to-section boundaries).
 * Call this after all sections are warped onto the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<number, { x: number, y: number, width: number, height: number }>} sectionToRect - section index -> rect in ctx coordinates
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} section_relations
 * @param {number} [stripWidth=4] - pixels to feather on each side of the seam
 */
export function blendSeams(ctx, sectionToRect, section_relations, stripWidth = 4) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const data = ctx.getImageData(0, 0, w, h);

  for (let i = 0; i < section_relations.length; i++) {
    const rect = sectionToRect.get(i);
    if (!rect) continue;

    const rel = section_relations[i] || {};
    const { x, y, width, height } = rect;

    for (const j of rel.right_of || []) {
      const rightRect = sectionToRect.get(j);
      if (!rightRect) continue;
      const edgeX = Math.round(x + width);
      blendVerticalStrip(data, edgeX, Math.round(y), Math.round(y + height), stripWidth);
    }
    for (const j of rel.below || []) {
      const belowRect = sectionToRect.get(j);
      if (!belowRect) continue;
      const edgeY = Math.round(y + height);
      blendHorizontalStrip(data, Math.round(x), Math.round(x + width), edgeY, stripWidth);
    }
  }

  ctx.putImageData(data, 0, 0);
}
