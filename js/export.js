/**
 * Composite warped sections onto output canvas; apply margin; optional seam blending; trigger download.
 */

import { warpSectionToRect } from './warp.js';
import { partition, getLayoutRows } from './partition.js';
import { applyMargin } from './straighten.js';
import { blendSeams } from './blend.js';
import { computeEdgeAlignment } from './edge-alignment.js';

/**
 * Build the full export image: content (warped sections) + margin.
 * @param {object} options
 * @param {Array<{ index: number, image?: HTMLImageElement, corners: number[][], output_width_px: number, output_height_px: number }>} options.sections
 * @param {object} options.straightenResult - { grid, outputRect }
 * @param {number} options.marginPx
 * @param {number} options.reading_order
 * @param {object} options.section_relations
 * @param {number} [scale=1] - resolution scale
 * @param {string} [marginColor='#ffffff'] - margin fill (hex or rgb)
 * @param {boolean} [seamBlend=false] - blend along internal edges
 * @param {number} [seamBlendWidth=4] - pixels to feather at seams
 * @returns {HTMLCanvasElement}
 */
export function buildExportCanvas(options) {
  const {
    sections,
    straightenResult,
    marginPx = 0,
    reading_order,
    section_relations,
    scale = 1,
    marginColor = '#ffffff',
    seamBlend = false,
    seamBlendWidth = 4,
  } = options;

  const { outputRect } = straightenResult;
  const { fullRect, marginPx: m } = applyMargin(outputRect, marginPx);

  const totalW = Math.max(1, Math.round(fullRect.width * scale));
  const totalH = Math.max(1, Math.round(fullRect.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = marginColor;
  ctx.fillRect(0, 0, totalW, totalH);

  const contentRect = {
    x: outputRect.x,
    y: outputRect.y,
    width: outputRect.width,
    height: outputRect.height,
  };
  const sectionToRectContent =
    options.sectionToRect ||
    partition({
      outputRect: contentRect,
      sections,
      reading_order,
      section_relations,
    });

  const offsetX = m * scale;
  const offsetY = m * scale;
  const contentScale = scale;

  const sectionToRectCanvas = new Map();
  const order = reading_order || sections.map((s) => s.index);

  for (const idx of order) {
    const section = sections.find((s) => s.index === idx);
    if (!section?.image) continue;
    const rect = sectionToRectContent.get(idx);
    if (!rect) continue;

    const targetRect = {
      x: (rect.x - outputRect.x) * contentScale + offsetX,
      y: (rect.y - outputRect.y) * contentScale + offsetY,
      width: rect.width * contentScale,
      height: rect.height * contentScale,
    };
    sectionToRectCanvas.set(idx, { ...targetRect });

    const rot = section.rotation_degrees != null ? section.rotation_degrees : 0;
    warpSectionToRect(
      ctx,
      section.image,
      section.output_width_px || section.image.naturalWidth,
      section.output_height_px || section.image.naturalHeight,
      targetRect,
      rot
    );
  }

  if (seamBlend && section_relations) {
    blendSeams(ctx, sectionToRectCanvas, section_relations, seamBlendWidth);
  }

  return canvas;
}

/**
 * Trigger download of the export canvas as PNG.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [filename='corrected.png']
 */
export function downloadCanvas(canvas, filename = 'corrected.png') {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

const DEFAULT_OUTPUT_DIR = 'output_defaults';

/**
 * Save canvas as PNG to a directory using the File System Access API.
 * @param {HTMLCanvasElement} canvas
 * @param {FileSystemDirectoryHandle} directoryHandle
 * @param {string} filename
 * @returns {Promise<boolean>} true if saved, false on cancel/error
 */
export async function saveCanvasToDirectory(canvas, directoryHandle, filename) {
  if (!directoryHandle) return false;
  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (e) {
    if (e.name === 'AbortError') return false;
    console.error('Save to directory failed:', e);
    return false;
  }
}

/**
 * Ask the user to pick the output directory (e.g. output_defaults).
 * @param {FileSystemDirectoryHandle|null} [startInHandle] - If set (e.g. previous output folder), dialog opens there.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function pickOutputDirectory(startInHandle = null) {
  if (!('showDirectoryPicker' in window)) return null;
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: startInHandle || 'documents',
    });
    return handle;
  } catch (e) {
    if (e.name === 'AbortError') return null;
    throw e;
  }
}

export { DEFAULT_OUTPUT_DIR };

/**
 * Build one canvas per section (warped to that section's rect only), at scale 1.
 * @param {object} options - same as buildExportCanvas (sections, straightenResult, reading_order, section_relations)
 * @returns {{ sectionCanvases: Array<{ index: number, canvas: HTMLCanvasElement }>, sectionToRect: Map<number, object> }}
 */
export function buildSectionCanvases(options) {
  const { sections, straightenResult, reading_order, section_relations } = options;
  const { outputRect } = straightenResult;
  const contentRect = { x: outputRect.x, y: outputRect.y, width: outputRect.width, height: outputRect.height };
  const sectionToRect =
    options.sectionToRect ||
    partition({
      outputRect: contentRect,
      sections,
      reading_order,
      section_relations,
    });

  const sectionCanvases = [];
  const order = reading_order || sections.map((s) => s.index);
  for (const idx of order) {
    const section = sections.find((s) => s.index === idx);
    if (!section?.image) continue;
    const rect = sectionToRect.get(idx);
    if (!rect) continue;

    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    const targetRect = { x: 0, y: 0, width: w, height: h };
    const rot = section.rotation_degrees != null ? section.rotation_degrees : 0;
    warpSectionToRect(
      ctx,
      section.image,
      section.output_width_px || section.image.naturalWidth,
      section.output_height_px || section.image.naturalHeight,
      targetRect,
      rot
    );
    sectionCanvases.push({ index: idx, canvas });
  }
  return { sectionCanvases, sectionToRect };
}

/**
 * Detect layout arrangement from section relations and reading order.
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} section_relations
 * @param {number[]} reading_order
 * @param {number} numSections
 * @returns {{ arrangement: 'vertical'|'horizontal'|'grid'|'polygon', description: string }}
 */
export function detectArrangement(section_relations, reading_order, numSections) {
  const rows = getLayoutRows(numSections, section_relations || [], reading_order || []);
  if (rows.length === 0) {
    return { arrangement: 'grid', description: 'Single or unknown layout.' };
  }
  const rowLengths = rows.map((r) => r.length);
  const oneCol = rowLengths.every((len) => len === 1);
  const oneRow = rows.length === 1 && rows[0].length > 1;
  const uniform = rowLengths.length > 0 && rowLengths.every((len) => len === rowLengths[0]);
  let arrangement;
  let description;
  if (oneRow) {
    arrangement = 'horizontal';
    description = 'Sections arranged in a single row (left to right).';
  } else if (oneCol) {
    arrangement = 'vertical';
    description = 'Sections stacked vertically (top to bottom).';
  } else if (!uniform) {
    arrangement = 'polygon';
    description = 'Irregular layout: sections meet centrally or in an L/T shape (odd number or varying row lengths).';
  } else {
    arrangement = 'grid';
    description = 'Sections in a regular grid (rows and columns).';
  }
  return { arrangement, description };
}

const EDGE_NAMES = { 0: 'top', 1: 'right', 2: 'bottom', 3: 'left' };

/**
 * Build shared_edges list (internal connections) and outer_edges_summary from edgeAlignment for manifest.
 * @param {object} edgeAlignment - from computeEdgeAlignment
 * @returns {{ shared_edges: Array<{ section_a: number, edge_a: number, edge_name_a: string, section_b: number, edge_b: number, edge_name_b: string }>, outer_edges_summary: Array<{ section_index: number, edge_index: number, edge_name: string }> }}
 */
function buildManifestEdgeSummaries(edgeAlignment) {
  const shared_edges = [];
  const seenPairs = new Set();
  if (edgeAlignment?.section_edges) {
    for (const se of edgeAlignment.section_edges) {
      if (se.type !== 'internal' || se.aligns_with?.section === 'boundary' || typeof se.aligns_with?.section !== 'number') continue;
      const section_a = se.section_index;
      const edge_a = se.edge_index;
      const section_b = se.aligns_with.section;
      const edge_b = se.aligns_with.edge ?? -1;
      const key = [section_a, edge_a, section_b, edge_b].sort((x, y) => x - y).join(',');
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      shared_edges.push({
        section_a,
        edge_a,
        edge_name_a: EDGE_NAMES[edge_a] ?? 'unknown',
        section_b,
        edge_b,
        edge_name_b: EDGE_NAMES[edge_b] ?? 'unknown',
      });
    }
  }
  const outer_edges_summary = [];
  if (edgeAlignment?.outer_edges) {
    for (const oe of edgeAlignment.outer_edges) {
      outer_edges_summary.push({
        section_index: oe.section,
        edge_index: oe.edge,
        edge_name: EDGE_NAMES[oe.edge] ?? 'unknown',
      });
    }
  }
  return { shared_edges, outer_edges_summary };
}

/**
 * Normalize section_relations to a full array (no sparse slots) for JSON. Ensures every section index up to max has an entry.
 * @param {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} section_relations
 * @param {number} maxSectionIndex
 * @returns {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>}
 */
function normalizeSectionRelationsForManifest(section_relations, maxSectionIndex) {
  if (!section_relations || !Array.isArray(section_relations)) return [];
  const n = maxSectionIndex + 1;
  const out = [];
  const empty = () => ({ left_of: [], right_of: [], above: [], below: [] });
  for (let i = 0; i < n; i++) {
    const r = section_relations[i];
    out.push(r ? { left_of: r.left_of || [], right_of: r.right_of || [], above: r.above || [], below: r.below || [] } : empty());
  }
  return out;
}

/**
 * Build manifest JSON for the corrected export folder. Stores all relevant information so the
 * folder can be re-loaded or reproduced: sections (with corners, centroids, rotation), layout,
 * output_rect, composite dimensions, connections (shared edges, outer edges), and optional rectilinear boundary.
 *
 * @param {object} options
 * @param {string} [options.source_filename] - e.g. folder name or original source filename
 * @param {number} [options.source_width] - original source image width (or null for corrected-only)
 * @param {number} [options.source_height] - original source image height (or null for corrected-only)
 * @param {Array<{ index: number, output_width_px: number, output_height_px: number, rotation_degrees?: number }>} options.sections - source section info
 * @param {Map<number, { x, y, width, height }>} options.sectionToRect - in editor/content space
 * @param {object} options.straightenResult - { outputRect, rectilinearPolygon? }
 * @param {number} options.marginPx
 * @param {number[]} options.reading_order
 * @param {Array} options.section_relations
 * @param {{ arrangement: string, description: string }} options.layoutDetection
 * @param {object} [options.edgeAlignment] - from computeEdgeAlignment
 * @param {number} [options.scale=1] - export scale; composite.png dimensions = (composite_width_px, composite_height_px)
 * @param {string} [options.marginColor='#ffffff'] - fill color for margin when recreating composite
 * @returns {object} manifest object ready for JSON.stringify
 */
export function buildExportManifest(options) {
  const {
    source_filename = 'corrected',
    source_width,
    source_height,
    sections: sectionsInfo,
    sectionToRect,
    straightenResult,
    marginPx = 0,
    reading_order,
    section_relations,
    layoutDetection,
    edgeAlignment,
    scale = 1,
    marginColor = '#ffffff',
  } = options;

  const { outputRect } = straightenResult;
  const m = Math.max(0, marginPx);
  const { fullRect } = applyMargin(outputRect, m);

  const compositeWidthPx = Math.max(1, Math.round(fullRect.width * scale));
  const compositeHeightPx = Math.max(1, Math.round(fullRect.height * scale));

  const sections = [];
  const order = reading_order || sectionsInfo.map((s) => s.index);
  const maxSectionIndex = Math.max(0, ...order, ...(sectionsInfo?.map((s) => s.index) ?? []));
  const section_positions = {};
  let positionRank = 0;
  for (const idx of order) {
    const info = sectionsInfo.find((s) => s.index === idx);
    const rect = sectionToRect?.get(idx);
    if (!info || !rect) continue;

    const bx = m + (rect.x - outputRect.x);
    const by = m + (rect.y - outputRect.y);
    const bw = Math.round(rect.width);
    const bh = Math.round(rect.height);
    const rotation_degrees = info.rotation_degrees != null ? info.rotation_degrees : 0;

    const boundsInComposite = { x: bx, y: by, width: bw, height: bh };
    const bounds_px = {
      x: Math.round(bx * scale),
      y: Math.round(by * scale),
      width: Math.round(bw * scale),
      height: Math.round(bh * scale),
    };

    const corners = [
      [bx, by],
      [bx + bw, by],
      [bx + bw, by + bh],
      [bx, by + bh],
    ];
    const centroid_x = bx + bw / 2;
    const centroid_y = by + bh / 2;

    section_positions[idx] = {
      x: bx,
      y: by,
      width: bw,
      height: bh,
      rotation_degrees,
    };

    const sectionEntry = {
      index: idx,
      filename: `section-${idx}.png`,
      bounds: boundsInComposite,
      bounds_px,
      corners,
      centroid_x,
      centroid_y,
      rotation_degrees,
      source_width: fullRect.width,
      source_height: fullRect.height,
      section_type: 'quad',
      output_width_px: bw,
      output_height_px: bh,
      origin_x: bx,
      origin_y: by,
      width_px: bw,
      height_px: bh,
      position_rank: positionRank++,
    };

    if (edgeAlignment) {
      sectionEntry.edges = edgeAlignment.section_edges
        .filter((se) => se.section_index === idx)
        .map(({ edge_index, type, line, aligns_with }) => ({
          edge_index,
          edge_name: EDGE_NAMES[edge_index] ?? 'unknown',
          type,
          line,
          aligns_with,
        }));
    }

    sections.push(sectionEntry);
  }

  const normalized_relations = normalizeSectionRelationsForManifest(section_relations, maxSectionIndex);
  const { shared_edges, outer_edges_summary } = buildManifestEdgeSummaries(edgeAlignment);

  const layout = {
    reading_order: reading_order || order,
    section_relations: normalized_relations,
    section_positions,
    arrangement: layoutDetection?.arrangement ?? 'grid',
    description: layoutDetection?.description ?? 'Corrected section layout with H/V alignment.',
    connections_description: 'shared_edges = internal seams (section_a edge_name_a abuts section_b edge_name_b). outer_edges_summary = edges on the composite boundary. section_relations = left_of, right_of, above, below per section index.',
    shared_edges,
    outer_edges_summary,
  };

  if (edgeAlignment) {
    layout.edge_alignment = {
      description: 'Section edges classified as outer (boundary) or internal (shared). Edge indices: 0=top, 1=right, 2=bottom, 3=left. shared_edges = internal connections; outer_edges_summary = edges on composite boundary.',
      edge_index_names: EDGE_NAMES,
      section_edges: edgeAlignment.section_edges,
      aligned_edges: edgeAlignment.aligned_edges,
      perpendicular_corners: edgeAlignment.perpendicular_corners,
      outer_edges: edgeAlignment.outer_edges,
    };
  }

  const manifest = {
    source_filename: source_filename || 'corrected',
    source_width: fullRect.width,
    source_height: fullRect.height,
    composite_filename: 'composite.png',
    composite_width: fullRect.width,
    composite_height: fullRect.height,
    composite_width_px: compositeWidthPx,
    composite_height_px: compositeHeightPx,
    scale,
    margin_px: m,
    margin_color: marginColor,
    output_rect: {
      x: outputRect.x,
      y: outputRect.y,
      width: outputRect.width,
      height: outputRect.height,
    },
    sections,
    layout,
    recreate_composite: 'Create an image of size composite_width_px x composite_height_px. Fill with margin_color (e.g. for margin area). For each section index in layout.reading_order, draw the file sections[i].filename at position (sections[i].bounds_px.x, sections[i].bounds_px.y) with size sections[i].bounds_px.width x sections[i].bounds_px.height. Result matches composite.png.',
  };

  if (source_width != null || source_height != null) {
    manifest.original_source_width = source_width ?? null;
    manifest.original_source_height = source_height ?? null;
  }

  if (straightenResult.rectilinearPolygon && straightenResult.rectilinearPolygon.length > 0) {
    manifest.rectilinear_polygon = straightenResult.rectilinearPolygon.map((p) => [p[0], p[1]]);
  }

  return manifest;
}

/**
 * Save a full export folder: section-0.png, section-1.png, ..., composite.png, manifest.json.
 * @param {FileSystemDirectoryHandle} directoryHandle
 * @param {string} folderName - used for composite filename and manifest source_filename
 * @param {object} options - buildExportCanvas options + marginPx, marginColor, scale, seamBlend
 * @returns {Promise<{ saved: string[], failed: string[] }>}
 */
export async function saveExportFolder(directoryHandle, folderName, options) {
  const saved = [];
  const failed = [];

  const { sectionCanvases, sectionToRect } = buildSectionCanvases(options);
  const compositeCanvas = buildExportCanvas(options);

  for (const { index, canvas } of sectionCanvases) {
    const filename = `section-${index}.png`;
    try {
      const ok = await saveCanvasToDirectory(canvas, directoryHandle, filename);
      if (ok) saved.push(filename);
      else failed.push(filename);
    } catch (e) {
      failed.push(filename);
    }
  }

  const compositeName = 'composite.png';
  try {
    const ok = await saveCanvasToDirectory(compositeCanvas, directoryHandle, compositeName);
    if (ok) saved.push(compositeName);
    else failed.push(compositeName);
  } catch (e) {
    failed.push(compositeName);
  }

  const layoutDetection = detectArrangement(
    options.section_relations,
    options.reading_order,
    (options.sections || []).length
  );

  const edgeAlignment = computeEdgeAlignment(
    options.straightenResult.outputRect,
    sectionToRect,
    options.section_relations,
    options.reading_order
  );

  const sourceManifest = options.sourceManifest || {};
  const manifest = buildExportManifest({
    source_filename: folderName || sourceManifest.source_filename || 'corrected',
    source_width: sourceManifest.source_width ?? (options.sections?.[0]?.source_width),
    source_height: sourceManifest.source_height ?? (options.sections?.[0]?.source_height),
    sections: (options.sections || []).map((s) => ({
      index: s.index,
      output_width_px: s.output_width_px,
      output_height_px: s.output_height_px,
      rotation_degrees: s.rotation_degrees != null ? s.rotation_degrees : 0,
    })),
    sectionToRect,
    straightenResult: options.straightenResult,
    marginPx: options.marginPx ?? 0,
    reading_order: options.reading_order,
    section_relations: options.section_relations,
    layoutDetection,
    edgeAlignment,
    scale: options.scale ?? 1,
    marginColor: options.marginColor ?? '#ffffff',
  });

  const manifestStr = JSON.stringify(manifest, null, 2);
  try {
    const blob = new Blob([manifestStr], { type: 'application/json' });
    const fileHandle = await directoryHandle.getFileHandle('manifest.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    saved.push('manifest.json');
  } catch (e) {
    failed.push('manifest.json');
  }

  return { saved, failed };
}

/**
 * Build export blobs and manifest for saving to output_defaults (e.g. via API).
 * @param {string} folderName
 * @param {object} options - same as saveExportFolder
 * @returns {Promise<{ folderName: string, manifest: object, sectionBlobs: Array<{ index: number, blob: Blob }>, compositeBlob: Blob }>}
 */
export async function getExportBlobsAndManifest(folderName, options) {
  const { sectionCanvases, sectionToRect } = buildSectionCanvases(options);
  const compositeCanvas = buildExportCanvas(options);

  const sectionBlobs = [];
  for (const { index, canvas } of sectionCanvases) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) sectionBlobs.push({ index, blob });
  }

  const compositeBlob = await new Promise((resolve) => compositeCanvas.toBlob(resolve, 'image/png'));

  const layoutDetection = detectArrangement(
    options.section_relations,
    options.reading_order,
    (options.sections || []).length
  );

  const edgeAlignment = computeEdgeAlignment(
    options.straightenResult.outputRect,
    sectionToRect,
    options.section_relations,
    options.reading_order
  );

  const sourceManifest = options.sourceManifest || {};
  const manifest = buildExportManifest({
    source_filename: folderName || sourceManifest.source_filename || 'corrected',
    source_width: sourceManifest.source_width ?? (options.sections?.[0]?.source_width),
    source_height: sourceManifest.source_height ?? (options.sections?.[0]?.source_height),
    sections: (options.sections || []).map((s) => ({
      index: s.index,
      output_width_px: s.output_width_px,
      output_height_px: s.output_height_px,
      rotation_degrees: s.rotation_degrees != null ? s.rotation_degrees : 0,
    })),
    sectionToRect,
    straightenResult: options.straightenResult,
    marginPx: options.marginPx ?? 0,
    reading_order: options.reading_order,
    section_relations: options.section_relations,
    layoutDetection,
    edgeAlignment,
    scale: options.scale ?? 1,
    marginColor: options.marginColor ?? '#ffffff',
  });

  return {
    folderName: folderName || 'corrected',
    manifest,
    sectionBlobs,
    compositeBlob: compositeBlob || new Blob(),
  };
}
