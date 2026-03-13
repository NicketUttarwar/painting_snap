/**
 * Load and parse manifest; map source corners to editor space.
 * Editor space = source image space (source_width x source_height).
 * We use the same coordinate system so section quads are positioned by manifest corners.
 */

/**
 * @typedef {Object} Section
 * @property {number} index
 * @property {string} filename
 * @property {{ x: number, y: number, width: number, height: number }} bounds
 * @property {number[][]} corners - 4 [x,y] in source space
 * @property {number} output_width_px
 * @property {number} output_height_px
 * @property {number} centroid_x
 * @property {number} centroid_y
 * @property {number} [rotation_degrees] - orientation (0, 90, 180, 270); from composite detection or manifest, always saved
 * @property {HTMLImageElement} [image] - loaded Image
 */

/**
 * @typedef {Object} Layout
 * @property {number[]} reading_order
 * @property {Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }>} section_relations
 */

/**
 * @typedef {Object} ManifestData
 * @property {string} source_filename
 * @property {number} source_width
 * @property {number} source_height
 * @property {Section[]} sections
 * @property {Layout} layout
 */

/**
 * Parse manifest JSON into typed structure.
 * @param {object} raw - Parsed JSON
 * @returns {ManifestData}
 */
export function parseManifest(raw) {
  const sections = (raw.sections || []).map((s) => ({
    index: s.index,
    filename: s.filename,
    bounds: s.bounds || { x: 0, y: 0, width: 0, height: 0 },
    corners: Array.isArray(s.corners) ? s.corners.map((c) => [Number(c[0]), Number(c[1])]) : [],
    output_width_px: Number(s.output_width_px) || 0,
    output_height_px: Number(s.output_height_px) || 0,
    centroid_x: Number(s.centroid_x) ?? 0,
    centroid_y: Number(s.centroid_y) ?? 0,
    rotation_degrees: Number(s.rotation_degrees) || 0,
  }));

  const layout = raw.layout || {};
  return {
    source_filename: raw.source_filename || '',
    source_width: Number(raw.source_width) || 2592,
    source_height: Number(raw.source_height) || 4608,
    sections,
    layout: {
      reading_order: layout.reading_order || sections.map((s) => s.index),
      section_relations: layout.section_relations || sections.map(() => ({ left_of: [], right_of: [], above: [], below: [] })),
    },
  };
}

/**
 * Load manifest from a File or from path (when using FileSystemFileHandle).
 * @param {File|Promise<File>} fileOrPromise - manifest.json as File or promise of File
 * @returns {Promise<ManifestData>}
 */
export async function loadManifest(fileOrPromise) {
  const file = fileOrPromise instanceof File ? fileOrPromise : await fileOrPromise;
  const text = await file.text();
  const raw = JSON.parse(text);
  return parseManifest(raw);
}

/**
 * Stretch each section's quad into its axis-aligned bounding box so every section is a perfect
 * rectangle (highest point = top, widest = width, all edges H/V). Applied on import so corner
 * selection and boundary logic see aligned rectangles.
 * Mutates each section's .corners in place.
 * @param {Section[]} sections
 */
export function stretchSectionsToRectangles(sections) {
  for (const section of sections) {
    if (!section.corners || section.corners.length !== 4) continue;
    const xs = section.corners.map((c) => c[0]);
    const ys = section.corners.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    section.corners = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
  }
}

/**
 * Load all section images given a manifest and a function that returns a File for a filename.
 * @param {ManifestData} manifest
 * @param {(filename: string) => Promise<File|null>} getFile - e.g. (name) => folder.getFile(name)
 * @returns {Promise<Section[]>} Sections with .image set
 */
export async function loadSectionImages(manifest, getFile) {
  const sections = manifest.sections.map((s) => ({ ...s }));

  for (const section of sections) {
    const file = await getFile(section.filename);
    if (!file) {
      section.image = null;
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      section.image = await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return sections;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Get axis-aligned bounding box of all section corners in editor (source) space.
 * @param {Section[]} sections
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }}
 */
export function getEditorBounds(sections) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const s of sections) {
    for (const [x, y] of s.corners) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (minX === Infinity) {
    minX = maxX = minY = maxY = 0;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Get outer boundary polygon (convex hull or simple envelope) of all section corners in editor space.
 * Returns ordered list of [x,y] vertices. For simplicity we use the convex hull of all corners.
 * @param {Section[]} sections
 * @returns {number[][]}
 */
export function getOuterBoundaryPolygon(sections) {
  const points = [];
  for (const s of sections) {
    for (const c of s.corners) {
      points.push([c[0], c[1]]);
    }
  }
  return convexHull(points);
}

/**
 * Convex hull (Graham scan) - returns vertices in counter-clockwise order.
 * @param {number[][]} points
 * @returns {number[][]}
 */
function convexHull(points) {
  if (points.length < 3) return [...points];

  const pivot = points.reduce((min, p) => (p[1] < min[1] || (p[1] === min[1] && p[0] < min[0]) ? p : min), points[0]);
  const sorted = points
    .filter((p) => p !== pivot)
    .map((p) => ({ p, angle: Math.atan2(p[1] - pivot[1], p[0] - pivot[0]), dist: (p[0] - pivot[0]) ** 2 + (p[1] - pivot[1]) ** 2 }))
    .sort((a, b) => a.angle - b.angle || a.dist - b.dist)
    .map((x) => x.p);

  const stack = [pivot, sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) {
      stack.pop();
    }
    stack.push(p);
  }

  return stack;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
