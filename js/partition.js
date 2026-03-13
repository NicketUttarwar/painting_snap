/**
 * Map sections to axis-aligned grid cells (from straighten); support irregular layouts;
 * output per-section target rectangles (content area; margin applied at export).
 */

/**
 * Build rows of section indices from section_relations (above/below, left_of/right_of).
 * Top row = sections with no one above them; then each row = sections below the previous row.
 * Within a row, order by left_of/right_of.
 * @param {number} numSections
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} section_relations
 * @param {number[]} reading_order
 * @returns {number[][]} rows[r][c] = section index
 */
function buildRows(numSections, section_relations, reading_order) {
  const used = new Set();
  const rows = [];

  const topSections = reading_order.filter((i) => {
    const rel = section_relations[i];
    return !rel?.above?.length;
  });
  let current = topSections.length > 0 ? topSections : reading_order.slice(0, 1);

  while (current.length > 0) {
    const row = current.filter((i) => !used.has(i));
    row.forEach((i) => used.add(i));
    if (row.length > 0) {
      row.sort((a, b) => {
        const relA = section_relations[a];
        const relB = section_relations[b];
        if (relA?.right_of?.includes(b)) return -1;
        if (relB?.right_of?.includes(a)) return 1;
        return a - b;
      });
      rows.push(row);
    }
    const nextSet = new Set();
    for (const i of current) {
      const rel = section_relations[i];
      for (const j of rel?.below || []) nextSet.add(j);
    }
    current = Array.from(nextSet).filter((j) => !used.has(j));
  }

  for (const i of reading_order) {
    if (!used.has(i)) rows.push([i]);
  }

  return rows;
}

/**
 * Get layout rows (for arrangement detection and manifest).
 * @param {number} numSections
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} section_relations
 * @param {number[]} reading_order
 * @returns {number[][]} rows[r][c] = section index
 */
export function getLayoutRows(numSections, section_relations, reading_order) {
  return buildRows(numSections, section_relations || [], reading_order || []);
}

/**
 * Partition output rectangle into one target rectangle per section.
 * @param {object} options
 * @param {{ x: number, y: number, width: number, height: number }} options.outputRect - content area (editor space)
 * @param {Array<{ index: number, corners: number[][], centroid_x: number, centroid_y: number }>} options.sections
 * @param {number[]} options.reading_order
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} options.section_relations
 * @returns {Map<number, { x: number, y: number, width: number, height: number }>} section index -> target rect in editor space
 */
export function partition({ outputRect, sections, reading_order, section_relations }) {
  const rows = buildRows(sections.length, section_relations, reading_order);
  if (rows.length === 0) return new Map();

  const R = outputRect;
  const nRows = rows.length;
  const nCols = Math.max(...rows.map((r) => r.length));

  const sectionToRowCol = new Map();
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      sectionToRowCol.set(rows[r][c], { r, c, rowLen: rows[r].length });
    }
  }

  const result = new Map();

  for (let r = 0; r < nRows; r++) {
    const rowSections = rows[r];
    const rowLen = rowSections.length;
    const cellW = R.width / rowLen;
    const cellH = R.height / nRows;

    for (let c = 0; c < rowLen; c++) {
      const sectionIndex = rowSections[c];
      const x = R.x + c * cellW;
      const y = R.y + r * cellH;
      result.set(sectionIndex, {
        x,
        y,
        width: cellW,
        height: cellH,
      });
    }
  }

  return result;
}

const DEFAULT_EDGE_BUFFER_PX = 6;

/**
 * Apply a buffer between section rects so they do not overlap. Each rect is inset by bufferPx/2
 * on each side so shared edges become two edges with a gap. Uses existing partition edges.
 * @param {Map<number, { x: number, y: number, width: number, height: number }>} sectionToRect
 * @param {number} [bufferPx=DEFAULT_EDGE_BUFFER_PX]
 * @returns {Map<number, { x: number, y: number, width: number, height: number }>}
 */
export function partitionWithBuffer(sectionToRect, bufferPx = DEFAULT_EDGE_BUFFER_PX) {
  const b = Math.max(0, bufferPx);
  const half = b / 2;
  const out = new Map();
  for (const [idx, rect] of sectionToRect) {
    const w = Math.max(1, rect.width - b);
    const h = Math.max(1, rect.height - b);
    out.set(idx, {
      x: rect.x + half,
      y: rect.y + half,
      width: w,
      height: h,
    });
  }
  return out;
}
