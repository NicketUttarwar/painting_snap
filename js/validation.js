/**
 * Validation: distortion warnings, orphan/coverage checks.
 * Helps ensure the recreated painting is not distorted and every section has a cell.
 */

import { partition } from './partition.js';

/**
 * Compute approximate aspect ratio change (source quad to target cell).
 * Returns ratio (target aspect / source aspect). 1 = no change; >1 = stretched horizontally; <1 = stretched vertically.
 * @param {number[][]} corners - 4 [x,y] in editor space
 * @param {{ width: number, height: number }} targetRect
 * @returns {{ ratio: number, sourceAspect: number, targetAspect: number, warning: string|null }}
 */
export function aspectChange(corners, targetRect) {
  if (corners.length < 4 || !targetRect?.width || !targetRect?.height) {
    return { ratio: 1, sourceAspect: 1, targetAspect: 1, warning: null };
  }

  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const w = Math.max(0.01, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(0.01, Math.max(...ys) - Math.min(...ys));
  const sourceAspect = w / h;
  const targetAspect = targetRect.width / targetRect.height;
  const ratio = targetAspect / sourceAspect;

  let warning = null;
  if (ratio > 1.5 || ratio < 1 / 1.5) {
    warning = `Section aspect change ${ratio.toFixed(2)}x (may look stretched/squashed)`;
  }
  return { ratio, sourceAspect, targetAspect, warning };
}

/**
 * Run validation after straighten and partition.
 * @param {object} options
 * @param {Array<{ index: number, corners: number[][] }>} options.sections
 * @param {object} options.straightenResult - { outputRect }
 * @param {number[]} options.reading_order
 * @param {object} options.section_relations
 * @returns {{ distortionWarnings: string[], orphanSections: number[], unusedCells: boolean, ok: boolean }}
 */
export function validate({ sections, straightenResult, reading_order, section_relations }) {
  const distortionWarnings = [];
  const orphanSections = [];
  let unusedCells = false;

  const contentRect = straightenResult?.outputRect;
  if (!contentRect) {
    return { distortionWarnings: [], orphanSections: sections.map((s) => s.index), unusedCells: false, ok: false };
  }

  const sectionToRect = partition({
    outputRect: contentRect,
    sections,
    reading_order: reading_order || sections.map((s) => s.index),
    section_relations,
  });

  for (const section of sections) {
    const rect = sectionToRect.get(section.index);
    if (!rect) {
      orphanSections.push(section.index);
      continue;
    }
    const { warning } = aspectChange(section.corners, rect);
    if (warning) distortionWarnings.push(`Section ${section.index}: ${warning}`);
  }

  const assigned = new Set(sectionToRect.keys());
  const expected = new Set(sections.map((s) => s.index));
  if (sectionToRect.size > 0 && assigned.size !== expected.size) {
    unusedCells = true;
  }

  const ok = orphanSections.length === 0 && distortionWarnings.length === 0;
  return {
    distortionWarnings,
    orphanSections,
    unusedCells,
    ok,
  };
}
