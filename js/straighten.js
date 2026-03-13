/**
 * Straighten: use the exact outer boundary polygon, convert each edge to a right angle
 * (horizontal or vertical). New edges = those rectilinear edges; grid and output rect
 * are derived from that shape (no collapse to a single rectangle from internal edges).
 */

/**
 * Snap a line segment to horizontal or vertical (same line position, axis-aligned).
 * @param {number[]} p1 [x,y]
 * @param {number[]} p2 [x,y]
 * @returns {{ type: 'h'|'v', value: number }} - for 'h': y = value; for 'v': x = value
 */
function snapEdgeToRightAngle(p1, p2) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const angle = Math.atan2(dy, dx);
  const toHorizontal = Math.min(Math.abs(angle), Math.abs(angle - Math.PI));
  const toVertical = Math.min(Math.abs(angle - Math.PI / 2), Math.abs(angle + Math.PI / 2));
  const horizontal = toHorizontal <= toVertical;

  if (horizontal) {
    const y = (p1[1] + p2[1]) / 2;
    return { type: 'h', value: y };
  } else {
    const x = (p1[0] + p2[0]) / 2;
    return { type: 'v', value: x };
  }
}

/**
 * Build a rectilinear polygon from the outer boundary: each edge becomes horizontal or
 * vertical, vertices become right-angle intersections (or we insert a corner when two
 * consecutive edges snap to the same orientation).
 * @param {number[][]} outerPolygon - closed polygon [x,y][] in editor space
 * @returns {number[][]} rectilinear polygon (closed), same winding
 */
function rectilinearizePolygon(outerPolygon) {
  const n = outerPolygon.length;
  if (n < 3) return outerPolygon.map((p) => [p[0], p[1]]);

  // Snap each edge (i -> i+1) to H or V
  const snapped = [];
  for (let i = 0; i < n; i++) {
    const a = outerPolygon[i];
    const b = outerPolygon[(i + 1) % n];
    snapped.push(snapEdgeToRightAngle(a, b));
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = snapped[(i - 1 + n) % n];
    const curr = snapped[i];
    const orig = outerPolygon[i];

    if (prev.type !== curr.type) {
      // Right-angle: intersection of perpendicular lines
      const x = prev.type === 'v' ? prev.value : curr.value;
      const y = prev.type === 'h' ? prev.value : curr.value;
      out.push([x, y]);
    } else {
      // Same orientation: insert a 90° corner using the original vertex's other coordinate
      if (prev.type === 'h') {
        // Both horizontal -> vertical segment at x = orig[0]
        out.push([orig[0], prev.value]);
        if (prev.value !== curr.value) out.push([orig[0], curr.value]);
      } else {
        // Both vertical -> horizontal segment at y = orig[1]
        out.push([prev.value, orig[1]]);
        if (prev.value !== curr.value) out.push([curr.value, orig[1]]);
      }
    }
  }

  return out;
}

/**
 * Straighten: use only the outer boundary polygon. Convert its edges to right angles
 * (horizontal/vertical); those are the new edges. Grid and output rect come from
 * this rectilinear polygon (exact corners and measurements, no rectangle collapse).
 *
 * @param {object} options
 * @param {number[][]} options.outerPolygon - boundary polygon [x,y][] (closed)
 * @param {Array<{ corners: number[][], index: number }>} [options.sections] - unused for shape; kept for API
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} [options.section_relations] - unused for shape; kept for API
 * @returns {{ grid: { xLines: number[], yLines: number[] }, outputRect: { x: number, y: number, width: number, height: number }, rectilinearPolygon?: number[][] }}
 */
export function straighten({ outerPolygon, sections, section_relations }) {
  if (!outerPolygon || outerPolygon.length < 3) {
    return {
      grid: { xLines: [0, 1], yLines: [0, 1] },
      outputRect: { x: 0, y: 0, width: 1, height: 1 },
    };
  }

  const rectilinear = rectilinearizePolygon(outerPolygon);

  const xSet = new Set();
  const ySet = new Set();
  for (const p of rectilinear) {
    xSet.add(p[0]);
    ySet.add(p[1]);
  }

  const xLines = Array.from(xSet).sort((a, b) => a - b);
  const yLines = Array.from(ySet).sort((a, b) => a - b);

  if (xLines.length < 2) xLines.push(xLines[0] + 1);
  if (yLines.length < 2) yLines.push(yLines[0] + 1);

  const minX = Math.min(...xLines);
  const maxX = Math.max(...xLines);
  const minY = Math.min(...yLines);
  const maxY = Math.max(...yLines);

  const outputRect = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  return {
    grid: { xLines, yLines },
    outputRect,
    rectilinearPolygon: rectilinear,
  };
}

/**
 * Apply margin to output rect: expand by margin on all sides.
 * @param {{ x: number, y: number, width: number, height: number }} outputRect
 * @param {number} marginPx
 * @returns {{ contentRect: object, fullRect: object, marginPx: number }}
 */
export function applyMargin(outputRect, marginPx) {
  const m = Math.max(0, marginPx);
  return {
    contentRect: { ...outputRect },
    fullRect: {
      x: outputRect.x - m,
      y: outputRect.y - m,
      width: outputRect.width + 2 * m,
      height: outputRect.height + 2 * m,
    },
    marginPx: m,
  };
}
