/**
 * One-click image optimizations: auto contrast, auto white balance, sharpen.
 * Apply to all section images (in place, like color normalize).
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

function imageDataToImage(data) {
  const c = document.createElement('canvas');
  c.width = data.width;
  c.height = data.height;
  c.getContext('2d').putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Apply a processor (ImageData -> void, mutates) to each section and return new images.
 * @param {Array<{ index: number, image?: HTMLImageElement }>} sections
 * @param {(data: ImageData) => void} process
 * @returns {Promise<HTMLImageElement[]>}
 */
async function applyToSections(sections, process) {
  const result = [];
  for (const section of sections) {
    if (!section.image) {
      result.push(null);
      continue;
    }
    const data = getImageData(section.image);
    if (!data) {
      result.push(section.image);
      continue;
    }
    process(data);
    const url = imageDataToImage(data);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    result.push(img);
  }
  return result;
}

/**
 * Auto contrast: stretch histogram so percentile range maps to 0–255.
 * @param {ImageData} data - modified in place
 * @param {number} [lowPct=2]
 * @param {number} [highPct=98]
 */
function autoContrast(data, lowPct = 2, highPct = 98) {
  const hist = new Array(256).fill(0);
  const w = data.width;
  const h = data.height;
  for (let i = 0; i < w * h; i++) {
    const r = data.data[i * 4];
    const g = data.data[i * 4 + 1];
    const b = data.data[i * 4 + 2];
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[Math.max(0, Math.min(255, lum))]++;
  }
  const total = w * h;
  let sum = 0;
  let low = 0;
  let high = 255;
  for (let i = 0; i < 256; i++) {
    sum += hist[i];
    if (sum >= total * (lowPct / 100) && low === 0) low = i;
    if (sum >= total * (highPct / 100)) {
      high = i;
      break;
    }
  }
  const span = Math.max(1, high - low);
  for (let i = 0; i < data.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data.data[i + c];
      const stretched = ((v - low) / span) * 255;
      data.data[i + c] = Math.max(0, Math.min(255, Math.round(stretched)));
    }
  }
}

/**
 * Auto white balance (gray-world): scale R,G,B so mean is neutral gray.
 * @param {ImageData} data - modified in place
 */
function autoWhiteBalance(data) {
  let rSum = 0, gSum = 0, bSum = 0;
  const n = data.width * data.height;
  for (let i = 0; i < data.data.length; i += 4) {
    rSum += data.data[i];
    gSum += data.data[i + 1];
    bSum += data.data[i + 2];
  }
  const rMean = rSum / n;
  const gMean = gSum / n;
  const bMean = bSum / n;
  const gray = (rMean + gMean + bMean) / 3;
  const rScale = gray / (rMean || 1);
  const gScale = gray / (gMean || 1);
  const bScale = gray / (bMean || 1);
  const maxScale = Math.max(rScale, gScale, bScale);
  if (maxScale > 3) {
    const f = 3 / maxScale;
    rScale *= f;
    gScale *= f;
    bScale *= f;
  }
  for (let i = 0; i < data.data.length; i += 4) {
    data.data[i] = Math.max(0, Math.min(255, Math.round(data.data[i] * rScale)));
    data.data[i + 1] = Math.max(0, Math.min(255, Math.round(data.data[i + 1] * gScale)));
    data.data[i + 2] = Math.max(0, Math.min(255, Math.round(data.data[i + 2] * bScale)));
  }
}

/**
 * Light sharpen (unsharp mask): detail = src - blur, out = src + amount * detail.
 * @param {ImageData} data - modified in place
 * @param {number} [radius=1] - blur radius (1 = 3x3)
 * @param {number} [amount=0.6]
 */
function sharpen(data, radius = 1, amount = 0.6) {
  const w = data.width;
  const h = data.height;
  const src = new Uint8ClampedArray(data.data);
  const r = Math.max(0, Math.min(2, radius));
  const size = (2 * r + 1) ** 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0, gSum = 0, bSum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const i = (ny * w + nx) * 4;
            rSum += src[i];
            gSum += src[i + 1];
            bSum += src[i + 2];
            count++;
          }
        }
      }
      const i = (y * w + x) * 4;
      const br = rSum / count;
      const bg = gSum / count;
      const bb = bSum / count;
      data.data[i] = Math.max(0, Math.min(255, Math.round(src[i] + amount * (src[i] - br))));
      data.data[i + 1] = Math.max(0, Math.min(255, Math.round(src[i + 1] + amount * (src[i + 1] - bg))));
      data.data[i + 2] = Math.max(0, Math.min(255, Math.round(src[i + 2] + amount * (src[i + 2] - bb))));
    }
  }
}

/**
 * Auto contrast on all sections. Mutates and replaces section images.
 */
export async function autoContrastSectionsInPlace(sections) {
  const images = await applyToSections(sections, (d) => autoContrast(d));
  return sections.map((s, i) => ({ ...s, image: images[i] || s.image }));
}

/**
 * Auto white balance on all sections.
 */
export async function autoWhiteBalanceSectionsInPlace(sections) {
  const images = await applyToSections(sections, (d) => autoWhiteBalance(d));
  return sections.map((s, i) => ({ ...s, image: images[i] || s.image }));
}

/**
 * Light sharpen on all sections.
 */
export async function sharpenSectionsInPlace(sections, radius = 1, amount = 0.6) {
  const images = await applyToSections(sections, (d) => sharpen(d, radius, amount));
  return sections.map((s, i) => ({ ...s, image: images[i] || s.image }));
}

/**
 * One-click auto optimize: contrast + white balance + light sharpen.
 */
export async function autoOptimizeSectionsInPlace(sections, options = {}) {
  const { contrast = true, whiteBalance = true, sharpen: doSharpen = true, sharpenAmount = 0.5 } = options;
  let out = sections;
  if (contrast) {
    const imgs = await applyToSections(out, (d) => autoContrast(d));
    out = out.map((s, i) => ({ ...s, image: imgs[i] || s.image }));
  }
  if (whiteBalance) {
    const imgs = await applyToSections(out, (d) => autoWhiteBalance(d));
    out = out.map((s, i) => ({ ...s, image: imgs[i] || s.image }));
  }
  if (doSharpen) {
    const imgs = await applyToSections(out, (d) => sharpen(d, 1, sharpenAmount));
    out = out.map((s, i) => ({ ...s, image: imgs[i] || s.image }));
  }
  return out;
}
