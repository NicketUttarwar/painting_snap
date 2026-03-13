/**
 * Section Image Correction Editor – main app.
 * Load folder → display sections → set boundary (corners already right-angle) → preview & save.
 */

import { loadManifest, loadSectionImages, getEditorBounds, getOuterBoundaryPolygon, stretchSectionsToRectangles } from './manifest.js';
import {
  createOuterBoundary,
  getPolygon,
  addVertexAtPoint,
  removeVertex,
  getClosestBoundaryEdgeIndex,
  getClosestBoundaryVertexIndex,
  snapNewCornerToRightAngle,
  pointInPolygon,
} from './outer-boundary.js';
import { straighten, applyMargin } from './straighten.js';
import {
  viewTransform,
  drawSections,
  drawOuterBoundary,
  drawGrid,
  drawOutputRect,
  drawSectionEdges,
  drawPlaceLockOutlines,
  drawPlaceLockCenterHandle,
  drawPlaceLockConnectionLine,
  drawPlaceLockSharedEdges,
  drawSectionQuadEdgesHighlight,
  editorToCanvas,
  canvasToEditor,
  drawOuterBoundaryEdgeHighlight,
  drawOuterBoundaryVertexHighlight,
  drawSectionCornerHighlight,
  drawSnappedCornerPreview,
  drawAllBoundaryVerticesWithLabels,
} from './canvas-render.js';
import { pointInQuad } from './perspective.js';
import { partition } from './partition.js';
import {
  buildExportCanvas,
  downloadCanvas,
  getExportBlobsAndManifest,
} from './export.js';
import { validate } from './validation.js';
import { detectSectionOrientationsFromComposite } from './orientation-from-composite.js';

const dropZone = document.getElementById('drop-zone');
const editorWrap = document.getElementById('editor-wrap');
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const btnChooseSet = document.getElementById('btn-choose-set');
const leftPanel = document.getElementById('left-panel');
const btnClosePanel = document.getElementById('btn-close-panel');
const folderListEl = document.getElementById('folder-list');
const btnPreview = document.getElementById('btn-preview');
const folderNameEl = document.getElementById('folder-name');
const previewModal = document.getElementById('preview-modal');
const previewCanvas = document.getElementById('preview-canvas');
const btnPreviewDownload = document.getElementById('btn-preview-download');
const btnPreviewSaveFolder = document.getElementById('btn-preview-save-folder');
const btnPreviewClose = document.getElementById('btn-preview-close');
const btnAddCorner = document.getElementById('btn-add-corner');
const btnRemoveCorner = document.getElementById('btn-remove-corner');
const canvasOverlay = document.getElementById('canvas-overlay');
const btnRotateSection = document.getElementById('btn-rotate-section');
const layerStackEl = document.getElementById('layer-stack');
const cornerListEl = document.getElementById('corner-list');
const btnMoveSection = document.getElementById('btn-move-section');
const btnRedoAutoBoundary = document.getElementById('btn-redo-auto-boundary');
const btnResetPlacement = document.getElementById('btn-reset-placement');
const btnUndoLastLock = document.getElementById('btn-undo-last-lock');
const btnPlaceLockSection = document.getElementById('btn-place-lock-section');
const lockedSectionsPanel = document.getElementById('locked-sections-panel');
const lockedSectionsListEl = document.getElementById('locked-sections-list');
const validationWarningsEl = document.getElementById('validation-warnings');

/** Squared distance in editor space for hover hit-test (section corners and boundary vertices). */
const HOVER_THRESHOLD_EDITOR_SQ = 900; // ~30 units

let state = {
  manifest: null,
  sections: null,
  editorBounds: null,
  outerBoundary: null,
  view: null,
  folderName: '',
  getFile: null,
  referenceImage: null,
  visibleSections: null,
  /** Section draw/hit order: last = top-most. Clicking a section brings it to front. */
  sectionLayerOrder: null,
  lastExportCanvas: null,
  /** 'add' | 'remove' – add new boundary corner at section corners, or remove boundary corners. */
  boundaryEditMode: 'add',
  /** When hovering a section corner in add mode: { sectionIndex, cornerIndex, point: [x,y] }. */
  hoveredSectionCorner: null,
  /** Boundary edge index to highlight (add mode). */
  hoveredBoundaryEdge: null,
  /** Boundary vertex index to highlight (remove mode). */
  hoveredBoundaryVertex: null,
  /** Section index under cursor (for rotate button). */
  hoveredSectionIndex: null,
  /** true when "Move section" mode is on; drag moves section quad. */
  moveSectionMode: false,
  /** While dragging: { sectionIndex, startEditor: [x,y], startCorners: number[][] }. */
  dragSection: null,
  /** Set when mouseup ends a section drag so click handler doesn't bring section to front. */
  didDragSection: false,
  /** When true, show section edges (from placement or partition) on canvas. */
  sectionEdgesVisible: false,
  /** Click-to-place: section index -> { x, y, width, height } in output space. First click = anchor; overlap → push, gap → snap. */
  placedSectionRects: null,
  /** Order sections were clicked (first = anchor). */
  placementOrder: [],
  /** When true, place-lock mode: click a section to select it (outline + center handle); drag from center onto another to lock with shared edge. */
  placeLockSectionMode: false,
  /** Section index that is selected (has outline and center drag handle). Null when none selected. */
  placeLockSelectedSection: null,
  /** While dragging from center: { fromSectionIndex, startCenter: [x,y] }. Drop on another section to lock. */
  placeLockDragFromCenter: null,
  /** When dragging from center and cursor over valid target: { targetIndex, snappedRect, edgeTarget, edgeDragged } for preview. */
  placeLockSnapPreview: null,
  /** When dragging a placed rect in output space: { sectionIndex, startEditor: [x,y], startRect }. */
  dragPlacedRect: null,
  /** Set after mouseup from dragPlacedRect so click does not add a section. */
  didDragPlacedRect: false,
  /** section_relations derived from place-lock snaps: by section index, { left_of, right_of, above, below }. */
  placementSectionRelations: null,
  /** Last mouse position in editor space. */
  lastEditorPoint: null,
};

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

/**
 * Closest point on segment a→b to (px, py). Returns { point: [x,y], d2 }.
 * @param {number} px
 * @param {number} py
 * @param {number[]} a - [x,y]
 * @param {number[]} b - [x,y]
 * @returns {{ point: number[], d2: number }}
 */
function closestPointOnSegment(px, py, a, b) {
  const x0 = a[0], y0 = a[1], x1 = b[0], y1 = b[1];
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-18;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  const nx = x0 + t * dx, ny = y0 + t * dy;
  const d2 = (px - nx) ** 2 + (py - ny) ** 2;
  return { point: [nx, ny], d2 };
}

/** All section corners for hover hit-test, top-most section first (so add-corner uses top section's corners). */
function getSectionCorners() {
  if (!state.sections) return [];
  const order = state.sectionLayerOrder || state.sections.map((s) => s.index);
  const list = [];
  for (let o = order.length - 1; o >= 0; o--) {
    const sectionIndex = order[o];
    const section = state.sections.find((s) => s.index === sectionIndex);
    if (!section?.corners || section.corners.length !== 4) continue;
    if (state.visibleSections != null && !state.visibleSections.has(section.index)) continue;
    for (let c = 0; c < section.corners.length; c++) {
      list.push({
        sectionIndex: section.index,
        cornerIndex: c,
        point: [section.corners[c][0], section.corners[c][1]],
        isEdge: false,
      });
    }
  }
  return list;
}

/**
 * Candidates for "add boundary corner": section corners plus closest point on each section edge
 * within maxD2. Top-most section first. Used so corners on overlapping sections (e.g. on an edge
 * inside another section) can still be selected.
 * @param {number} editorX
 * @param {number} editorY
 * @param {number} maxD2 - max squared distance (editor space)
 * @returns {Array<{ sectionIndex: number, cornerIndex?: number, point: number[], isEdge?: boolean }>}
 */
function getAddCornerCandidates(editorX, editorY, maxD2) {
  if (!state.sections) return [];
  const order = state.sectionLayerOrder || state.sections.map((s) => s.index);
  const list = [];

  for (let o = order.length - 1; o >= 0; o--) {
    const sectionIndex = order[o];
    const section = state.sections.find((s) => s.index === sectionIndex);
    if (!section?.corners || section.corners.length !== 4) continue;
    if (state.visibleSections != null && !state.visibleSections.has(section.index)) continue;

    for (let c = 0; c < section.corners.length; c++) {
      const pt = [section.corners[c][0], section.corners[c][1]];
      const d2 = (editorX - pt[0]) ** 2 + (editorY - pt[1]) ** 2;
      if (d2 <= maxD2) {
        list.push({ sectionIndex, cornerIndex: c, point: pt, isEdge: false });
      }
    }

    for (let e = 0; e < 4; e++) {
      const a = section.corners[e];
      const b = section.corners[(e + 1) % 4];
      const { point, d2 } = closestPointOnSegment(editorX, editorY, a, b);
      if (d2 <= maxD2) {
        list.push({ sectionIndex, point, isEdge: true });
      }
    }
  }
  return list;
}

/**
 * Section index whose placed rect (output space) contains (editorX, editorY), or null.
 * Uses placementOrder so last-placed is on top.
 */
function getSectionIndexAtPlacedRect(editorX, editorY) {
  if (!state.placedSectionRects?.size || !state.placementOrder?.length) return null;
  const order = [...state.placementOrder].reverse();
  for (const idx of order) {
    const r = state.placedSectionRects.get(idx);
    if (!r) continue;
    if (editorX >= r.x && editorX <= r.x + r.width && editorY >= r.y && editorY <= r.y + r.height)
      return idx;
  }
  return null;
}

/** Section index under point in editor space, or null. Top-most (most recently clicked) wins. */
function getSectionIndexAtEditorPoint(editorX, editorY) {
  if (!state.sections?.length) return null;
  const order = state.sectionLayerOrder || state.sections.map((s) => s.index);
  for (let o = order.length - 1; o >= 0; o--) {
    const sectionIndex = order[o];
    const section = state.sections.find((s) => s.index === sectionIndex);
    if (!section) continue;
    if (state.visibleSections != null && !state.visibleSections.has(section.index)) continue;
    if (!section.corners || section.corners.length !== 4) continue;
    if (pointInQuad(section.corners, editorX, editorY)) return section.index;
  }
  return null;
}

/** Squared distance for section-edge hover (movable edges after reassess). */
const SECTION_EDGE_HOVER_SQ = 400; // ~20 units

/**
 * Build list of vertical and horizontal edges from section rects (for movable edges).
 * @param {Map<number, { x: number, y: number, width: number, height: number }>} sectionToRect
 * @returns {{ vertical: Array<{ type: 'v', value: number, min: number, max: number, sectionIndices: number[] }>, horizontal: Array<{ type: 'h', value: number, min: number, max: number, sectionIndices: number[] }> }}
 */
function getSectionEdgesFromRects(sectionToRect) {
  const byX = new Map();
  const byY = new Map();
  for (const [idx, rect] of sectionToRect) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    if (!byX.has(left)) byX.set(left, { yMin: rect.y, yMax: rect.y + rect.height, indices: [] });
    const vl = byX.get(left);
    vl.yMin = Math.min(vl.yMin, rect.y);
    vl.yMax = Math.max(vl.yMax, rect.y + rect.height);
    if (!vl.indices.includes(idx)) vl.indices.push(idx);
    if (!byX.has(right)) byX.set(right, { yMin: rect.y, yMax: rect.y + rect.height, indices: [] });
    const vr = byX.get(right);
    vr.yMin = Math.min(vr.yMin, rect.y);
    vr.yMax = Math.max(vr.yMax, rect.y + rect.height);
    if (!vr.indices.includes(idx)) vr.indices.push(idx);
    if (!byY.has(top)) byY.set(top, { xMin: rect.x, xMax: rect.x + rect.width, indices: [] });
    const ht = byY.get(top);
    ht.xMin = Math.min(ht.xMin, rect.x);
    ht.xMax = Math.max(ht.xMax, rect.x + rect.width);
    if (!ht.indices.includes(idx)) ht.indices.push(idx);
    if (!byY.has(bottom)) byY.set(bottom, { xMin: rect.x, xMax: rect.x + rect.width, indices: [] });
    const hb = byY.get(bottom);
    hb.xMin = Math.min(hb.xMin, rect.x);
    hb.xMax = Math.max(hb.xMax, rect.x + rect.width);
    if (!hb.indices.includes(idx)) hb.indices.push(idx);
  }
  const vertical = [];
  for (const [x, v] of byX) vertical.push({ type: 'v', value: x, min: v.yMin, max: v.yMax, sectionIndices: v.indices });
  const horizontal = [];
  for (const [y, v] of byY) horizontal.push({ type: 'h', value: y, min: v.xMin, max: v.xMax, sectionIndices: v.indices });
  return { vertical, horizontal };
}

/**
 * Closest section edge to (editorX, editorY) within maxD2. Returns { edge, d2 } or null.
 */
function getClosestSectionEdge(editorX, editorY, edges, maxD2) {
  let best = null;
  let bestD2 = maxD2;
  for (const e of edges.vertical) {
    const dx = editorX - e.value;
    const py = Math.max(e.min, Math.min(e.max, editorY));
    const dy = editorY - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { edge: e, d2 };
    }
  }
  for (const e of edges.horizontal) {
    const dy = editorY - e.value;
    const px = Math.max(e.min, Math.min(e.max, editorX));
    const dx = editorX - px;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { edge: e, d2 };
    }
  }
  return best;
}

/**
 * Return a new sectionToRect Map with the given edge moved to newValue. Does not clamp (caller clamps).
 */
function moveSectionEdge(sectionToRect, edge, newValue) {
  const next = new Map(sectionToRect);
  if (edge.type === 'v') {
    const x = edge.value;
    for (const idx of edge.sectionIndices) {
      const r = next.get(idx);
      if (!r) continue;
      if (Math.abs(r.x + r.width - x) < 1e-6) {
        next.set(idx, { ...r, width: newValue - r.x });
      } else if (Math.abs(r.x - x) < 1e-6) {
        next.set(idx, { ...r, x: newValue });
      }
    }
  } else {
    const y = edge.value;
    for (const idx of edge.sectionIndices) {
      const r = next.get(idx);
      if (!r) continue;
      if (Math.abs(r.y + r.height - y) < 1e-6) {
        next.set(idx, { ...r, height: newValue - r.y });
      } else if (Math.abs(r.y - y) < 1e-6) {
        next.set(idx, { ...r, y: newValue });
      }
    }
  }
  return next;
}

/**
 * Get partition rects for current boundary (for initial placement).
 * @returns {Map<number, { x: number, y: number, width: number, height: number }>}
 */
function getPartitionRects() {
  const straightenResult = getStraightenResult();
  if (!straightenResult || !state.sections?.length || !state.manifest?.layout) return new Map();
  return partition({
    outputRect: { ...straightenResult.outputRect },
    sections: state.sections,
    reading_order: state.manifest.layout.reading_order,
    section_relations: state.manifest.layout.section_relations,
  });
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Push rect B out of all overlapping rects in placed (minimal translation). Returns new rect. */
function pushRectOutOfOverlaps(B, placed) {
  let b = { x: B.x, y: B.y, width: B.width, height: B.height };
  const list = [...placed.entries()].map(([idx, r]) => r);
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (const p of list) {
      if (!rectsOverlap(b, p)) continue;
      const overlapLeft = b.x + b.width - p.x;
      const overlapRight = p.x + p.width - b.x;
      const overlapTop = b.y + b.height - p.y;
      const overlapBottom = p.y + p.height - b.y;
      const candidates = [
        { dx: overlapLeft, dy: 0 },
        { dx: -overlapRight, dy: 0 },
        { dx: 0, dy: overlapTop },
        { dx: 0, dy: -overlapBottom },
      ];
      let best = null;
      for (const c of candidates) {
        const b2 = { x: b.x + c.dx, y: b.y + c.dy, width: b.width, height: b.height };
        if (!rectsOverlap(b2, p)) {
          const dist = Math.abs(c.dx) + Math.abs(c.dy);
          if (best == null || dist < best.dist) best = { b2, dist };
        }
      }
      if (best) {
        b = best.b2;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return b;
}

/** Gap from B to P: positive = gap, negative = overlap. Direction: 'right' means B is right of P. */
function gapBetween(B, P, direction) {
  if (direction === 'right') return B.x - (P.x + P.width);
  if (direction === 'left') return P.x - (B.x + B.width);
  if (direction === 'down') return B.y - (P.y + P.height);
  if (direction === 'up') return P.y - (B.y + B.height);
  return Infinity;
}

/** Snap rect B to touch the closest placed rect (edge-to-edge). Use when B does not overlap any placed. */
function snapRectToPlaced(B, placed) {
  const list = [...placed.entries()].map(([idx, r]) => r);
  let best = null;
  let bestDist = Infinity;
  for (const p of list) {
    const gR = gapBetween(B, p, 'right');
    const gL = gapBetween(B, p, 'left');
    const gD = gapBetween(B, p, 'down');
    const gU = gapBetween(B, p, 'up');
    if (gR >= 0 && gR < bestDist) {
      bestDist = gR;
      best = { x: p.x + p.width, y: B.y, width: B.width, height: B.height };
    }
    if (gL >= 0 && gL < bestDist) {
      bestDist = gL;
      best = { x: p.x - B.width, y: B.y, width: B.width, height: B.height };
    }
    if (gD >= 0 && gD < bestDist) {
      bestDist = gD;
      best = { x: B.x, y: p.y + p.height, width: B.width, height: B.height };
    }
    if (gU >= 0 && gU < bestDist) {
      bestDist = gU;
      best = { x: B.x, y: p.y - B.height, width: B.width, height: B.height };
    }
  }
  return best != null ? best : B;
}

/** Tolerance (editor units) for treating two segment endpoints as the same point. */
const SHARED_EDGE_TOL = 12;

/** Editor-space radius for place-lock center handle hit-test. */
const PLACE_LOCK_CENTER_HANDLE_RADIUS_EDITOR = 24;

/** Center of the place-lock selected section in editor space (placed rect if locked, else bbox of quad). Returns [x,y] or null. */
function getPlaceLockSelectedCenter() {
  if (state.placeLockSelectedSection == null || !state.sections?.length) return null;
  const section = state.sections.find((s) => s.index === state.placeLockSelectedSection);
  if (!section) return null;
  const rect = state.placedSectionRects?.get(state.placeLockSelectedSection) ?? getSectionBbox(section);
  if (!rect) return null;
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

/** True if (ex, ey) is inside the place-lock center handle of the selected section. */
function isPointInPlaceLockCenterHandle(ex, ey) {
  const center = getPlaceLockSelectedCenter();
  if (!center) return false;
  const d2 = (ex - center[0]) ** 2 + (ey - center[1]) ** 2;
  return d2 <= PLACE_LOCK_CENTER_HANDLE_RADIUS_EDITOR ** 2;
}

/**
 * Get shared edge segments between locked sections (for drawing connections). Each segment is { start: [x,y], end: [x,y] } in editor space.
 * @param {Map<number, { x, y, width, height }>} placedSectionRects
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} placementSectionRelations
 * @returns {{ start: number[], end: number[] }[]}
 */
function getSharedEdgeSegments(placedSectionRects, placementSectionRelations) {
  if (!placedSectionRects?.size || !placementSectionRelations?.length) return [];
  const segments = [];
  const seen = new Set();
  for (const [i, rectI] of placedSectionRects) {
    const rel = placementSectionRelations[i];
    if (!rel) continue;
    const addSegment = (x1, y1, x2, y2) => {
      const key = [x1, y1, x2, y2].map(Math.round).join(',');
      if (seen.has(key)) return;
      seen.add(key);
      segments.push({ start: [x1, y1], end: [x2, y2] });
    };
    for (const j of rel.above || []) {
      const rectJ = placedSectionRects.get(j);
      if (!rectJ) continue;
      const xMin = Math.max(rectI.x, rectJ.x);
      const xMax = Math.min(rectI.x + rectI.width, rectJ.x + rectJ.width);
      if (xMax > xMin) addSegment(xMin, rectI.y, xMax, rectI.y);
    }
    for (const j of rel.below || []) {
      const rectJ = placedSectionRects.get(j);
      if (!rectJ) continue;
      const xMin = Math.max(rectI.x, rectJ.x);
      const xMax = Math.min(rectI.x + rectI.width, rectJ.x + rectJ.width);
      if (xMax > xMin) addSegment(xMin, rectI.y + rectI.height, xMax, rectI.y + rectI.height);
    }
    for (const j of rel.right_of || []) {
      const rectJ = placedSectionRects.get(j);
      if (!rectJ) continue;
      const yMin = Math.max(rectI.y, rectJ.y);
      const yMax = Math.min(rectI.y + rectI.height, rectJ.y + rectJ.height);
      if (yMax > yMin) addSegment(rectI.x + rectI.width, yMin, rectI.x + rectI.width, yMax);
    }
    for (const j of rel.left_of || []) {
      const rectJ = placedSectionRects.get(j);
      if (!rectJ) continue;
      const yMin = Math.max(rectI.y, rectJ.y);
      const yMax = Math.min(rectI.y + rectI.height, rectJ.y + rectJ.height);
      if (yMax > yMin) addSegment(rectI.x, yMin, rectI.x, yMax);
    }
  }
  return segments;
}

/**
 * Check if two line segments (a0→a1, b0→b1) lie on the same line and overlap (within tolerance).
 * @param {number[]} a0 [x,y]
 * @param {number[]} a1 [x,y]
 * @param {number[]} b0 [x,y]
 * @param {number[]} b1 [x,y]
 * @param {number} tol
 * @returns {boolean}
 */
function segmentsCoincidentAndOverlap(a0, a1, b0, b1, tol) {
  const ax = a1[0] - a0[0], ay = a1[1] - a0[1];
  const crossB0 = ax * (b0[1] - a0[1]) - ay * (b0[0] - a0[0]);
  const crossB1 = ax * (b1[1] - a0[1]) - ay * (b1[0] - a0[0]);
  if (Math.abs(crossB0) > tol || Math.abs(crossB1) > tol) return false;
  const len2 = ax * ax + ay * ay || 1e-18;
  const tA0 = 0, tA1 = 1;
  const tB0 = ((b0[0] - a0[0]) * ax + (b0[1] - a0[1]) * ay) / len2;
  const tB1 = ((b1[0] - a0[0]) * ax + (b1[1] - a0[1]) * ay) / len2;
  const tBMin = Math.min(tB0, tB1), tBMax = Math.max(tB0, tB1);
  return tBMax >= tA0 - 1e-6 && tBMin <= tA1 + 1e-6;
}

/**
 * Get shared edge between two section quads (corners). Returns { edgeIndexA, edgeIndexB } or null.
 * Quad edge i = corners[i] → corners[(i+1)%4]. Rect mapping: 0=top, 1=right, 2=bottom, 3=left.
 */
function getSharedEdgeBetweenSections(sectionA, sectionB, tol = SHARED_EDGE_TOL) {
  if (sectionA?.corners?.length !== 4 || sectionB?.corners?.length !== 4) return null;
  const a = sectionA.corners;
  const b = sectionB.corners;
  for (let i = 0; i < 4; i++) {
    const a0 = a[i], a1 = a[(i + 1) % 4];
    for (let j = 0; j < 4; j++) {
      const b0 = b[j], b1 = b[(j + 1) % 4];
      if (segmentsCoincidentAndOverlap(a0, a1, b0, b1, tol))
        return { edgeIndexA: i, edgeIndexB: j };
    }
  }
  return null;
}

/**
 * Get all shared edges between section and any of the placed sections. Returns array of { otherIndex, edgeIndexA, edgeIndexB }.
 */
function getSharedEdgesWithPlaced(section, placedIndices, sections, tol = SHARED_EDGE_TOL) {
  const out = [];
  for (const otherIndex of placedIndices) {
    const other = sections.find((s) => s.index === otherIndex);
    if (!other) continue;
    const shared = getSharedEdgeBetweenSections(other, section, tol);
    if (shared) out.push({ otherIndex, edgeIndexA: shared.edgeIndexA, edgeIndexB: shared.edgeIndexB });
  }
  return out;
}

/**
 * Snap rect B so that its side edgeIndexB aligns with rect A's side edgeIndexA (no gap, no overlap).
 * Rect sides: 0=top, 1=right, 2=bottom, 3=left. Returns new rect for B (same width/height).
 */
function snapRectToSharedEdge(rectA, edgeIndexA, rectB, edgeIndexB) {
  const B = { x: rectB.x, y: rectB.y, width: rectB.width, height: rectB.height };
  const A = rectA;
  if (edgeIndexA === 0 && edgeIndexB === 2) {
    B.y = A.y - B.height;
    B.x = A.x + Math.max(0, (A.width - B.width) / 2);
  } else if (edgeIndexA === 2 && edgeIndexB === 0) {
    B.y = A.y + A.height;
    B.x = A.x + Math.max(0, (A.width - B.width) / 2);
  } else if (edgeIndexA === 1 && edgeIndexB === 3) {
    B.x = A.x + A.width;
    B.y = A.y + Math.max(0, (A.height - B.height) / 2);
  } else if (edgeIndexA === 3 && edgeIndexB === 1) {
    B.x = A.x - B.width;
    B.y = A.y + Math.max(0, (A.height - B.height) / 2);
  } else {
    return rectB;
  }
  return B;
}

/**
 * When multiple shared edges (e.g. B touches two placed sections), snap to the first then resolve overlap with others.
 * Returns final rect for B.
 */
function snapRectToPlacedByEdges(initialRect, sectionIndex, sharedEdges, placedSectionRects) {
  if (sharedEdges.length === 0) return initialRect;
  let rect = { ...initialRect };
  for (const { otherIndex, edgeIndexA, edgeIndexB } of sharedEdges) {
    const rectA = placedSectionRects.get(otherIndex);
    if (!rectA) continue;
    rect = snapRectToSharedEdge(rectA, edgeIndexA, rect, edgeIndexB);
    const overlap = [...placedSectionRects.entries()].filter(([idx]) => idx !== sectionIndex).some(([, r]) => rectsOverlap(rect, r));
    if (!overlap) break;
  }
  return rect;
}

/** Bounding box of section corners in editor space. */
function getSectionBbox(section) {
  if (!section?.corners?.length) return null;
  const xs = section.corners.map((c) => c[0]);
  const ys = section.corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

/** Bounding box of all placed rects (composite bounds in editor space). */
function getCompositeBounds(placedSectionRects) {
  if (!placedSectionRects?.size) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of placedSectionRects.values()) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Choose best edge to snap the moving section (draggedRect) to the anchor (fromRect).
 * Preserves perpendicular position: vertical shared edge -> no vertical movement (only x adjusted).
 * Horizontal shared edge -> no horizontal movement (only y adjusted). Picks the option with smallest adjustment.
 * Returns { snappedRect, edgeTarget, edgeDragged }. Edge: 0=top, 1=right, 2=bottom, 3=left.
 */
function chooseBestSnapEdgeForDrop(draggedRect, fromRect) {
  const w = draggedRect.width;
  const h = draggedRect.height;
  const candidates = [
    { edgeTarget: 0, edgeDragged: 2, snappedRect: { x: draggedRect.x, y: fromRect.y - h, width: w, height: h } },
    { edgeTarget: 2, edgeDragged: 0, snappedRect: { x: draggedRect.x, y: fromRect.y + fromRect.height, width: w, height: h } },
    { edgeTarget: 3, edgeDragged: 1, snappedRect: { x: fromRect.x - w, y: draggedRect.y, width: w, height: h } },
    { edgeTarget: 1, edgeDragged: 3, snappedRect: { x: fromRect.x + fromRect.width, y: draggedRect.y, width: w, height: h } },
  ];
  let best = null;
  let bestMove = Infinity;
  for (const c of candidates) {
    const move = Math.abs(c.snappedRect.x - draggedRect.x) + Math.abs(c.snappedRect.y - draggedRect.y);
    if (move < bestMove) {
      bestMove = move;
      best = c;
    }
  }
  return best;
}

/** Ensure placementSectionRelations has an entry for every section index. */
function ensurePlacementSectionRelations() {
  if (!state.sections?.length) return;
  const n = Math.max(...state.sections.map((s) => s.index)) + 1;
  if (!state.placementSectionRelations || state.placementSectionRelations.length < n) {
    const arr = state.placementSectionRelations ? [...state.placementSectionRelations] : [];
    while (arr.length < n) arr.push({ left_of: [], right_of: [], above: [], below: [] });
    state.placementSectionRelations = arr;
  }
}

/** Record that dragged is adjacent to target: edgeTarget/edgeDragged (0=top,1=right,2=bottom,3=left). */
function addPlacementRelation(draggedIndex, targetIndex, edgeTarget, edgeDragged) {
  ensurePlacementSectionRelations();
  const rel = state.placementSectionRelations;
  const push = (idx, key, val) => {
    if (!rel[idx][key].includes(val)) rel[idx][key].push(val);
  };
  if (edgeTarget === 0 && edgeDragged === 2) {
    push(targetIndex, 'above', draggedIndex);
    push(draggedIndex, 'below', targetIndex);
  } else if (edgeTarget === 2 && edgeDragged === 0) {
    push(targetIndex, 'below', draggedIndex);
    push(draggedIndex, 'above', targetIndex);
  } else if (edgeTarget === 3 && edgeDragged === 1) {
    push(targetIndex, 'left_of', draggedIndex);
    push(draggedIndex, 'right_of', targetIndex);
  } else if (edgeTarget === 1 && edgeDragged === 3) {
    push(targetIndex, 'right_of', draggedIndex);
    push(draggedIndex, 'left_of', targetIndex);
  }
}

/**
 * Add section to placement.
 * Place-lock mode: first click = anchor; next clicks only accept sections that share an edge with placed, then snap by edge.
 * Normal mode: first click = anchor; later clicks = push out of overlap or snap to placed.
 */
function addSectionToPlacement(sectionIndex) {
  const straightenResult = getStraightenResult();
  if (!straightenResult || !state.sections?.length || !state.manifest?.layout) return;
  const grid = getPartitionRects();
  const initial = grid.get(sectionIndex);
  if (!initial) return;

  if (!state.placedSectionRects) {
    state.placedSectionRects = new Map();
    state.placementOrder = [];
  }
  if (state.placedSectionRects.has(sectionIndex)) {
    setStatus(`Section S${sectionIndex} already placed. Click another section or Reset placement.`);
    render();
    return;
  }

  const placed = state.placedSectionRects;
  const section = state.sections.find((s) => s.index === sectionIndex);
  let rect = { x: initial.x, y: initial.y, width: initial.width, height: initial.height };

  if (state.placeLockSectionMode && placed.size > 0) {
    const placedIndices = [...placed.keys()];
    const sharedEdges = getSharedEdgesWithPlaced(section, placedIndices, state.sections);
    if (sharedEdges.length === 0) {
      const anchor = state.placementOrder[0];
      setStatus(`Select a section that shares an edge with placed sections (e.g. S${anchor}). Click a neighbouring section.`);
      render();
      return;
    }
    rect = snapRectToPlacedByEdges(rect, sectionIndex, sharedEdges, placed);
    if ([...placed.values()].some((r) => rectsOverlap(rect, r))) {
      rect = pushRectOutOfOverlaps(rect, placed);
    }
  } else if (placed.size > 0 && !state.placeLockSectionMode) {
    rect = pushRectOutOfOverlaps(rect, placed);
    if (![...placed.values()].some((p) => rectsOverlap(rect, p))) {
      rect = snapRectToPlaced(rect, placed);
    }
  }

  state.placedSectionRects.set(sectionIndex, rect);
  state.placementOrder.push(sectionIndex);
  state.sectionEdgesVisible = true;

  const n = state.sections.length;
  const statusMsg = state.placeLockSectionMode
    ? placed.size === 0
      ? `S${sectionIndex} locked. Drag its rect to move, or click a section that shares an edge to snap next.`
      : `S${sectionIndex} locked (${state.placementOrder.length}/${n}). Drag rects to align; click next section that shares an edge, or Preview.`
    : placed.size === 0
      ? `S${sectionIndex} set as anchor. Click next section (${state.placementOrder.length}/${n} placed). Overlap → push apart; gap → snap.`
      : `S${sectionIndex} placed (${state.placementOrder.length}/${n}). Edges saved in manifest. Click next or Preview.`;
  setStatus(statusMsg);
  updateCornerListUI();
  updateLockedSectionsPanel();
  render();
}

/** Section rects for draw and export: placed first, then partition for any missing. */
function getSectionRectsForExport() {
  const grid = getPartitionRects();
  if (!state.placedSectionRects?.size) return grid;
  const out = new Map(grid);
  for (const [idx, rect] of state.placedSectionRects) out.set(idx, { ...rect });
  return out;
}

function undoLastLock() {
  if (!state.placementOrder?.length) {
    setStatus('Nothing to undo.');
    return;
  }
  const removedIndex = state.placementOrder.pop();
  state.placedSectionRects.delete(removedIndex);
  ensurePlacementSectionRelations();
  const rel = state.placementSectionRelations;
  if (rel[removedIndex]) {
    const removeFromOther = (key, otherKey) => {
      for (const other of rel[removedIndex][key] || []) {
        const arr = rel[other]?.[otherKey];
        if (arr) {
          const i = arr.indexOf(removedIndex);
          if (i !== -1) arr.splice(i, 1);
        }
      }
      rel[removedIndex][key] = [];
    };
    removeFromOther('above', 'below');
    removeFromOther('below', 'above');
    removeFromOther('left_of', 'right_of');
    removeFromOther('right_of', 'left_of');
  }
  if (state.placeLockSelectedSection === removedIndex) {
    state.placeLockSelectedSection = state.placementOrder.length ? state.placementOrder[state.placementOrder.length - 1] : null;
  }
  if (!state.placementOrder.length) {
    state.placedSectionRects = null;
    state.placementSectionRelations = null;
    state.placeLockSelectedSection = null;
  }
  setStatus('Undid last lock. ' + (state.placementOrder?.length ? state.placementOrder.length + ' section(s) in cluster.' : 'Click a section to select, then drag from center to lock.'));
  updateLockedSectionsPanel();
  updateCornerListUI();
  render();
}

function resetPlacement() {
  state.placedSectionRects = null;
  state.placementOrder = [];
  state.placementSectionRelations = null;
  state.sectionEdgesVisible = false;
  state.dragPlacedRect = null;
  state.didDragPlacedRect = false;
  state.placeLockSnapPreview = null;
  state.placeLockSelectedSection = null;
  state.placeLockDragFromCenter = null;
  setStatus('Placement reset. Click a section to select, then drag from center onto another to lock.');
  updateCornerListUI();
  updateLockedSectionsPanel();
  render();
}

/** Bring section to front of layer stack (so it is drawn and hit-tested on top). */
function bringSectionToFront(sectionIndex) {
  if (!state.sectionLayerOrder) return;
  const order = state.sectionLayerOrder.filter((i) => i !== sectionIndex);
  order.push(sectionIndex);
  state.sectionLayerOrder = order;
  updateLayerStackUI();
}

/** Show/hide and position the rotate-section button over the hovered section. */
function updateRotateButton() {
  if (!btnRotateSection || !canvasOverlay) return;
  if (state.hoveredSectionIndex == null || !state.view || !state.sections?.length) {
    btnRotateSection.classList.remove('visible');
    return;
  }
  const section = state.sections.find((s) => s.index === state.hoveredSectionIndex);
  if (!section?.corners?.length) {
    btnRotateSection.classList.remove('visible');
    return;
  }
  const xs = section.corners.map((c) => c[0]);
  const ys = section.corners.map((c) => c[1]);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const [canvasX, canvasY] = editorToCanvas(right, top, state.view);
  btnRotateSection.style.left = `${Math.max(4, canvasX - 72)}px`;
  btnRotateSection.style.top = `${Math.max(4, canvasY + 4)}px`;
  btnRotateSection.classList.add('visible');
}

function updateBoundaryEditButtons() {
  if (btnAddCorner) btnAddCorner.classList.toggle('active', state.boundaryEditMode === 'add');
  if (btnRemoveCorner) btnRemoveCorner.classList.toggle('active', state.boundaryEditMode === 'remove');
  if (btnMoveSection) btnMoveSection.classList.toggle('active', state.moveSectionMode === true);
  if (btnPlaceLockSection) btnPlaceLockSection.classList.toggle('active', state.placeLockSectionMode === true);
  updateCornerListUI();
}

function updateLayerStackUI() {
  if (!layerStackEl) return;
  if (!state.sectionLayerOrder?.length) {
    layerStackEl.innerHTML = '';
    layerStackEl.classList.add('hidden');
    return;
  }
  layerStackEl.classList.remove('hidden');
  layerStackEl.innerHTML = `<span class="layer-stack-label">Layer (top first):</span> ${state.sectionLayerOrder.map((i) => `S${i}`).reverse().join(' → ')}`;
}

function updateLockedSectionsPanel() {
  if (!lockedSectionsPanel || !lockedSectionsListEl) return;
  if (!state.placeLockSectionMode) {
    lockedSectionsPanel.classList.remove('visible');
    lockedSectionsPanel.classList.add('hidden');
    lockedSectionsListEl.innerHTML = '';
    return;
  }
  lockedSectionsPanel.classList.remove('hidden');
  lockedSectionsPanel.classList.add('visible');
  if (!state.placedSectionRects?.size || !state.placementOrder?.length) {
    lockedSectionsListEl.innerHTML = '<p class="locked-section-item">Click a section to select it. Drag from the center handle onto another section to lock (shared edge, no gap). Green lines = connections.</p>';
    return;
  }
  lockedSectionsListEl.innerHTML = state.placementOrder
    .map((idx, i) => {
      const r = state.placedSectionRects.get(idx);
      if (!r) return '';
      const x = Math.round(r.x);
      const y = Math.round(r.y);
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      return `<div class="locked-section-item"><span class="locked-section-label">${i + 1}. S${idx}</span><div class="locked-section-coords">x: ${x}, y: ${y}<br>w: ${w}, h: ${h}</div></div>`;
    })
    .join('');
}

function updateCornerListUI() {
  if (!cornerListEl) return;
  if (state.boundaryEditMode !== 'remove' || !state.outerBoundary?.polygon?.length) {
    cornerListEl.innerHTML = '';
    cornerListEl.classList.add('hidden');
    return;
  }
  const polygon = getPolygon(state.outerBoundary);
  cornerListEl.classList.remove('hidden');
  cornerListEl.innerHTML = '<span class="corner-list-title">Boundary corners (click Remove to delete):</span><ul class="corner-list"></ul>';
  const ul = cornerListEl.querySelector('.corner-list');
  for (let i = 0; i < polygon.length; i++) {
    const li = document.createElement('li');
    li.className = 'corner-list-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-remove-corner';
    btn.textContent = `Corner ${i} Remove`;
    btn.dataset.vertexIndex = String(i);
    btn.addEventListener('click', () => removeBoundaryVertexByIndex(i));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function removeBoundaryVertexByIndex(vertexIndex) {
  if (!state.outerBoundary?.polygon?.length) return;
  const next = removeVertex(state.outerBoundary, vertexIndex);
  if (next) {
    state.outerBoundary = next;
    state.sectionEdgesVisible = false;
    state.placedSectionRects = null;
    state.placementOrder = [];
    state.placementSectionRelations = null;
    state.hoveredBoundaryVertex = null;
    updateValidationWarnings();
    updateCornerListUI();
    setStatus(`Removed boundary corner (${state.outerBoundary.polygon.length} vertices).`);
    render();
  }
}

async function saveExportCanvas(canvas, filename) {
  downloadCanvas(canvas, filename);
  setStatus('Downloaded ' + filename);
  return false;
}

function fitCanvasToContainer() {
  if (!editorWrap.classList.contains('hidden') && editorWrap) {
    const w = Math.max(1, editorWrap.clientWidth);
    const h = Math.max(1, editorWrap.clientHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      render();
    }
  }
}

function render() {
  const ctx = canvas.getContext('2d');
  if (!ctx || !state.sections || !state.editorBounds) return;

  const view = state.view || viewTransform(state.editorBounds, canvas.width, canvas.height);
  state.view = view;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawSections(ctx, {
    sections: state.sections,
    editorBounds: state.editorBounds,
    visibleSections: state.visibleSections,
    sectionLayerOrder: state.sectionLayerOrder,
  }, view);

  if (state.outerBoundary?.polygon?.length) {
    drawOuterBoundary(ctx, getPolygon(state.outerBoundary), view);
    const polygon = getPolygon(state.outerBoundary);
    if (state.boundaryEditMode === 'add' && state.hoveredSectionCorner != null && state.hoveredBoundaryEdge != null) {
      drawOuterBoundaryEdgeHighlight(ctx, polygon, view, state.hoveredBoundaryEdge);
      drawSectionCornerHighlight(ctx, state.hoveredSectionCorner.point[0], state.hoveredSectionCorner.point[1], view);
      const a = polygon[state.hoveredBoundaryEdge];
      const b = polygon[(state.hoveredBoundaryEdge + 1) % polygon.length];
      const snapped = snapNewCornerToRightAngle(a, b, state.hoveredSectionCorner.point[0], state.hoveredSectionCorner.point[1]);
      drawSnappedCornerPreview(ctx, snapped[0], snapped[1], view);
    }
    if (state.boundaryEditMode === 'remove') {
      drawAllBoundaryVerticesWithLabels(ctx, polygon, view);
      if (state.hoveredBoundaryVertex != null) {
        drawOuterBoundaryVertexHighlight(ctx, polygon, view, state.hoveredBoundaryVertex);
      }
    }
  }

  const straightenResult = getStraightenResult();
  if (state.placeLockSectionMode) {
    if (state.placedSectionRects?.size && straightenResult) {
      const outputRect = straightenResult.outputRect;
      const sharedSegments = getSharedEdgeSegments(state.placedSectionRects, state.placementSectionRelations);
      drawPlaceLockSharedEdges(ctx, sharedSegments, view);
      drawPlaceLockOutlines(ctx, state.placedSectionRects, outputRect, view, {
        previewRect: state.placeLockSnapPreview?.snappedRect ?? null,
        previewSectionIndex: state.placeLockSnapPreview?.targetIndex ?? null,
        highlightTargetIndex: state.placeLockSnapPreview?.targetIndex ?? null,
      });
    } else if (state.placeLockSnapPreview && state.placeLockDragFromCenter && straightenResult) {
      const preview = state.placeLockSnapPreview;
      const fromIndex = state.placeLockDragFromCenter.fromSectionIndex;
      const previewRects = new Map(state.placedSectionRects ?? []);
      const fromSection = state.sections.find((s) => s.index === fromIndex);
      const fromRect = state.placedSectionRects?.get(fromIndex) ?? getSectionBbox(fromSection);
      if (fromRect && !previewRects.has(fromIndex)) previewRects.set(fromIndex, fromRect);
      const withPreview = new Map(previewRects);
      if (preview.snappedRect) withPreview.set(preview.targetIndex, preview.snappedRect);
      const outputRect = getCompositeBounds(withPreview);
      if (outputRect) {
        drawPlaceLockOutlines(ctx, previewRects, outputRect, view, {
          previewRect: preview.snappedRect,
          previewSectionIndex: preview.targetIndex,
          highlightTargetIndex: preview.targetIndex,
        });
      }
    }
    if (state.placeLockSelectedSection != null && !state.placeLockDragFromCenter) {
      const sel = state.placeLockSelectedSection;
      const section = state.sections.find((s) => s.index === sel);
      const rect = state.placedSectionRects?.get(sel) ?? getSectionBbox(section);
      if (rect) {
        const [x0, y0] = editorToCanvas(rect.x, rect.y, view);
        const [x1, y1] = editorToCanvas(rect.x + rect.width, rect.y + rect.height, view);
        ctx.strokeStyle = 'rgba(255, 200, 80, 0.95)';
        ctx.lineWidth = 4;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (section?.corners?.length === 4 && !state.placedSectionRects?.has(sel)) {
        drawSectionQuadEdgesHighlight(ctx, section.corners, view);
      }
      const center = getPlaceLockSelectedCenter();
      if (center) drawPlaceLockCenterHandle(ctx, center[0], center[1], view);
    }
    if (state.placeLockDragFromCenter) {
      const center = getPlaceLockSelectedCenter();
      const [ex, ey] = state.lastEditorPoint ?? [0, 0];
      if (center) drawPlaceLockConnectionLine(ctx, center[0], center[1], ex, ey, view);
      if (state.placeLockSelectedSection != null) {
        const center2 = getPlaceLockSelectedCenter();
        if (center2) drawPlaceLockCenterHandle(ctx, center2[0], center2[1], view);
      }
    }
  } else if (state.sectionEdgesVisible && straightenResult) {
    const sectionToRect = getSectionRectsForExport();
    drawGrid(ctx, straightenResult.grid, view);
    drawOutputRect(ctx, straightenResult.outputRect, view);
    drawSectionEdges(ctx, sectionToRect, straightenResult.outputRect, view);
  }

  if (state.placeLockSectionMode && state.hoveredSectionIndex != null && !state.placeLockDragFromCenter) {
    const section = state.sections.find((s) => s.index === state.hoveredSectionIndex);
    if (section?.corners?.length === 4) {
      drawSectionQuadEdgesHighlight(ctx, section.corners, view);
    }
  }

  if (state.placeLockSectionMode) {
    updateLockedSectionsPanel();
  }

  updateRotateButton();
}

async function loadFromFolder(folderOrGetFile, folderLabel = '') {
  let manifest;
  let getFile;

  if (typeof folderOrGetFile === 'function') {
    getFile = folderOrGetFile;
    const manifestFile = await getFile('manifest.json');
    if (!manifestFile) {
      setStatus('No manifest.json in folder.');
      return;
    }
    manifest = await loadManifest(manifestFile);
  } else {
    const folder = folderOrGetFile;
    getFile = async (name) => {
      try {
        return await folder.getFile(name);
      } catch {
        return null;
      }
    };
    const manifestFile = await getFile('manifest.json');
    if (!manifestFile) {
      setStatus('No manifest.json in folder.');
      return;
    }
    manifest = await loadManifest(manifestFile);
  }

  setStatus('Loading section images…');
  const sections = await loadSectionImages(manifest, getFile);
  stretchSectionsToRectangles(sections);

  let referenceImage = null;
  for (const name of ['composite-recreated.png', 'composite.png']) {
    const f = await getFile(name);
    if (f) {
      const url = URL.createObjectURL(f);
      try {
        referenceImage = await new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = url;
        });
        break;
      } catch {
        URL.revokeObjectURL(url);
      }
    }
  }

  if (referenceImage) {
    setStatus('Checking section orientation against composite…');
    detectSectionOrientationsFromComposite(sections, referenceImage, manifest);
  }

  const editorBounds = getEditorBounds(sections);
  const outerBoundary = createOuterBoundary(sections, getOuterBoundaryPolygon);
  const visibleSections = new Set(sections.map((s) => s.index));
  const sectionLayerOrder = sections.map((s) => s.index);

  state = {
    ...state,
    manifest,
    sections,
    editorBounds,
    outerBoundary,
    view: null,
    folderName: folderLabel,
    getFile,
    referenceImage,
    visibleSections,
    sectionLayerOrder,
    lastExportCanvas: null,
    hoveredSectionCorner: null,
    hoveredBoundaryEdge: null,
    hoveredBoundaryVertex: null,
    hoveredSectionIndex: null,
    moveSectionMode: false,
    dragSection: null,
    didDragSection: false,
    sectionEdgesVisible: false,
    placedSectionRects: null,
    placementOrder: [],
    placementSectionRelations: null,
    placeLockSelectedSection: null,
    placeLockDragFromCenter: null,
    placeLockSnapPreview: null,
    dragPlacedRect: null,
    didDragPlacedRect: false,
  };

  updateSectionToggles();
  updateLayerStackUI();
  updateCornerListUI();
  updateValidationWarnings();
  updateBoundaryEditButtons();
  dropZone.classList.add('hidden');
  editorWrap.classList.remove('hidden');
  folderNameEl.textContent = state.folderName || 'Loaded';
  setActiveFolderInPanel(state.folderName);
  setStatus(`Loaded ${sections.length} section(s). Follow steps 1–2 (boundary), then step 3 (place sections) and Preview. Saves go to output_defaults/.`);
  fitCanvasToContainer();
  render();
}

function setActiveFolderInPanel(folderName) {
  if (!folderListEl) return;
  folderListEl.querySelectorAll('.folder-list-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.folder === folderName);
  });
}

function updateSectionToggles() {
  const el = document.getElementById('section-toggles');
  if (!el || !state.sections?.length) return;
  el.innerHTML = state.sections
    .map(
      (s) =>
        `<label class="section-toggle"><input type="checkbox" data-section="${s.index}" checked> S${s.index}</label>`
    )
    .join('');
  el.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (!state.visibleSections) return;
      if (cb.checked) state.visibleSections.add(Number(cb.dataset.section));
      else state.visibleSections.delete(Number(cb.dataset.section));
      render();
    });
  });
}

function getStraightenResult() {
  if (!state.sections?.length) return null;
  if (state.placedSectionRects?.size) {
    const outputRect = getCompositeBounds(state.placedSectionRects);
    if (!outputRect) return null;
    return {
      outputRect: { ...outputRect },
      grid: { xLines: [], yLines: [] },
    };
  }
  if (!state.outerBoundary?.polygon?.length || !state.manifest?.layout) return null;
  const polygon = getPolygon(state.outerBoundary);
  if (polygon.length < 3) return null;
  return straighten({
    outerPolygon: polygon,
    sections: state.sections,
    section_relations: state.manifest.layout.section_relations,
  });
}

function updateValidationWarnings() {
  if (!validationWarningsEl) return;
  const straightenResult = getStraightenResult();
  if (!straightenResult || !state.sections?.length) {
    validationWarningsEl.textContent = '';
    return;
  }
  const layout = getExportLayout();
  const v = validate({
    sections: state.sections,
    straightenResult,
    reading_order: layout.reading_order,
    section_relations: layout.section_relations,
  });
  const parts = [];
  if (v.orphanSections.length) parts.push(`Orphan sections: ${v.orphanSections.join(', ')}`);
  if (v.distortionWarnings.length) parts.push(...v.distortionWarnings);
  if (v.unusedCells) parts.push('Some grid cells unassigned.');
  validationWarningsEl.textContent = parts.length ? parts.join(' · ') : '';
}

function toggleLeftPanel() {
  if (leftPanel) leftPanel.classList.toggle('collapsed');
}

const DEFAULT_EXPORT_OPTIONS = { marginPx: 20, scale: 1, marginColor: '#ffffff', seamBlend: true };

function getExportOptions() {
  return DEFAULT_EXPORT_OPTIONS;
}

function getExportLayout() {
  if (state.placedSectionRects?.size) {
    ensurePlacementSectionRelations();
    return {
      reading_order: state.placementOrder,
      section_relations: state.placementSectionRelations,
    };
  }
  return {
    reading_order: state.manifest?.layout?.reading_order,
    section_relations: state.manifest?.layout?.section_relations,
  };
}

function buildExportCanvasWithOptions() {
  const straightenResult = getStraightenResult();
  if (!state.sections?.length || !straightenResult) return null;
  const opts = getExportOptions();
  const layout = getExportLayout();
  return buildExportCanvas({
    sections: state.sections,
    straightenResult,
    marginPx: opts.marginPx,
    reading_order: layout.reading_order,
    section_relations: layout.section_relations,
    scale: opts.scale,
    marginColor: opts.marginColor,
    seamBlend: opts.seamBlend,
    seamBlendWidth: 4,
    sectionToRect: getSectionRectsForExport(),
  });
}

function drawPreviewToFill() {
  const c = state.lastExportCanvas;
  if (!c || !previewCanvas || previewModal.classList.contains('hidden')) return;
  const wrap = previewCanvas.closest('.preview-canvas-wrap');
  const maxW = wrap && wrap.clientWidth > 0 ? wrap.clientWidth : window.innerWidth - 48;
  const maxH = wrap && wrap.clientHeight > 0 ? wrap.clientHeight : window.innerHeight - 180;
  const scale = Math.min(maxW / c.width, maxH / c.height);
  const w = Math.round(c.width * scale);
  const h = Math.round(c.height * scale);
  previewCanvas.width = w;
  previewCanvas.height = h;
  const ctx = previewCanvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, w, h);
}

/** Draw section boundaries and labels on the export canvas so Preview shows how the image is cut into sections. */
function drawSectionBoundariesOnExportCanvas(canvas) {
  const straightenResult = getStraightenResult();
  const sectionToRect = getSectionRectsForExport();
  if (!straightenResult || !sectionToRect?.size) return;
  const opts = getExportOptions();
  const outputRect = straightenResult.outputRect;
  const m = opts.marginPx ?? 0;
  const scale = opts.scale ?? 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const lineW = Math.max(2, Math.round(3 * scale));
  ctx.lineWidth = lineW;
  ctx.font = 'bold ' + Math.max(12, Math.round(14 * scale)) + 'px sans-serif';
  for (const [idx, rect] of sectionToRect) {
    const x = (rect.x - outputRect.x) * scale + m * scale;
    const y = (rect.y - outputRect.y) * scale + m * scale;
    const w = rect.width * scale;
    const h = rect.height * scale;
    ctx.strokeStyle = 'rgba(0, 255, 180, 0.95)';
    ctx.strokeRect(x, y, w, h);
    if (w >= 30 && h >= 20) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeText('S' + idx, x + 6, y + 16);
      ctx.fillText('S' + idx, x + 6, y + 16);
      ctx.lineWidth = lineW;
    }
  }
}

function openPreview() {
  const c = buildExportCanvasWithOptions();
  if (!c) {
    setStatus('Load a folder, set boundary (steps 1–2), then place sections and Preview.');
    return;
  }
  drawSectionBoundariesOnExportCanvas(c);
  state.lastExportCanvas = c;
  previewModal.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(drawPreviewToFill));
}

function closePreview() {
  previewModal.classList.add('hidden');
}

async function previewDownload() {
  if (state.lastExportCanvas) {
    const name = state.folderName ? `corrected-${state.folderName}.png` : 'corrected.png';
    await saveExportCanvas(state.lastExportCanvas, name);
  }
  closePreview();
}

async function previewSaveFolder() {
  const straightenResult = getStraightenResult();
  if (!state.sections?.length || !straightenResult || !state.manifest) {
    setStatus('Load a folder, set boundary (steps 1–2), then place sections and Save folder.');
    return;
  }
  const opts = getExportOptions();
  const layout = getExportLayout();
  const exportOptions = {
    sections: state.sections,
    straightenResult,
    marginPx: opts.marginPx,
    reading_order: layout.reading_order,
    section_relations: layout.section_relations,
    scale: opts.scale,
    marginColor: opts.marginColor,
    seamBlend: opts.seamBlend,
    seamBlendWidth: 4,
    sourceManifest: state.manifest,
    sectionToRect: getSectionRectsForExport(),
  };

  const folderName = state.folderName || 'corrected';

  try {
    setStatus('Saving to output_defaults/…');
    const { manifest, sectionBlobs, compositeBlob } = await getExportBlobsAndManifest(folderName, exportOptions);

    const form = new FormData();
    form.append('folderName', folderName);
    form.append('manifest', JSON.stringify(manifest, null, 2));
    for (const { index, blob } of sectionBlobs) {
      form.append(`section-${index}`, blob, `section-${index}.png`);
    }
    form.append('composite', compositeBlob, 'composite.png');

    const res = await fetch('/api/save-export', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText || 'Save failed');
    }

    const data = await res.json();
    const subfolderName = data.path || `corrected-${folderName}`;
    setStatus(`Saved to output_defaults/${subfolderName}/: ${(data.saved || []).join(', ')}`);
  } catch (e) {
    setStatus('Save failed: ' + (e.message || 'Unknown error') + '. Run the app with npm start so exports go to output_defaults/.');
    return;
  }
  closePreview();
}

async function runWarpSave() {
  const straightenResult = getStraightenResult();
  if (!state.sections?.length || !straightenResult) {
    setStatus('Load a folder, set boundary (steps 1–2), then place sections and save.');
    return;
  }
  const opts = getExportOptions();
  const layout = getExportLayout();
  const exportOptions = {
    sections: state.sections,
    straightenResult,
    marginPx: opts.marginPx,
    reading_order: layout.reading_order,
    section_relations: layout.section_relations,
    scale: opts.scale,
    marginColor: opts.marginColor,
    seamBlend: opts.seamBlend,
    seamBlendWidth: 4,
    sourceManifest: state.manifest,
    sectionToRect: getSectionRectsForExport(),
  };
  const folderName = state.folderName || 'corrected';
  try {
    setStatus('Saving to output_defaults/…');
    const { manifest, sectionBlobs, compositeBlob } = await getExportBlobsAndManifest(folderName, exportOptions);
    const form = new FormData();
    form.append('folderName', folderName);
    form.append('manifest', JSON.stringify(manifest, null, 2));
    for (const { index, blob } of sectionBlobs) {
      form.append(`section-${index}`, blob, `section-${index}.png`);
    }
    form.append('composite', compositeBlob, 'composite.png');
    const res = await fetch('/api/save-export', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    const data = await res.json();
    setStatus(`Saved to output_defaults/${data.path || 'corrected-' + folderName}/`);
  } catch (e) {
    setStatus('Save failed: ' + (e.message || '') + ' Run with npm start to save to output_defaults/.');
  }
}

function setupBoundaryEditing() {
  if (!canvas) return;

  function getEditorPoint(e) {
    if (!state.view) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    return canvasToEditor(canvasX, canvasY, state.view);
  }

  canvas.addEventListener('mousedown', (e) => {
    if (!state.sections || !state.view) return;
    const [ex, ey] = getEditorPoint(e);
    if (state.moveSectionMode) {
      const sectionIndex = getSectionIndexAtEditorPoint(ex, ey);
      if (sectionIndex != null) {
        const section = state.sections.find((s) => s.index === sectionIndex);
        if (section?.corners?.length === 4) {
          state.dragSection = {
            sectionIndex,
            startEditor: [ex, ey],
            startCorners: section.corners.map((c) => [c[0], c[1]]),
          };
        }
      }
      return;
    }
    if (state.placeLockSectionMode) {
      if (isPointInPlaceLockCenterHandle(ex, ey)) {
        const center = getPlaceLockSelectedCenter();
        if (center) {
          state.placeLockDragFromCenter = { fromSectionIndex: state.placeLockSelectedSection, startCenter: center };
          setStatus('Drag onto another section to lock with a shared edge (no gap, no overlap).');
        }
      } else {
        const placedIndex = state.placedSectionRects?.size ? getSectionIndexAtPlacedRect(ex, ey) : null;
        if (placedIndex != null) {
          const r = state.placedSectionRects.get(placedIndex);
          if (r) {
            state.dragPlacedRect = {
              sectionIndex: placedIndex,
              startEditor: [ex, ey],
              startRect: { x: r.x, y: r.y, width: r.width, height: r.height },
            };
          }
        }
        if (!state.dragPlacedRect && !state.placeLockDragFromCenter) {
          const sectionIndex = getSectionIndexAtEditorPoint(ex, ey);
          if (sectionIndex != null) {
            state.placeLockSelectedSection = sectionIndex;
            setStatus('Selected S' + sectionIndex + '. Drag from the center handle onto another section to lock.');
          }
        }
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!state.sections || !state.editorBounds || !state.view) return;
    const [ex, ey] = getEditorPoint(e);
    state.lastEditorPoint = [ex, ey];

    if (state.dragPlacedRect) {
      const { sectionIndex, startEditor, startRect } = state.dragPlacedRect;
      const dx = ex - startEditor[0];
      const dy = ey - startEditor[1];
      state.placedSectionRects.set(sectionIndex, {
        x: startRect.x + dx,
        y: startRect.y + dy,
        width: startRect.width,
        height: startRect.height,
      });
      render();
      return;
    }

    if (state.placeLockDragFromCenter) {
      const fromIndex = state.placeLockDragFromCenter.fromSectionIndex;
      const targetIndex = getSectionIndexAtEditorPoint(ex, ey);
      if (targetIndex != null && targetIndex !== fromIndex) {
        const fromSection = state.sections.find((s) => s.index === fromIndex);
        const targetSection = state.sections.find((s) => s.index === targetIndex);
        const fromRect = state.placedSectionRects?.get(fromIndex) ?? getSectionBbox(fromSection);
        const targetBbox = getSectionBbox(targetSection);
        if (fromRect && targetBbox) {
          const best = chooseBestSnapEdgeForDrop(targetBbox, fromRect);
          if (best) {
            state.placeLockSnapPreview = { targetIndex, snappedRect: best.snappedRect, edgeTarget: best.edgeTarget, edgeDragged: best.edgeDragged };
            setStatus('Release to lock S' + targetIndex + ' to S' + fromIndex + ' (shared edge, no gap).');
          } else state.placeLockSnapPreview = null;
        } else state.placeLockSnapPreview = null;
      } else {
        state.placeLockSnapPreview = null;
        setStatus('Drop on another section to lock. Green lines show existing connections.');
      }
      render();
      return;
    }

    if (state.dragSection) {
      const { sectionIndex, startEditor, startCorners } = state.dragSection;
      const dx = ex - startEditor[0];
      const dy = ey - startEditor[1];
      const section = state.sections.find((s) => s.index === sectionIndex);
      if (section?.corners?.length === 4) {
        for (let i = 0; i < 4; i++) {
          section.corners[i][0] = startCorners[i][0] + dx;
          section.corners[i][1] = startCorners[i][1] + dy;
        }
        updateValidationWarnings();
      }
      render();
      return;
    }

    if (state.outerBoundary?.polygon?.length) {
      const polygon = getPolygon(state.outerBoundary);
      if (state.boundaryEditMode === 'add') {
        const candidates = getAddCornerCandidates(ex, ey, HOVER_THRESHOLD_EDITOR_SQ);
        let closest = null;
        let closestD2 = HOVER_THRESHOLD_EDITOR_SQ;
        for (const item of candidates) {
          const d2 = (ex - item.point[0]) ** 2 + (ey - item.point[1]) ** 2;
          const prefer = (item.isEdge ? 1 : 0);
          if (d2 < closestD2 || (d2 === closestD2 && prefer === 0 && closest?.isEdge)) {
            closestD2 = d2;
            closest = item;
          }
        }
        if (closest) {
          const edgeIndex = getClosestBoundaryEdgeIndex(polygon, closest.point[0], closest.point[1]);
          state.hoveredSectionCorner = closest;
          state.hoveredBoundaryEdge = edgeIndex;
          state.hoveredBoundaryVertex = null;
        } else {
          state.hoveredSectionCorner = null;
          state.hoveredBoundaryEdge = null;
        }
      } else {
        const vi = getClosestBoundaryVertexIndex(polygon, ex, ey, HOVER_THRESHOLD_EDITOR_SQ);
        state.hoveredBoundaryVertex = vi;
        state.hoveredSectionCorner = null;
        state.hoveredBoundaryEdge = null;
      }
    }

    state.hoveredSectionIndex = getSectionIndexAtEditorPoint(ex, ey);
    updateRotateButton();
    render();
  });

  if (btnRotateSection) {
    btnRotateSection.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.hoveredSectionIndex == null || !state.sections) return;
      const section = state.sections.find((s) => s.index === state.hoveredSectionIndex);
      if (!section) return;
      section.rotation_degrees = ((section.rotation_degrees ?? 0) + 90) % 360;
      updateValidationWarnings();
      setStatus(`Section ${section.index} rotated to ${section.rotation_degrees}°.`);
      render();
    });
  }

  canvas.addEventListener('mouseup', () => {
    if (state.dragPlacedRect) {
      state.didDragPlacedRect = true;
      state.dragPlacedRect = null;
      setStatus('Locked section moved. Click a section to select, then drag from center to lock more.');
      updateLockedSectionsPanel();
      render();
    }
    if (state.placeLockDragFromCenter) {
      const fromIndex = state.placeLockDragFromCenter.fromSectionIndex;
      const preview = state.placeLockSnapPreview;
      state.placeLockDragFromCenter = null;
      state.placeLockSnapPreview = null;

      if (preview && preview.targetIndex !== fromIndex) {
        const targetIndex = preview.targetIndex;
        const fromSection = state.sections.find((s) => s.index === fromIndex);
        if (!state.placedSectionRects) {
          state.placedSectionRects = new Map();
          state.placementOrder = [];
        }
        const fromRect = state.placedSectionRects.get(fromIndex) ?? getSectionBbox(fromSection);
        if (fromRect && !state.placedSectionRects.has(fromIndex)) {
          state.placedSectionRects.set(fromIndex, { ...fromRect });
          if (!state.placementOrder.includes(fromIndex)) state.placementOrder.push(fromIndex);
        }
        state.placedSectionRects.set(targetIndex, { ...preview.snappedRect });
        if (!state.placementOrder.includes(targetIndex)) state.placementOrder.push(targetIndex);
        addPlacementRelation(targetIndex, fromIndex, preview.edgeTarget, preview.edgeDragged);
        state.placeLockSelectedSection = targetIndex;
        const n = state.sections.length;
        setStatus('S' + targetIndex + ' locked to S' + fromIndex + ' (' + state.placementOrder.length + '/' + n + '). Click a section, then drag from center to add more. Undo to remove last.');
      } else {
        setStatus('Drop on another section to lock. Click a section to select; drag from center handle.');
      }
      updateLockedSectionsPanel();
      updateCornerListUI();
      render();
      return;
    }
    if (state.dragSection) {
      state.didDragSection = true;
      state.dragSection = null;
      setStatus('Section moved. Export saves new positions.');
      updateLockedSectionsPanel();
      updateCornerListUI();
      render();
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!state.view) return;
    if (state.didDragPlacedRect) {
      state.didDragPlacedRect = false;
      return;
    }
    if (state.didDragSection) {
      state.didDragSection = false;
      return;
    }
    const [ex, ey] = getEditorPoint(e);

    if (!state.placeLockSectionMode && state.outerBoundary?.polygon?.length) {
      if (state.boundaryEditMode === 'add' && state.hoveredSectionCorner) {
        const next = addVertexAtPoint(state.outerBoundary, state.hoveredSectionCorner.point[0], state.hoveredSectionCorner.point[1]);
        state.outerBoundary = next;
        state.sectionEdgesVisible = false;
        state.placedSectionRects = null;
        state.placementOrder = [];
        state.placementSectionRelations = null;
        state.hoveredSectionCorner = null;
        state.hoveredBoundaryEdge = null;
        updateValidationWarnings();
        updateCornerListUI();
        setStatus(`Added boundary corner (snapped to H/V). ${state.outerBoundary.polygon.length} vertices.`);
        render();
        return;
      }
      if (state.boundaryEditMode === 'remove' && state.hoveredBoundaryVertex != null) {
        const next = removeVertex(state.outerBoundary, state.hoveredBoundaryVertex);
        if (next) {
          state.outerBoundary = next;
          state.sectionEdgesVisible = false;
          state.placedSectionRects = null;
          state.placementOrder = [];
          state.placementSectionRelations = null;
          state.hoveredBoundaryVertex = null;
          updateValidationWarnings();
          updateCornerListUI();
          setStatus(`Removed boundary corner (${state.outerBoundary.polygon.length} vertices).`);
        }
        render();
        return;
      }
    }

    if (state.moveSectionMode) return;
    if (state.placeLockSectionMode) return;

    const sectionIndex = getSectionIndexAtEditorPoint(ex, ey);
    if (sectionIndex != null) {
      addSectionToPlacement(sectionIndex);
    }
  });
}

function setupDropZone() {
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#888';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = '#555';
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#555';
    const item = e.dataTransfer?.items?.[0];
    if (item?.kind === 'file') {
      if (typeof item.getAsFileSystemHandle === 'function') {
        const entry = await item.getAsFileSystemHandle();
        if (entry?.kind === 'directory') {
          await loadFromFolder(entry, entry.name);
          return;
        }
      }
      setStatus('Click "Choose image set" to load from source_images.');
    }
  });
}

btnPreview?.addEventListener('click', openPreview);
btnResetPlacement?.addEventListener('click', resetPlacement);
btnUndoLastLock?.addEventListener('click', undoLastLock);
if (btnPlaceLockSection) {
  btnPlaceLockSection.addEventListener('click', () => {
    state.placeLockSectionMode = !state.placeLockSectionMode;
    state.placeLockSnapPreview = null;
    state.placeLockDragFromCenter = null;
    if (state.placeLockSectionMode) {
      state.boundaryEditMode = null;
      state.hoveredSectionCorner = null;
      state.hoveredBoundaryEdge = null;
      state.hoveredBoundaryVertex = null;
      setStatus('Click a section to select it (outline + center handle). Drag from center onto another to lock with a shared edge.');
    } else {
      setStatus('Place lock off. Click sections to place, or use Place lock to drag sections onto each other.');
    }
    updateBoundaryEditButtons();
    updateLockedSectionsPanel();
    render();
  });
}
btnPreviewDownload?.addEventListener('click', previewDownload);
btnPreviewSaveFolder?.addEventListener('click', previewSaveFolder);
btnPreviewClose?.addEventListener('click', closePreview);
previewModal?.addEventListener('click', (e) => {
  if (e.target === previewModal) closePreview();
});
if (btnAddCorner) {
  btnAddCorner.addEventListener('click', () => {
    state.boundaryEditMode = 'add';
    state.hoveredBoundaryVertex = null;
    state.moveSectionMode = false;
    updateBoundaryEditButtons();
    setStatus('Add corner: hover a section corner or edge, then click to add a boundary vertex.');
    render();
  });
}
if (btnRemoveCorner) {
  btnRemoveCorner.addEventListener('click', () => {
    state.boundaryEditMode = 'remove';
    state.hoveredSectionCorner = null;
    state.hoveredBoundaryEdge = null;
    state.moveSectionMode = false;
    updateBoundaryEditButtons();
    setStatus('Remove corner: hover a boundary corner, then click to remove it.');
    render();
  });
}
if (btnMoveSection) {
  btnMoveSection.addEventListener('click', () => {
    state.moveSectionMode = !state.moveSectionMode;
    state.dragSection = null;
    if (state.moveSectionMode) {
      state.boundaryEditMode = null;
      state.hoveredSectionCorner = null;
      state.hoveredBoundaryEdge = null;
      state.hoveredBoundaryVertex = null;
    }
    updateBoundaryEditButtons();
    setStatus(state.moveSectionMode ? 'Move section: drag a section to reposition it.' : 'Move section off.');
    render();
  });
}
function runRedoAutoBoundary() {
  if (!state.sections?.length) {
    setStatus('Load a folder first.');
    return;
  }
  state.outerBoundary = createOuterBoundary(state.sections, getOuterBoundaryPolygon);
  state.sectionEdgesVisible = false;
  state.placedSectionRects = null;
  state.placementOrder = [];
  state.placementSectionRelations = null;
  state.hoveredBoundaryEdge = null;
  state.hoveredBoundaryVertex = null;
  state.hoveredSectionCorner = null;
  updateValidationWarnings();
  updateCornerListUI();
  const n = state.outerBoundary?.polygon?.length ?? 0;
  setStatus(`Outer boundary recomputed (${n} vertices). Refine with Add/Remove corner, then place sections (step 3).`);
  render();
}

if (btnRedoAutoBoundary) {
  btnRedoAutoBoundary.addEventListener('click', runRedoAutoBoundary);
}
updateBoundaryEditButtons();
setupBoundaryEditing();

async function loadFolderList() {
  if (!folderListEl) return;
  try {
    const res = await fetch('source_images/index.json');
    if (!res.ok) return;
    const data = await res.json();
    const folders = data.folders || [];
    folderListEl.innerHTML = '';
    for (const name of folders) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folder-list-item';
      btn.dataset.folder = name;
      btn.textContent = name;
      btn.addEventListener('click', () => {
        loadFromPath(name);
      });
      folderListEl.appendChild(btn);
    }
  } catch {
    folderListEl.innerHTML = '<p class="folder-list-empty">No image sets found.</p>';
  }
}

async function loadFromPath(folderName) {
  if (!folderName) return;
  const base = `source_images/${encodeURIComponent(folderName)}`;
  const getFile = async (name) => {
    try {
      const r = await fetch(`${base}/${encodeURIComponent(name)}`);
      if (!r.ok) return null;
      const blob = await r.blob();
      return new File([blob], name, { type: blob.type || 'application/octet-stream' });
    } catch {
      return null;
    }
  };
  await loadFromFolder(getFile, folderName);
}

if (btnChooseSet) btnChooseSet.addEventListener('click', toggleLeftPanel);
if (btnClosePanel) btnClosePanel.addEventListener('click', () => leftPanel?.classList.add('collapsed'));

setupDropZone();
loadFolderList();
window.addEventListener('resize', () => {
  fitCanvasToContainer();
  if (!previewModal.classList.contains('hidden')) drawPreviewToFill();
});
setStatus('Click "Choose image set" to load a folder from source_images.');
fitCanvasToContainer();
