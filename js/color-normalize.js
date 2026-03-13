/**
 * Cross-section color / exposure normalization.
 * Match appearance across sections so the whole painting looks like one piece.
 */

/**
 * Get ImageData from a section image (draw to offscreen canvas).
 * @param {HTMLImageElement} img
 * @returns {ImageData|null}
 */
function getImageData(img) {
  if (!img?.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * Compute mean and std per channel (R, G, B) for an ImageData (optionally only in a border band).
 * @param {ImageData} data
 * @param {number} [bandPx=0] - if > 0, only sample pixels within bandPx of the edge
 * @returns {{ mean: number[], std: number[] }}
 */
function stats(data, bandPx = 0) {
  const w = data.width;
  const h = data.height;
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  let n = 0;

  const inBand = (x, y) => {
    if (bandPx <= 0) return true;
    return x < bandPx || x >= w - bandPx || y < bandPx || y >= h - bandPx;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBand(x, y)) continue;
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = data.data[idx + c];
        sum[c] += v;
        sumSq[c] += v * v;
      }
      n++;
    }
  }

  if (n === 0) return { mean: [128, 128, 128], std: [1, 1, 1] };

  const mean = sum.map((s) => s / n);
  const std = sumSq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c] * mean[c])) || 1);
  return { mean, std };
}

/**
 * Apply per-channel linear transform to match target mean and std: out = (x - mean) * (targetStd / std) + targetMean.
 * @param {ImageData} data - modified in place
 * @param {number[]} srcMean
 * @param {number[]} srcStd
 * @param {number[]} targetMean
 * @param {number[]} targetStd
 */
function matchStats(data, srcMean, srcStd, targetMean, targetStd) {
  for (let i = 0; i < data.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data.data[i + c];
      const scaled = srcStd[c] > 0.01
        ? (v - srcMean[c]) * (targetStd[c] / srcStd[c]) + targetMean[c]
        : targetMean[c];
      data.data[i + c] = Math.max(0, Math.min(255, Math.round(scaled)));
    }
  }
}

/**
 * Normalize section images so the first section is the reference; others are matched to it by mean/std in border band.
 * Modifies section images by drawing into a new canvas and replacing the image source (or returns new ImageData/canvas).
 * We return a list of { index, image } where image is an HTMLImageElement with the normalized pixel data.
 * @param {Array<{ index: number, image?: HTMLImageElement }>} sections
 * @param {number} [borderBandPx=20] - use pixels within this many px of the edge for stats (overlap regions)
 * @returns {Promise<HTMLImageElement[]>} - normalized images in section order (to be used as section.image for export)
 */
export async function normalizeSectionsToReference(sections, borderBandPx = 20) {
  const withImage = sections.filter((s) => s.image);
  if (withImage.length === 0) return sections.map((s) => s.image);

  const first = withImage[0];
  const firstData = getImageData(first.image);
  if (!firstData) return sections.map((s) => s.image);

  const refStats = stats(firstData, borderBandPx);
  const result = [];

  for (const section of sections) {
    if (!section.image) {
      result.push(section.image);
      continue;
    }
    const data = getImageData(section.image);
    if (!data) {
      result.push(section.image);
      continue;
    }
    const s = stats(data, borderBandPx);
    matchStats(data, s.mean, s.std, refStats.mean, refStats.std);

    const c = document.createElement('canvas');
    c.width = data.width;
    c.height = data.height;
    c.getContext('2d').putImageData(data, 0, 0);

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = c.toDataURL('image/png');
    });
    result.push(img);
  }

  return result;
}

/**
 * Apply normalization to section images in-place by creating new Image elements and replacing state.
 * Call after load; then use the returned images for display and export.
 * @param {Array<{ index: number, image?: HTMLImageElement }>} sections
 * @param {number} [borderBandPx=20]
 * @returns {Promise<Array<{ index: number, image?: HTMLImageElement }>>} sections with .image replaced by normalized
 */
export async function normalizeSectionsInPlace(sections, borderBandPx = 20) {
  const normalized = await normalizeSectionsToReference(sections, borderBandPx);
  return sections.map((s, i) => ({
    ...s,
    image: normalized[i] || s.image,
  }));
}
