/**
 * Node tests for partition (section -> target rect). Run: node tests/test-partition.js
 */
import { partition, partitionWithBuffer, getLayoutRows } from '../js/partition.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${a} === ${b}`);
}

console.log('Testing partition (2 sections in one row)...');

const outputRect = { x: 0, y: 0, width: 180, height: 200 };
const sections = [
  { index: 0, corners: [], centroid_x: 50, centroid_y: 100 },
  { index: 1, corners: [], centroid_x: 140, centroid_y: 100 },
];
const reading_order = [0, 1];
const section_relations = [
  { left_of: [1], right_of: [], above: [], below: [] },
  { left_of: [], right_of: [0], above: [], below: [] },
];

const sectionToRect = partition({
  outputRect,
  sections,
  reading_order,
  section_relations,
});

assertEqual(sectionToRect.size, 2);

const r0 = sectionToRect.get(0);
assert(r0);
assertEqual(r0.y, 0);
assertEqual(r0.width, 90);
assertEqual(r0.height, 200);

const r1 = sectionToRect.get(1);
assert(r1);
assertEqual(r1.y, 0);
assertEqual(r1.width, 90);
assertEqual(r1.height, 200);
assert(r0.x + r1.x === 90, 'one cell at x=0, one at x=90');
assert(r0.width + r1.width === 180);

console.log('Testing getLayoutRows...');
const rows = getLayoutRows(2, section_relations, reading_order);
assertEqual(rows.length, 1);
assertEqual(rows[0].length, 2);
assert(rows[0].includes(0) && rows[0].includes(1), 'row contains both section 0 and 1');

console.log('Testing partition (2x1 vertical)...');
const section_relations_vertical = [
  { left_of: [], right_of: [], above: [], below: [1] },
  { left_of: [], right_of: [], above: [0], below: [] },
];
const sectionToRectV = partition({
  outputRect: { x: 0, y: 0, width: 100, height: 200 },
  sections: [{ index: 0 }, { index: 1 }],
  reading_order: [0, 1],
  section_relations: section_relations_vertical,
});
assertEqual(sectionToRectV.size, 2);
assertEqual(sectionToRectV.get(0).height, 100);
assertEqual(sectionToRectV.get(1).height, 100);
assertEqual(sectionToRectV.get(1).y, 100);

console.log('Testing partitionWithBuffer...');
const buffered = partitionWithBuffer(sectionToRect, 6);
assertEqual(buffered.size, 2);
const b0 = buffered.get(0);
const b1 = buffered.get(1);
assert(b0 && b1);
assertEqual(b0.width, 90 - 6);
assertEqual(b0.height, 200 - 6);
assertEqual(b1.width, 90 - 6);
assertEqual(b1.height, 200 - 6);
assert(b0.y === 3 && b1.y === 3, 'both inset by half buffer');
assert(b0.x + b0.width <= b1.x || b1.x + b1.width <= b0.x, 'sections do not overlap after buffer');
const minX = Math.min(b0.x, b1.x);
const maxX = Math.max(b0.x + b0.width, b1.x + b1.width);
assert(maxX - minX <= 180 && minX >= 0, 'buffered rects span within output width');

console.log('All partition tests passed.');
export default true;
