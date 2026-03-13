/**
 * Draw section quads on canvas; draw outer boundary; draw grid.
 * Uses perspective transform to draw each section image into its quad.
 */

import {
  getInversePerspectiveTransform,
  applyHomography,
  sampleBilinear,
  pointInQuad,
} from './perspective.js';

/** @type {Map<HTMLImageElement, ImageData>} */
const sectionImageDataCache = new Map();

/** @type {WeakMap<HTMLImageElement, Record<number, { data: ImageData, w: number, h: number }>>} */
const sectionRotatedCache = new WeakMap();

/**
 * Get ImageData for a section image (cached).
 * @param {HTMLImageElement} img
 * @returns {ImageData|null}
 */
function getSectionImageData(img) {
  if (!img || img.naturalWidth === 0) return null;
  let data = sectionImageDataCache.get(img);
  if (!data) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    data = ctx.getImageData(0, 0, c.width, c.height);
    sectionImageDataCache.set(img, data);
  }
  return data;
}

/**
 * Get section image as ImageData with rotation applied (0, 90, 180, 270). Cached per img + rotation.
 * @param {HTMLImageElement} img
 * @param {number} rotationDegrees
 * @returns {{ data: ImageData, w: number, h: number }|null} logical size (w,h) for homography
 */
function getSectionImageDataRotated(img, rotationDegrees) {
  if (!img || img.naturalWidth === 0) return null;
  const rot = ((rotationDegrees % 360) + 360) % 360;
  const normRot = rot === 90 || rot === 270 ? (rot === 90 ? 90 : 270) : (rot === 180 ? 180 : 0);

  let byRot = sectionRotatedCache.get(img);
  if (!byRot) {
    byRot = {};
    sectionRotatedCache.set(img, byRot);
  }
  if (byRot[normRot]) return byRot[normRot];

  const w = img.naturalWidth;
  const h = img.naturalHeight;

  if (normRot === 0) {
    const data = getSectionImageData(img);
    if (!data) return null;
    byRot[0] = { data, w, h };
    return byRot[0];
  }

  const canvas = document.createElement('canvas');
  if (normRot === 90 || normRot === 270) {
    canvas.width = h;
    canvas.height = w;
  } else {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((normRot * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.drawImage(img, 0, 0);
  ctx.restore();

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const logicalW = normRot === 90 || normRot === 270 ? h : w;
  const logicalH = normRot === 90 || normRot === 270 ? w : h;
  byRot[normRot] = { data, w: logicalW, h: logicalH };
  return byRot[normRot];
}

/**
 * View transform: editor space -> canvas space.
 * @param {{ minX: number, minY: number, width: number, height: number }} editorBounds
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} padding
 * @returns {{ scale: number, offsetX: number, offsetY: number }}
 */
export function viewTransform(editorBounds, canvasWidth, canvasHeight, padding = 8) {
  const scale = Math.min(
    (canvasWidth - 2 * padding) / editorBounds.width,
    (canvasHeight - 2 * padding) / editorBounds.height
  );
  const offsetX = padding - editorBounds.minX * scale;
  const offsetY = padding - editorBounds.minY * scale;
  return { scale, offsetX, offsetY };
}

/**
 * Transform a point from editor to canvas.
 */
export function editorToCanvas(editorX, editorY, view) {
  return [
    editorX * view.scale + view.offsetX,
    editorY * view.scale + view.offsetY,
  ];
}

/**
 * Transform a point from canvas to editor space.
 */
export function canvasToEditor(canvasX, canvasY, view) {
  return [
    (canvasX - view.offsetX) / view.scale,
    (canvasY - view.offsetY) / view.scale,
  ];
}

/**
 * Draw sections as quads on the canvas with rotation applied and clear dissection borders.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ sections: Array<{ index: number, corners: number[][], image?: HTMLImageElement, output_width_px: number, output_height_px: number, rotation_degrees?: number }>, editorBounds: object, visibleSections?: Set<number>, sectionLayerOrder?: number[] }} state
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * sectionLayerOrder: last element = top-most; sections drawn in this order so top is drawn last.
 */
export function drawSections(ctx, state, view) {
  const { sections, editorBounds, visibleSections, sectionLayerOrder } = state;
  if (!sections || !editorBounds) return;

  const order = sectionLayerOrder && sectionLayerOrder.length === sections.length
    ? sectionLayerOrder.slice()
    : sections.map((s) => s.index);
  const byIndex = new Map(sections.map((s) => [s.index, s]));

  for (const sectionIndex of order) {
    const section = byIndex.get(sectionIndex);
    if (!section) continue;
    if (visibleSections != null && !visibleSections.has(sectionIndex)) continue;
    if (!section.image || section.corners.length !== 4) continue;

    const rot = section.rotation_degrees != null ? section.rotation_degrees : 0;
    const rotated = getSectionImageDataRotated(section.image, rot);
    if (!rotated) continue;
    const { data: imgData, w: sw, h: sh } = rotated;

    const quadEditor = section.corners;
    const quadCanvas = quadEditor.map(([x, y]) => editorToCanvas(x, y, view));

    const Hinv = getInversePerspectiveTransform(sw, sh, quadCanvas);
    if (!Hinv) continue;

    const scaleX = imgData.width / sw;
    const scaleY = imgData.height / sh;

    const xs = quadCanvas.map((p) => p[0]);
    const ys = quadCanvas.map((p) => p[1]);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)) + 1);

    const outData = ctx.getImageData(minX, minY, maxX - minX, maxY - minY);

    for (let py = minY; py < maxY; py++) {
      for (let px = minX; px < maxX; px++) {
        if (!pointInQuad(quadCanvas, px, py)) continue;
        const [s, t] = applyHomography(Hinv, px, py);
        if (s < 0 || s >= sw || t < 0 || t >= sh) continue;
        const [r, g, b, a] = sampleBilinear(imgData, s * scaleX, t * scaleY);
        const idx = ((py - minY) * (maxX - minX) + (px - minX)) * 4;
        outData.data[idx] = r;
        outData.data[idx + 1] = g;
        outData.data[idx + 2] = b;
        outData.data[idx + 3] = a;
      }
    }
    ctx.putImageData(outData, minX, minY);

    // Dissection border: thin stroke around section quad for clear separation
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(quadCanvas[0][0], quadCanvas[0][1]);
    for (let i = 1; i < quadCanvas.length; i++) {
      ctx.lineTo(quadCanvas[i][0], quadCanvas[i][1]);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/**
 * Draw outer boundary polygon.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} polygon - [x,y] in editor space
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {string} [strokeStyle='cyan']
 */
export function drawOuterBoundary(ctx, polygon, view, strokeStyle = 'cyan') {
  if (!polygon || polygon.length < 2) return;
  const pts = polygon.map(([x, y]) => editorToCanvas(x, y, view));
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Draw a single boundary edge with highlight (for add-corner hover).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} polygon - [x,y] in editor space
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {number} edgeIndex - index of edge (vertex i to i+1)
 * @param {string} [strokeStyle='lime']
 */
export function drawOuterBoundaryEdgeHighlight(ctx, polygon, view, edgeIndex, strokeStyle = 'lime') {
  if (!polygon || polygon.length < 2 || edgeIndex < 0 || edgeIndex >= polygon.length) return;
  const i = edgeIndex;
  const j = (i + 1) % polygon.length;
  const [x0, y0] = editorToCanvas(polygon[i][0], polygon[i][1], view);
  const [x1, y1] = editorToCanvas(polygon[j][0], polygon[j][1], view);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * Draw a single boundary vertex with highlight (for remove-corner hover).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} polygon - [x,y] in editor space
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {number} vertexIndex
 * @param {number} [radius=8] - canvas pixels
 */
export function drawOuterBoundaryVertexHighlight(ctx, polygon, view, vertexIndex, radius = 8) {
  if (!polygon || vertexIndex < 0 || vertexIndex >= polygon.length) return;
  const [cx, cy] = editorToCanvas(polygon[vertexIndex][0], polygon[vertexIndex][1], view);
  ctx.fillStyle = 'rgba(255, 80, 80, 0.6)';
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw all boundary vertices with numeric labels (for remove-corner mode).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} polygon
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {number} [radius=7]
 */
export function drawAllBoundaryVerticesWithLabels(ctx, polygon, view, radius = 7) {
  if (!polygon?.length) return;
  const fontSize = Math.max(10, Math.min(14, radius * 2));
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < polygon.length; i++) {
    const [ex, ey] = polygon[i];
    const [cx, cy] = editorToCanvas(ex, ey, view);
    ctx.fillStyle = 'rgba(255, 80, 80, 0.5)';
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i), cx, cy);
  }
}

/**
 * Draw section corner as a small circle when hovering (add-corner mode).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} editorX
 * @param {number} editorY
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {number} [radius=6]
 */
export function drawSectionCornerHighlight(ctx, editorX, editorY, view, radius = 6) {
  const [cx, cy] = editorToCanvas(editorX, editorY, view);
  ctx.fillStyle = 'rgba(100, 255, 100, 0.7)';
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw the snapped new-corner position (right-angle) in gold so user sees where the corner will be placed.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} editorX
 * @param {number} editorY
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {number} [radius=7]
 */
export function drawSnappedCornerPreview(ctx, editorX, editorY, view, radius = 7) {
  const [cx, cy] = editorToCanvas(editorX, editorY, view);
  ctx.fillStyle = 'rgba(255, 200, 50, 0.85)';
  ctx.strokeStyle = 'gold';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Small cross to suggest H/V alignment
  const r = radius * 0.6;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}

/**
 * Draw a highlight at negative space (gap) when hovering, so user sees which gap "Remove negative space" will affect.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} editorX
 * @param {number} editorY
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {number} [radius=12]
 */
export function drawNegativeSpaceHighlight(ctx, editorX, editorY, view, radius = 12) {
  const [cx, cy] = editorToCanvas(editorX, editorY, view);
  ctx.fillStyle = 'rgba(255, 180, 80, 0.35)';
  ctx.strokeStyle = 'rgba(255, 160, 60, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw axis-aligned grid (vertical and horizontal lines at cell boundaries).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ xLines: number[], yLines: number[] }} grid - distinct x and y coordinates in editor space
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 */
export function drawGrid(ctx, grid, view, strokeStyle = 'rgba(255,255,255,0.3)') {
  if (!grid || !grid.xLines || !grid.yLines) return;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;

  for (const x of grid.xLines) {
    const [cx] = editorToCanvas(x, 0, view);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, ctx.canvas.height);
    ctx.stroke();
  }
  for (const y of grid.yLines) {
    const [, cy] = editorToCanvas(0, y, view);
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(ctx.canvas.width, cy);
    ctx.stroke();
  }
}

/**
 * Draw the output rectangle (content area) after straighten.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, width: number, height: number }} outputRect - editor space
 * @param view
 */
export function drawOutputRect(ctx, outputRect, view, strokeStyle = 'lime') {
  if (!outputRect) return;
  const { x, y, width, height } = outputRect;
  const [x0, y0] = editorToCanvas(x, y, view);
  const [x1, y1] = editorToCanvas(x + width, y + height, view);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

/**
 * Draw section edges (output-space rectangles) from partition. Shows how the canvas
 * is divided into new sections for export and manifest.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<number, { x: number, y: number, width: number, height: number }>} sectionToRect
 * @param {{ x: number, y: number, width: number, height: number }} outputRect
 * @param view
 * @param {string} [strokeStyle='rgba(0, 255, 200, 0.85)']
 */
export function drawSectionEdges(ctx, sectionToRect, outputRect, view, strokeStyle = 'rgba(0, 255, 200, 0.85)') {
  if (!sectionToRect || !outputRect) return;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  for (const [, rect] of sectionToRect) {
    const [x0, y0] = editorToCanvas(rect.x, rect.y, view);
    const [x1, y1] = editorToCanvas(rect.x + rect.width, rect.y + rect.height, view);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

/**
 * Draw place-lock composite boundary, section outlines with labels, and optional snap preview.
 * Makes the locked layout and drop result obvious.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<number, { x: number, y: number, width: number, height: number }>} sectionToRect
 * @param {{ x: number, y: number, width: number, height: number }} outputRect - composite bounds
 * @param view
 * @param {{ previewRect?: { x, y, width, height }, previewSectionIndex?: number, highlightTargetIndex?: number }} [options]
 */
export function drawPlaceLockOutlines(ctx, sectionToRect, outputRect, view, options = {}) {
  if (!outputRect || !view) return;
  const { previewRect, previewSectionIndex, highlightTargetIndex } = options;

  const labelFont = 'bold 14px sans-serif';
  const minCanvasDim = 20;

  function drawRectOutline(rect, stroke, lineWidth, dashed = false) {
    const [x0, y0] = editorToCanvas(rect.x, rect.y, view);
    const [x1, y1] = editorToCanvas(rect.x + rect.width, rect.y + rect.height, view);
    const w = x1 - x0;
    const h = y1 - y0;
    if (Math.abs(w) < 2 || Math.abs(h) < 2) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    if (dashed) {
      ctx.setLineDash([8, 6]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.strokeRect(x0, y0, w, h);
  }

  function drawLabel(rect, text) {
    const [x0, y0] = editorToCanvas(rect.x, rect.y, view);
    const [x1, y1] = editorToCanvas(rect.x + rect.width, rect.y + rect.height, view);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < minCanvasDim || h < minCanvasDim) return;
    ctx.font = labelFont;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    const pad = 6;
    const tx = x0 + pad;
    const ty = y0 + pad + 14;
    ctx.strokeText(text, tx, ty);
    ctx.fillText(text, tx, ty);
  }

  if (sectionToRect?.size) {
    for (const [idx, rect] of sectionToRect) {
      const isHighlight = idx === highlightTargetIndex;
      drawRectOutline(
        rect,
        isHighlight ? 'rgba(255, 220, 80, 0.95)' : 'rgba(0, 200, 255, 0.9)',
        isHighlight ? 4 : 2.5
      );
      drawLabel(rect, `S${idx}`);
    }
  }

  drawRectOutline(outputRect, 'rgba(0, 255, 140, 0.95)', 2.5);

  if (previewRect) {
    drawRectOutline(previewRect, 'rgba(255, 180, 80, 0.9)', 3, true);
    if (previewSectionIndex != null) drawLabel(previewRect, `S${previewSectionIndex} →`);
  }
  ctx.setLineDash([]);
}

/**
 * Draw the place-lock center drag handle (circle at section center). Made prominent for visibility.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} centerEditorX
 * @param {number} centerEditorY
 * @param view
 */
export function drawPlaceLockCenterHandle(ctx, centerEditorX, centerEditorY, view) {
  if (!view) return;
  const [cx, cy] = editorToCanvas(centerEditorX, centerEditorY, view);
  const r = Math.max(14, 22 * view.scale);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 200, 80, 0.8)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 220, 60, 0.95)';
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('drag', cx, cy);
}

/**
 * Draw line from center to current cursor (connection indicator while dragging).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} fromEditorX
 * @param {number} fromEditorY
 * @param {number} toEditorX
 * @param {number} toEditorY
 * @param view
 */
export function drawPlaceLockConnectionLine(ctx, fromEditorX, fromEditorY, toEditorX, toEditorY, view) {
  if (!view) return;
  const [x0, y0] = editorToCanvas(fromEditorX, fromEditorY, view);
  const [x1, y1] = editorToCanvas(toEditorX, toEditorY, view);
  ctx.strokeStyle = 'rgba(255, 180, 80, 0.95)';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Draw shared edges (connections) between locked sections. segments: Array<{ start: [x,y], end: [x,y] }> in editor space.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ start: number[], end: number[] }[]} segments
 * @param view
 */
export function drawPlaceLockSharedEdges(ctx, segments, view) {
  if (!view || !segments?.length) return;
  ctx.strokeStyle = 'rgba(0, 255, 100, 0.95)';
  ctx.lineWidth = 4;
  for (const seg of segments) {
    const [x0, y0] = editorToCanvas(seg.start[0], seg.start[1], view);
    const [x1, y1] = editorToCanvas(seg.end[0], seg.end[1], view);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

/**
 * Draw highlight for a movable section edge (vertical or horizontal line).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ type: 'v'|'h', value: number, min: number, max: number }} edge - editor space
 * @param view
 */
export function drawSectionEdgeHighlight(ctx, edge, view) {
  if (!edge || !view) return;
  const [ax, ay] = editorToCanvas(edge.type === 'v' ? edge.value : edge.min, edge.type === 'v' ? edge.min : edge.value, view);
  const [bx, by] = editorToCanvas(edge.type === 'v' ? edge.value : edge.max, edge.type === 'v' ? edge.max : edge.value, view);
  ctx.strokeStyle = 'rgba(255, 255, 100, 0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

/**
 * Draw the 4 edges of a section quad (editor space) with highlight. Used when hovering in place-lock mode.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} corners - 4 [x,y] points (closed quad)
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 */
export function drawSectionQuadEdgesHighlight(ctx, corners, view) {
  if (!corners || corners.length !== 4 || !view) return;
  ctx.strokeStyle = 'rgba(0, 255, 200, 0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const [ex, ey] = corners[i];
    const [cx, cy] = editorToCanvas(ex, ey, view);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.closePath();
  ctx.stroke();
}

/**
 * Draw reference composite image (e.g. composite.png) over the canvas with opacity.
 * Aligns to editor bounds so it overlays the section content.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} refImage
 * @param {{ minX: number, minY: number, width: number, height: number }} editorBounds
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {number} [opacity=0.4]
 */
export function drawReferenceOverlay(ctx, refImage, editorBounds, view, opacity = 0.4) {
  if (!refImage?.naturalWidth || !editorBounds) return;
  const x0 = view.offsetX + editorBounds.minX * view.scale;
  const y0 = view.offsetY + editorBounds.minY * view.scale;
  const w = editorBounds.width * view.scale;
  const h = editorBounds.height * view.scale;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(refImage, 0, 0, refImage.naturalWidth, refImage.naturalHeight, x0, y0, w, h);
  ctx.restore();
}
