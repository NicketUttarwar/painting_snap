/**
 * Crude orientation detection: compare each section image with its region in the composite
 * at 0°, 90°, 180°, 270° and set section.rotation_degrees to the best match.
 * Result is persisted in manifest as rotation_degrees (always included on save).
 */

import { partition } from './partition.js';

const SAMPLE_SIZE = 24;

/**
 * Draw image (or section image) into a small canvas, optionally rotated.
 * @param {HTMLImageElement} img
 * @param {number} rotDeg - 0, 90, 180, 270
 * @returns {ImageData} grayscale-ish sample at SAMPLE_SIZE x SAMPLE_SIZE
 */
function sampleImageAtRotation(img, rotDeg) {
  const s = SAMPLE_SIZE;
  const canvas = document.createElement('canvas');
  if (rotDeg === 90 || rotDeg === 270) {
    canvas.width = s;
    canvas.height = s;
  } else {
    canvas.width = s;
    canvas.height = s;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.translate(-s / 2, -s / 2);
  ctx.drawImage(img, 0, 0, w, h, 0, 0, s, s);
  ctx.restore();

  const data = ctx.getImageData(0, 0, s, s);
  return data;
}

/**
 * Extract region from composite as ImageData (downsampled to SAMPLE_SIZE).
 * @param {HTMLImageElement} composite
 * @param {{ x: number, y: number, width: number, height: number }} rect - in composite pixel coords
 * @returns {ImageData|null}
 */
function sampleCompositeRegion(composite, rect) {
  const s = SAMPLE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const { x, y, width, height } = rect;
  if (width < 1 || height < 1) return null;
  ctx.drawImage(composite, x, y, width, height, 0, 0, s, s);
  return ctx.getImageData(0, 0, s, s);
}

/**
 * Mean absolute difference between two ImageData (grayscale); lower = more similar.
 * @param {ImageData} a
 * @param {ImageData} b
 * @returns {number}
 */
function imageDiff(a, b) {
  if (!a || !b || a.data.length !== b.data.length) return Infinity;
  let sum = 0;
  const n = (a.width * a.height) | 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const ga = 0.299 * a.data[j] + 0.587 * a.data[j + 1] + 0.114 * a.data[j + 2];
    const gb = 0.299 * b.data[j] + 0.587 * b.data[j + 1] + 0.114 * b.data[j + 2];
    sum += Math.abs(ga - gb);
  }
  return sum / n;
}

/**
 * Detect orientation for each section by comparing section image at 0/90/180/270
 * with the corresponding region in the composite. Mutates sections[].rotation_degrees.
 * @param {Array<{ index: number, image?: HTMLImageElement, output_width_px?: number, output_height_px?: number, rotation_degrees?: number }>} sections
 * @param {HTMLImageElement} compositeImage
 * @param {{ layout?: { reading_order?: number[], section_relations?: Array<{ left_of: number[], right_of: number[], above: number[], below: number[] }> } }} manifest
 */
export function detectSectionOrientationsFromComposite(sections, compositeImage, manifest) {
  if (!compositeImage || !sections?.length) return;

  const reading_order = manifest?.layout?.reading_order ?? sections.map((s) => s.index);
  const section_relations = manifest?.layout?.section_relations ?? sections.map(() => ({ left_of: [], right_of: [], above: [], below: [] }));

  const outputRect = {
    x: 0,
    y: 0,
    width: compositeImage.naturalWidth,
    height: compositeImage.naturalHeight,
  };

  const sectionToRect = partition({
    outputRect,
    sections,
    reading_order,
    section_relations,
  });

  const rotations = [0, 90, 180, 270];

  for (const section of sections) {
    const rect = sectionToRect.get(section.index);
    if (!rect || rect.width < 2 || rect.height < 2) continue;
    const img = section.image;
    if (!img || !img.naturalWidth || !img.naturalHeight) continue;

    const compositeSample = sampleCompositeRegion(compositeImage, rect);
    if (!compositeSample) continue;

    let bestDeg = typeof section.rotation_degrees === 'number' ? section.rotation_degrees : 0;
    let bestDiff = Infinity;

    for (const deg of rotations) {
      const sectionSample = sampleImageAtRotation(img, deg);
      if (!sectionSample) continue;
      const d = imageDiff(compositeSample, sectionSample);
      if (d < bestDiff) {
        bestDiff = d;
        bestDeg = deg;
      }
    }

    section.rotation_degrees = bestDeg;
  }
}
