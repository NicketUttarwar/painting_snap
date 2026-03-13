/**
 * Edge alignment: classify section edges as outer vs internal, identify aligned edges
 * (same line / clean seam), and perpendicular corners (right-angle meetings).
 * Foundational data for manifest layout.
 *
 * Section edges: 0=top, 1=right, 2=bottom, 3=left (same as quad order TL→TR→BR→BL).
 */

const TOL = 1e-6;

function eq(a, b) {
  return Math.abs(a - b) <= TOL;
}

/**
 * Build edge geometry for each section from partition result and output rect.
 * @param {{ x: number, y: number, width: number, height: number }} outputRect
 * @param {Map<number, { x: number, y: number, width: number, height: number }>} sectionToRect
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} section_relations
 * @param {number[]} reading_order
 * @returns {{
 *   section_edges: Array<{ section_index: number, edge_index: number, type: 'outer'|'internal', line: { type: 'horizontal'|'vertical', value: number }, span: [number, number], aligns_with: { section: number|'boundary', edge?: number } }>,
 *   aligned_edges: Array<{ a: { section: number, edge: number }, b: { section: number, edge: number }|'boundary', line: object }>,
 *   perpendicular_corners: Array<{ x: number, y: number, type: 'outer'|'internal', edge_pairs: Array<{ section: number, edge: number }> }>,
 *   outer_edges: Array<{ section: number, edge: number }>
 * }}
 */
export function computeEdgeAlignment(outputRect, sectionToRect, section_relations, reading_order) {
  const section_edges = [];
  const cornerKeyToEdges = new Map();
  const outer_edges = [];

  const xMin = outputRect.x;
  const xMax = outputRect.x + outputRect.width;
  const yMin = outputRect.y;
  const yMax = outputRect.y + outputRect.height;

  const order = reading_order || Array.from(sectionToRect.keys()).sort((a, b) => a - b);

  for (const sectionIndex of order) {
    const rect = sectionToRect.get(sectionIndex);
    if (!rect) continue;

    const rel = section_relations?.[sectionIndex] || { left_of: [], right_of: [], above: [], below: [] };

    const edges = [
      { edge_index: 0, line: { type: 'horizontal', value: rect.y }, span: [rect.x, rect.x + rect.width], is_outer: eq(rect.y, yMin), neighbor: rel.above?.[0], neighbor_edge: 2 },
      { edge_index: 1, line: { type: 'vertical', value: rect.x + rect.width }, span: [rect.y, rect.y + rect.height], is_outer: eq(rect.x + rect.width, xMax), neighbor: rel.right_of?.[0], neighbor_edge: 3 },
      { edge_index: 2, line: { type: 'horizontal', value: rect.y + rect.height }, span: [rect.x, rect.x + rect.width], is_outer: eq(rect.y + rect.height, yMax), neighbor: rel.below?.[0], neighbor_edge: 0 },
      { edge_index: 3, line: { type: 'vertical', value: rect.x }, span: [rect.y, rect.y + rect.height], is_outer: eq(rect.x, xMin), neighbor: rel.left_of?.[0], neighbor_edge: 1 },
    ];

    for (const e of edges) {
      const type = e.is_outer ? 'outer' : 'internal';
      const aligns_with = e.is_outer
        ? { section: 'boundary' }
        : (e.neighbor != null ? { section: e.neighbor, edge: e.neighbor_edge } : { section: 'boundary' });

      section_edges.push({
        section_index: sectionIndex,
        edge_index: e.edge_index,
        type,
        line: e.line,
        span: e.span,
        aligns_with,
      });

      if (e.is_outer) {
        outer_edges.push({ section: sectionIndex, edge: e.edge_index });
      }
    }

    const corners = [
      { x: rect.x, y: rect.y, edges: [{ section: sectionIndex, edge: 3 }, { section: sectionIndex, edge: 0 }] },
      { x: rect.x + rect.width, y: rect.y, edges: [{ section: sectionIndex, edge: 0 }, { section: sectionIndex, edge: 1 }] },
      { x: rect.x + rect.width, y: rect.y + rect.height, edges: [{ section: sectionIndex, edge: 1 }, { section: sectionIndex, edge: 2 }] },
      { x: rect.x, y: rect.y + rect.height, edges: [{ section: sectionIndex, edge: 2 }, { section: sectionIndex, edge: 3 }] },
    ];

    for (const c of corners) {
      const k = `${c.x.toFixed(4)},${c.y.toFixed(4)}`;
      if (!cornerKeyToEdges.has(k)) {
        cornerKeyToEdges.set(k, { x: c.x, y: c.y, edge_pairs: [] });
      }
      const entry = cornerKeyToEdges.get(k);
      for (const ep of c.edges) {
        if (!entry.edge_pairs.some((p) => p.section === ep.section && p.edge === ep.edge)) {
          entry.edge_pairs.push(ep);
        }
      }
    }
  }

  const aligned_edges = buildAlignedEdgesList(section_edges);

  const perpendicular_corners = [];
  for (const [, data] of cornerKeyToEdges) {
    const onBoundary = (eq(data.x, xMin) || eq(data.x, xMax)) && data.y >= yMin - TOL && data.y <= yMax + TOL ||
      (eq(data.y, yMin) || eq(data.y, yMax)) && data.x >= xMin - TOL && data.x <= xMax + TOL;
    perpendicular_corners.push({
      x: Math.round(data.x * 1000) / 1000,
      y: Math.round(data.y * 1000) / 1000,
      type: onBoundary ? 'outer' : 'internal',
      edge_pairs: data.edge_pairs,
    });
  }

  perpendicular_corners.sort((a, b) => a.y - b.y || a.x - b.x);

  return {
    section_edges,
    aligned_edges,
    perpendicular_corners,
    outer_edges,
  };
}

function buildAlignedEdgesList(section_edges) {
  const list = [];
  const seen = new Set();
  for (const se of section_edges) {
    const a = { section: se.section_index, edge: se.edge_index };
    const aKey = `${a.section}:${a.edge}`;
    if (seen.has(aKey)) continue;
    const other = se.aligns_with?.section;
    if (other === 'boundary') {
      list.push({ a, b: 'boundary', line: se.line });
      seen.add(aKey);
    } else if (typeof other === 'number' && se.aligns_with?.edge != null) {
      const b = { section: other, edge: se.aligns_with.edge };
      const bKey = `${b.section}:${b.edge}`;
      const pairKey = [aKey, bKey].sort().join('|');
      if (!seen.has(pairKey)) {
        list.push({ a, b, line: se.line });
        seen.add(pairKey);
      }
    }
  }
  return list;
}
