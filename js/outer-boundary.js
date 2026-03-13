/**
 * State for outer boundary as a polygon (N >= 4 vertices).
 * Integrates with straighten: straighten consumes this polygon and produces grid + output rect.
 */

/**
 * Create initial outer boundary state from sections (convex hull of all section corners).
 * @param {import('./manifest.js').Section[]} sections
 * @param {function(Section[]): number[][]} getPolygon - e.g. getOuterBoundaryPolygon from manifest
 * @returns {{ polygon: number[][], vertices: number }}
 */
export function createOuterBoundary(sections, getPolygon) {
  const polygon = getPolygon(sections);
  return {
    polygon: polygon.map((p) => [p[0], p[1]]),
    vertices: polygon.length,
  };
}

/**
 * Get outer boundary polygon (ordered list of [x,y] in editor space).
 * @param {{ polygon: number[][] }} state
 * @returns {number[][]}
 */
export function getPolygon(state) {
  return state?.polygon ? state.polygon.map((p) => [p[0], p[1]]) : [];
}

/**
 * Squared distance from point to segment (for comparisons).
 * @param {number} px
 * @param {number} py
 * @param {number[]} a - [x,y]
 * @param {number[]} b - [x,y]
 * @returns {number}
 */
function dist2PointToSegment(px, py, a, b) {
  const x0 = a[0], y0 = a[1], x1 = b[0], y1 = b[1];
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-18;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  const nx = x0 + t * dx, ny = y0 + t * dy;
  return (px - nx) ** 2 + (py - ny) ** 2;
}

/**
 * Index of the boundary edge (vertex i to i+1) closest to the given point.
 * @param {number[][]} polygon - [x,y] each
 * @param {number} px
 * @param {number} py
 * @returns {number} edge index (0 .. polygon.length-1)
 */
export function getClosestBoundaryEdgeIndex(polygon, px, py) {
  if (!polygon || polygon.length < 2) return 0;
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const d2 = dist2PointToSegment(px, py, polygon[i], polygon[j]);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * Snap a new corner so the two edges from it are horizontal and vertical (right angle).
 * When splitting edge A→B, the only positions that make A-P and P-B axis-aligned are
 * P = (A[0], B[1]) or P = (B[0], A[1]). Picks the one closer to (px, py).
 * @param {number[]} a - [x,y] first endpoint of edge
 * @param {number[]} b - [x,y] second endpoint of edge
 * @param {number} px - desired x (e.g. section corner)
 * @param {number} py - desired y
 * @returns {number[]} [x,y] snapped point
 */
export function snapNewCornerToRightAngle(a, b, px, py) {
  const p1 = [a[0], b[1]]; // A→P vertical, P→B horizontal
  const p2 = [b[0], a[1]]; // A→P horizontal, P→B vertical
  const d1 = (px - p1[0]) ** 2 + (py - p1[1]) ** 2;
  const d2 = (px - p2[0]) ** 2 + (py - p2[1]) ** 2;
  return d1 <= d2 ? p1 : p2;
}

/**
 * Insert a new vertex by splitting the closest boundary edge. The new vertex is snapped
 * so the two resulting edges are horizontal and vertical (right angle), keeping the
 * boundary rectilinear.
 * @param {{ polygon: number[][] }} state
 * @param {number} editorX
 * @param {number} editorY
 * @returns {{ polygon: number[][], vertices: number }}
 */
export function addVertexAtPoint(state, editorX, editorY) {
  const polygon = getPolygon(state);
  if (polygon.length < 2) return state;
  const edgeIndex = getClosestBoundaryEdgeIndex(polygon, editorX, editorY);
  const a = polygon[edgeIndex];
  const b = polygon[(edgeIndex + 1) % polygon.length];
  const snapped = snapNewCornerToRightAngle(a, b, editorX, editorY);
  const newPoint = [snapped[0], snapped[1]];
  const next = edgeIndex + 1;
  const newPolygon = [
    ...polygon.slice(0, next),
    newPoint,
    ...polygon.slice(next),
  ];
  return {
    polygon: newPolygon,
    vertices: newPolygon.length,
  };
}

/**
 * Remove the boundary vertex at the given index (polygon must keep at least 3 vertices).
 * @param {{ polygon: number[][] }} state
 * @param {number} vertexIndex
 * @returns {{ polygon: number[][], vertices: number }|null} new state or null if cannot remove
 */
export function removeVertex(state, vertexIndex) {
  const polygon = getPolygon(state);
  if (polygon.length <= 3 || vertexIndex < 0 || vertexIndex >= polygon.length) return null;
  const newPolygon = polygon.filter((_, i) => i !== vertexIndex);
  return {
    polygon: newPolygon,
    vertices: newPolygon.length,
  };
}

/**
 * Index of the boundary vertex closest to the given point (within maxDist in editor space).
 * @param {number[][]} polygon
 * @param {number} px
 * @param {number} py
 * @param {number} maxDist2 - max squared distance
 * @returns {number|null} vertex index or null
 */
export function getClosestBoundaryVertexIndex(polygon, px, py, maxDist2 = 400) {
  if (!polygon?.length) return null;
  let best = null;
  let bestD2 = maxDist2;
  for (let i = 0; i < polygon.length; i++) {
    const d2 = (px - polygon[i][0]) ** 2 + (py - polygon[i][1]) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * Point-in-polygon (ray casting). Polygon is array of [x,y].
 * @param {number[][]} polygon
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
export function pointInPolygon(polygon, px, py) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * True if segment (a1,b1) and (a2,b2) intersect (proper crossing or touch at interior).
 * Excludes touch only at endpoints to avoid false positives when chord touches a section corner.
 * @param {number[]} a1
 * @param {number[]} b1
 * @param {number[]} a2
 * @param {number[]} b2
 * @returns {boolean}
 */
function segmentIntersectsSegment(a1, b1, a2, b2) {
  const [x1, y1] = a1, [x2, y2] = b1, [x3, y3] = a2, [x4, y4] = b2;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

/**
 * True if segment (a,b) intersects the interior of any edge of the quad.
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[][]} quad - 4 [x,y]
 * @returns {boolean}
 */
function segmentIntersectsQuad(a, b, quad) {
  if (!quad || quad.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    if (segmentIntersectsSegment(a, b, p, q)) return true;
  }
  return false;
}

/**
 * Remove the negative space (gap) at point P by cutting the boundary polygon.
 * P must be inside the boundary and outside all sections. Finds the boundary edge closest to P,
 * then finds a vertex j such that the chord (v_e, v_j) doesn't cross any section; removes
 * the arc between e and j so the gap is no longer inside the boundary.
 * @param {{ polygon: number[][] }} state
 * @param {number} px
 * @param {number} py
 * @param {Array<{ corners: number[][] }>} sections
 * @returns {{ polygon: number[][], vertices: number }|null} new state or null if cannot remove
 */
export function removeNegativeSpaceAt(state, px, py, sections) {
  const polygon = getPolygon(state);
  if (!polygon || polygon.length < 4) return null;
  const n = polygon.length;
  const edgeIndex = getClosestBoundaryEdgeIndex(polygon, px, py);
  const vStart = edgeIndex;
  const quads = (sections || []).map((s) => s.corners).filter((c) => c && c.length === 4);

  for (const step of [1, -1]) {
    let j = (vStart + (step === 1 ? 2 : -2 + n)) % n;
    const maxSteps = n - 2;
    const vStartNext = (vStart + 1) % n;
    for (let k = 0; k < maxSteps; k++) {
      const vEnd = (j + n) % n;
      if (vEnd === vStart || vEnd === vStartNext) break;
      const a = step === 1 ? polygon[vStart] : polygon[vStartNext];
      const b = polygon[vEnd];
      let crosses = false;
      for (const quad of quads) {
        if (segmentIntersectsQuad(a, b, quad)) {
          crosses = true;
          break;
        }
      }
      if (!crosses) {
        let newPolygon;
        if (step === 1) {
          if (vEnd > vStart) {
            newPolygon = [...polygon.slice(0, vStart + 1), ...polygon.slice(vEnd)];
          } else {
            newPolygon = polygon.slice(vEnd, vStart + 1);
          }
        } else {
          if (vEnd > vStart) {
            newPolygon = polygon.slice(vStart + 1, vEnd + 1);
          } else {
            newPolygon = [...polygon.slice(0, vEnd + 1), ...polygon.slice(vStart + 1)];
          }
        }
        if (newPolygon.length >= 3) {
          return {
            polygon: newPolygon,
            vertices: newPolygon.length,
          };
        }
      }
      j += step;
    }
  }
  return null;
}
