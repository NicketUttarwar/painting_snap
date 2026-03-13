/**
 * Node tests for manifest parsing and geometry. Run: node tests/test-manifest.js
 * (Requires package.json "type": "module".)
 */
import { parseManifest, getEditorBounds, getOuterBoundaryPolygon, stretchSectionsToRectangles } from '../js/manifest.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${a} === ${b}`);
}

function assertApprox(a, b, tol, message) {
  if (Math.abs(a - b) > (tol || 1e-6)) throw new Error(message || `Expected ${a} ≈ ${b}`);
}

console.log('Testing parseManifest...');

const raw = {
  source_filename: 'test.jpeg',
  source_width: 2592,
  source_height: 4608,
  sections: [
    {
      index: 0,
      filename: 'section-0.png',
      bounds: { x: 0, y: 0, width: 100, height: 200 },
      corners: [[0, 0], [100, 0], [100, 200], [0, 200]],
      output_width_px: 100,
      output_height_px: 200,
      centroid_x: 50,
      centroid_y: 100,
      rotation_degrees: 0,
    },
    {
      index: 1,
      filename: 'section-1.png',
      bounds: { x: 100, y: 0, width: 80, height: 200 },
      corners: [[100, 0], [180, 0], [180, 200], [100, 200]],
      output_width_px: 80,
      output_height_px: 200,
      centroid_x: 140,
      centroid_y: 100,
      rotation_degrees: 90,
    },
  ],
  layout: {
    reading_order: [0, 1],
    section_relations: [
      { left_of: [1], right_of: [], above: [], below: [] },
      { left_of: [], right_of: [0], above: [], below: [] },
    ],
  },
};

const parsed = parseManifest(raw);
assertEqual(parsed.sections.length, 2);
assertEqual(parsed.sections[0].corners.length, 4);
assertEqual(parsed.sections[0].corners[0][0], 0);
assertEqual(parsed.sections[0].corners[2][1], 200);
assertEqual(parsed.sections[1].rotation_degrees, 90);
assertEqual(parsed.source_width, 2592);
assertEqual(parsed.layout.reading_order[0], 0);
assertEqual(parsed.layout.section_relations[0].left_of[0], 1);

console.log('Testing getEditorBounds...');
const bounds = getEditorBounds(parsed.sections);
assertEqual(bounds.minX, 0);
assertEqual(bounds.minY, 0);
assertEqual(bounds.maxX, 180);
assertEqual(bounds.maxY, 200);
assertEqual(bounds.width, 180);
assertEqual(bounds.height, 200);

console.log('Testing getOuterBoundaryPolygon (convex hull)...');
const polygon = getOuterBoundaryPolygon(parsed.sections);
assert(polygon.length >= 3 && polygon.length <= 8);
const xs = polygon.map((p) => p[0]);
const ys = polygon.map((p) => p[1]);
assertEqual(Math.min(...xs), 0);
assertEqual(Math.max(...xs), 180);
assertEqual(Math.min(...ys), 0);
assertEqual(Math.max(...ys), 200);

console.log('Testing stretchSectionsToRectangles (mutates corners to axis-aligned)...');
const sectionsCopy = parsed.sections.map((s) => ({ ...s, corners: s.corners.map((c) => [c[0], c[1]]) }));
stretchSectionsToRectangles(sectionsCopy);
assertEqual(sectionsCopy[0].corners[0][0], 0);
assertEqual(sectionsCopy[0].corners[1][0], 100);
assertEqual(sectionsCopy[0].corners[2][1], 200);

console.log('Testing parseManifest with missing corners (empty array)...');
const rawNoCorners = { ...raw, sections: raw.sections.map((s) => ({ ...s, corners: undefined })) };
const parsedNoCorners = parseManifest(rawNoCorners);
assertEqual(parsedNoCorners.sections[0].corners.length, 0);

console.log('Testing parseManifest with export-style manifest (output_rect, composite_*, corners)...');
const exportStyle = {
  source_filename: 'corrected-folder',
  source_width: 220,
  source_height: 240,
  composite_filename: 'composite.png',
  composite_width: 220,
  composite_height: 240,
  margin_px: 20,
  output_rect: { x: 10, y: 10, width: 200, height: 200 },
  sections: [
    {
      index: 0,
      filename: 'section-0.png',
      bounds: { x: 20, y: 20, width: 100, height: 200 },
      corners: [[20, 20], [120, 20], [120, 220], [20, 220]],
      centroid_x: 70,
      centroid_y: 120,
      rotation_degrees: 0,
      output_width_px: 100,
      output_height_px: 200,
    },
  ],
  layout: { reading_order: [0], section_relations: [{ left_of: [], right_of: [], above: [], below: [] }] },
};
const parsedExport = parseManifest(exportStyle);
assertEqual(parsedExport.sections.length, 1);
assertEqual(parsedExport.sections[0].corners.length, 4);
assertEqual(parsedExport.sections[0].centroid_x, 70);
assertEqual(parsedExport.source_width, 220);
const boundsExport = getEditorBounds(parsedExport.sections);
assertEqual(boundsExport.width, 100);
assertEqual(boundsExport.height, 200);

console.log('All manifest tests passed.');
export default true;
