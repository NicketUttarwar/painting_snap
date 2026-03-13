/**
 * Node tests for straighten (rectilinearize boundary). Run: node tests/test-straighten.js
 */
import { straighten } from '../js/straighten.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${a} === ${b}`);
}

console.log('Testing straighten with simple quad...');

const quad = [
  [0, 0],
  [100, 0],
  [100, 80],
  [0, 80],
];

const result = straighten({
  outerPolygon: quad,
  sections: [],
  section_relations: [],
});

assert(result.outputRect);
assertEqual(result.outputRect.x, 0);
assertEqual(result.outputRect.y, 0);
assertEqual(result.outputRect.width, 100);
assertEqual(result.outputRect.height, 80);

assert(result.grid && result.grid.xLines && result.grid.yLines);
assert(result.grid.xLines.length >= 2);
assert(result.grid.yLines.length >= 2);
assert(result.rectilinearPolygon);
assert(result.rectilinearPolygon.length >= 4);

console.log('Testing straighten with L-shaped polygon...');

const lShape = [
  [0, 0],
  [60, 0],
  [60, 30],
  [100, 30],
  [100, 80],
  [0, 80],
];

const result2 = straighten({
  outerPolygon: lShape,
  sections: [],
  section_relations: [],
});

assert(result2.outputRect);
assertEqual(result2.outputRect.width, 100);
assertEqual(result2.outputRect.height, 80);
assert(result2.rectilinearPolygon.length >= 4);

console.log('Testing straighten with too few vertices...');

const small = straighten({
  outerPolygon: [[0, 0], [1, 0]],
  sections: [],
  section_relations: [],
});
assert(small.outputRect);
assert(small.grid.xLines.length >= 2);

console.log('All straighten tests passed.');
export default true;
