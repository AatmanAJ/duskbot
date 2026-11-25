const PALETTE_SIZE = 256;
const HISTOGRAM_BITS = 5;
const BINS = 1 << (HISTOGRAM_BITS * 3);

const binOf = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * One palette of at most 256 colours for every frame, by median cut over a
 * 15-bit histogram. `frames` are RGBA byte arrays; alpha is ignored.
 */
export function buildPalette(frames) {
  const count = new Uint32Array(BINS);
  const sumR = new Float64Array(BINS);
  const sumG = new Float64Array(BINS);
  const sumB = new Float64Array(BINS);
  for (const rgba of frames) {
    for (let i = 0; i < rgba.length; i += 4) {
      const bin = binOf(rgba[i], rgba[i + 1], rgba[i + 2]);
      count[bin] += 1;
      sumR[bin] += rgba[i];
      sumG[bin] += rgba[i + 1];
      sumB[bin] += rgba[i + 2];
    }
  }
  const used = [];
  for (let bin = 0; bin < BINS; bin += 1) {
    if (count[bin]) used.push({ r: sumR[bin] / count[bin], g: sumG[bin] / count[bin], b: sumB[bin] / count[bin], n: count[bin] });
  }

  const box = (colors) => {
    const range = { r: [255, 0], g: [255, 0], b: [255, 0] };
    let weight = 0;
    for (const color of colors) {
      weight += color.n;
      for (const channel of ["r", "g", "b"]) {
        if (color[channel] < range[channel][0]) range[channel][0] = color[channel];
        if (color[channel] > range[channel][1]) range[channel][1] = color[channel];
      }
    }
    const spans = { r: range.r[1] - range.r[0], g: range.g[1] - range.g[0], b: range.b[1] - range.b[0] };
    const channel = spans.r >= spans.g && spans.r >= spans.b ? "r" : spans.g >= spans.b ? "g" : "b";
    return { colors, weight, channel, span: spans[channel] };
  };

  const boxes = [box(used)];
  while (boxes.length < PALETTE_SIZE) {
    let pick = -1;
    let score = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const candidate = boxes[i];
      if (candidate.colors.length < 2) continue;
      const candidateScore = candidate.span * Math.sqrt(candidate.weight);
      if (candidateScore > score) { score = candidateScore; pick = i; }
    }
    if (pick === -1) break;
    const { colors, weight, channel } = boxes[pick];
    colors.sort((a, b) => a[channel] - b[channel]);
    let seen = 0;
    let cut = 0;
    while (cut < colors.length - 1 && seen + colors[cut].n <= weight / 2) { seen += colors[cut].n; cut += 1; }
    cut = Math.max(1, cut);
    boxes.splice(pick, 1, box(colors.slice(0, cut)), box(colors.slice(cut)));
  }

  const palette = new Uint8Array(PALETTE_SIZE * 3);
  boxes.forEach(({ colors, weight }, index) => {
    let r = 0; let g = 0; let b = 0;
    for (const color of colors) { r += color.r * color.n; g += color.g * color.n; b += color.b * color.n; }
    palette[index * 3] = Math.round(r / weight);
    palette[index * 3 + 1] = Math.round(g / weight);
    palette[index * 3 + 2] = Math.round(b / weight);
  });
  return { palette, colors: boxes.length };
}

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];
const DITHER_SPREAD = 10;
const clamp = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

/**
 * Maps RGBA frames onto a palette, nearest colour, remembering each histogram
 * bin's answer. An ordered dither hides the steps in soft shadows; it depends
 * only on where a pixel is, so pixels that do not change between frames keep
 * their index.
 */
export function createIndexer({ palette, colors }, width) {
  const cache = new Int16Array(BINS).fill(-1);
  const nearest = (r, g, b) => {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < colors; i += 1) {
      const dr = r - palette[i * 3];
      const dg = g - palette[i * 3 + 1];
      const db = b - palette[i * 3 + 2];
      const distance = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return best;
  };
  return (rgba) => {
    const indexed = new Uint8Array(rgba.length / 4);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
      const nudge = (BAYER[(((p / width) | 0) & 7) * 8 + ((p % width) & 7)] / 64 - 0.5) * DITHER_SPREAD;
      const r = clamp(rgba[i] + nudge);
      const g = clamp(rgba[i + 1] + nudge);
      const b = clamp(rgba[i + 2] + nudge);
      const bin = binOf(r, g, b);
      if (cache[bin] === -1) cache[bin] = nearest(r, g, b);
      indexed[p] = cache[bin];
    }
    return indexed;
  };
}

/** GIF's variable-width LZW over 8-bit indices, already split into data sub-blocks. */
export function lzwEncode(indices) {
  const MIN_CODE_SIZE = 8;
  const CLEAR = 1 << MIN_CODE_SIZE;
  const END = CLEAR + 1;
  const MAX_CODE = 4095;
  const out = [];
  let block = [];
  let buffer = 0;
  let bits = 0;
  const emit = (code, size) => {
    buffer |= code << bits;
    bits += size;
    while (bits >= 8) {
      block.push(buffer & 0xff);
      if (block.length === 255) { out.push(255, ...block); block = []; }
      buffer >>>= 8;
      bits -= 8;
    }
  };

  let table = new Map();
  let codeSize = MIN_CODE_SIZE + 1;
  let next = END + 1;
  emit(CLEAR, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const value = indices[i];
    const key = (prefix << 8) | value;
    const known = table.get(key);
    if (known !== undefined) { prefix = known; continue; }
    emit(prefix, codeSize);
    if (next > MAX_CODE) {
      emit(CLEAR, codeSize);
      table = new Map();
      codeSize = MIN_CODE_SIZE + 1;
      next = END + 1;
    } else {
      table.set(key, next);
      if (next === 1 << codeSize) codeSize += 1;
      next += 1;
    }
    prefix = value;
  }
  emit(prefix, codeSize);
  emit(END, codeSize);
  if (bits > 0) block.push(buffer & 0xff);
  if (block.length) out.push(block.length, ...block);
  out.push(0);
  return { minCodeSize: MIN_CODE_SIZE, bytes: Uint8Array.from(out) };
}

/** The smallest rectangle holding every pixel that differs between two indexed frames; null when they are equal. */
export function changedRect(previous, current, width, height) {
  let top = -1;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (previous[row + x] === current[row + x]) continue;
      if (top === -1) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return top === -1 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

const word = (value) => [value & 0xff, (value >> 8) & 0xff];

/**
 * An endlessly looping GIF89a from RGBA frames of one size. Every frame after
 * the first stores only the rectangle that changed.
 *
 * @param {{ width: number, height: number, frames: Array<{ rgba: Uint8Array | Uint8ClampedArray, delayMs: number }> }} animation
 */
export function encodeGif({ width, height, frames }) {
  const paletteInfo = buildPalette(frames.map((frame) => frame.rgba));
  const index = createIndexer(paletteInfo, width);
  const parts = [];
  const push = (...bytes) => parts.push(Uint8Array.from(bytes));

  push(...[..."GIF89a"].map((char) => char.charCodeAt(0)), ...word(width), ...word(height), 0xf7, 0, 0);
  parts.push(paletteInfo.palette);
  push(0x21, 0xff, 11, ...[..."NETSCAPE2.0"].map((char) => char.charCodeAt(0)), 3, 1, 0, 0, 0);

  let previous = null;
  for (const frame of frames) {
    const indexed = index(frame.rgba);
    const rect = previous ? changedRect(previous, indexed, width, height) ?? { x: 0, y: 0, width: 1, height: 1 } : { x: 0, y: 0, width, height };
    let pixels = indexed;
    if (rect.width !== width || rect.height !== height) {
      pixels = new Uint8Array(rect.width * rect.height);
      for (let y = 0; y < rect.height; y += 1) {
        const start = (rect.y + y) * width + rect.x;
        pixels.set(indexed.subarray(start, start + rect.width), y * rect.width);
      }
    }
    const delay = Math.max(2, Math.round(frame.delayMs / 10));
    push(0x21, 0xf9, 4, 0x04, ...word(delay), 0, 0);
    push(0x2c, ...word(rect.x), ...word(rect.y), ...word(rect.width), ...word(rect.height), 0);
    const { minCodeSize, bytes } = lzwEncode(pixels);
    push(minCodeSize);
    parts.push(bytes);
    previous = indexed;
  }
  push(0x3b);

  const gif = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { gif.set(part, offset); offset += part.length; }
  return gif;
}
