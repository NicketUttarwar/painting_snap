/**
 * Perspective transform: map between a rectangle and a quad using a 3x3 homography.
 * Used for drawing section images into quads and for warp (quad -> rect).
 */

/**
 * Compute 3x3 homography H that maps from source rectangle (0,0)-(sw,sh) to destination quad.
 * Quad has 4 points in order: top-left, top-right, bottom-right, bottom-left (or consistent order).
 * We use the convention: src (0,0)->q0, (sw,0)->q1, (sw,sh)->q2, (0,sh)->q3.
 * @param {number} sw - source width
 * @param {number} sh - source height
 * @param {number[][]} quad - 4 [x,y] destination points
 * @returns {number[]} 9 elements (3x3 row-major), or null if degenerate
 */
export function getPerspectiveTransform(sw, sh, quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const src = [
    [0, 0], [sw, 0], [sw, sh], [0, sh]
  ];
  const dst = quad;
  // Solve for H such that dst_i = H * src_i (homogeneous). 4 points -> 8 equations, 8 unknowns (H is up to scale).
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  // Solve A * h = b for h = [h00, h01, h02, h10, h11, h12, h20, h21], then h22 = 1.
  const h = solve8(A, b);
  if (!h) return null;
  return [
    h[0], h[1], h[2],
    h[3], h[4], h[5],
    h[6], h[7], 1
  ];
}

/**
 * Inverse homography: map from quad to rectangle (0,0)-(sw,sh).
 * So we compute H from rect to quad, then invert.
 */
export function getInversePerspectiveTransform(sw, sh, quad) {
  const H = getPerspectiveTransform(sw, sh, quad);
  if (!H) return null;
  return invert3x3(H);
}

function invert3x3(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    (f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv
  ];
}

function solve8(A, b) {
  // Gaussian elimination for 8x8
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = -1;
    for (let row = col; row < n; row++) {
      if (Math.abs(M[row][col]) > 1e-12) {
        pivot = row;
        break;
      }
    }
    if (pivot === -1) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const scale = M[col][col];
    for (let j = 0; j <= n; j++) M[col][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row !== col && Math.abs(M[row][col]) > 1e-12) {
        const f = M[row][col];
        for (let j = 0; j <= n; j++) M[row][j] -= f * M[col][j];
      }
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Apply homography to point (x,y). Returns [u, v] in source space.
 * (u,v) = (H[0]*x+H[1]*y+H[2])/(H[6]*x+H[7]*y+H[8]), (H[3]*x+H[4]*y+H[5])/(...)
 */
export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-10) return [NaN, NaN];
  return [
    (H[0] * x + H[1] * y + H[2]) / w,
    (H[3] * x + H[4] * y + H[5]) / w
  ];
}

/**
 * Bilinear sample from ImageData at (x, y). x,y can be fractional.
 * @param {ImageData} data
 * @param {number} x
 * @param {number} y
 * @returns {[number,number,number,number]} rgba
 */
export function sampleBilinear(data, x, y) {
  const w = data.width;
  const h = data.height;
  const ix = Math.max(0, Math.min(w - 1.001, x));
  const iy = Math.max(0, Math.min(h - 1.001, y));
  const i0 = Math.floor(ix);
  const j0 = Math.floor(iy);
  const i1 = Math.min(i0 + 1, w - 1);
  const j1 = Math.min(j0 + 1, h - 1);
  const fx = ix - i0;
  const fy = iy - j0;

  const get = (i, j) => {
    const idx = (j * w + i) * 4;
    return [data.data[idx], data.data[idx + 1], data.data[idx + 2], data.data[idx + 3]];
  };

  const c00 = get(i0, j0);
  const c10 = get(i1, j0);
  const c01 = get(i0, j1);
  const c11 = get(i1, j1);

  return [
    (1 - fx) * (1 - fy) * c00[0] + fx * (1 - fy) * c10[0] + (1 - fx) * fy * c01[0] + fx * fy * c11[0],
    (1 - fx) * (1 - fy) * c00[1] + fx * (1 - fy) * c10[1] + (1 - fx) * fy * c01[1] + fx * fy * c11[1],
    (1 - fx) * (1 - fy) * c00[2] + fx * (1 - fy) * c10[2] + (1 - fx) * fy * c01[2] + fx * fy * c11[2],
    (1 - fx) * (1 - fy) * c00[3] + fx * (1 - fy) * c10[3] + (1 - fx) * fy * c01[3] + fx * fy * c11[3],
  ];
}

/**
 * Point-in-polygon (quad). Polygon is 4 [x,y] points.
 */
export function pointInQuad(quad, px, py) {
  const [a, b, c, d] = quad;
  const pts = [a, b, c, d];
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
