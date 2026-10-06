/**
 * The fridge-door texture: a light warm-grey, finely pebbled / leathery surface, generated
 * procedurally ONCE at startup and used as a seamless tile, in two tones: the board's and the tray's (darker).
 *
 * `texturePixels` is pure (no DOM): tileable Worley creases (two octaves) plus a soft value-noise
 * undulation form a height field, which is embossed with a light from the top-left. The canvas
 * wrapper turns the pixels into a JPEG data URL that the board (an SVG <pattern> in BOARD space)
 * and the exports both use. No SVG filters anywhere.
 */

/**
 * The BOARD's base tone. v0.4.0 lightened it from rgb(208,206,203) to roughly halve the gap to the negative shapes
 * (#e6e7e8), so they read as white magnets on a light door with less (but still clearly visible) contrast. v1.4.1 halved the gap again, to rgb(223,222,219).
 */
export const TEXTURE_BASE: readonly [number, number, number] = [223, 222, 219];
/** The TRAY's base tone: the original reference tone (mean of empty texture, ~rgb(197,195,192)), unchanged in v0.4.0. */
export const TRAY_TEXTURE_BASE: readonly [number, number, number] = [208, 206, 203];
/** Texels per tile side. */
export const TEXTURE_PX = 640;
/** Board units one tile covers (1 board unit = 1 source-SVG unit; a positive stem is ~439 long). */
export const TEXTURE_UNITS = 1024;

export interface TextureOptions {
  size: number;
  /** Crease cells per tile side for the coarse and fine octaves, [x, y] (integers, so the tile wraps).
   * Unequal counts stretch the cells into wrinkles. */
  coarse: readonly [number, number];
  fine: readonly [number, number];
  /** Weight of the fine octave. */
  fineWeight: number;
  /** Width of the crease falloff in cell units: small = sharp crack lines, large = rounded pebbles. */
  edge: number;
  /** Value-noise cells per tile side (soft large-scale undulation). */
  swell: number;
  /** Domain warp: cells per tile side and amplitude in texels (breaks the cell regularity into wrinkles). */
  warpCells: number;
  warp: number;
  /** Target luminance standard deviation (the reference measures ~7 on a 0-255 scale). */
  contrast: number;
  seed: number;
}

export const DEFAULT_TEXTURE: TextureOptions = { size: TEXTURE_PX, coarse: [34, 50], fine: [80, 110], fineWeight: 0.5, edge: 0.9, swell: 6, warpCells: 14, warp: 12, contrast: 5.5, seed: 7 };

function hash(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (n: number, m: number) => ((n % m) + m) % m;

/** Feature points of a tileable Worley grid (gx x gy cells, one jittered point per cell). */
function features(gx: number, gy: number, seed: number) {
  const fx = new Float32Array(gx * gy), fy = new Float32Array(gx * gy);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      fx[j * gx + i] = 0.15 + 0.7 * hash(i, j, seed);
      fy[j * gx + i] = 0.15 + 0.7 * hash(i, j, seed + 101);
    }
  }
  return { gx, gy, fx, fy };
}

/** Tileable Worley: F2 - F1 (0 on a cell border, a crease) for point (u, v) in cell units. */
function crease(u: number, v: number, f: ReturnType<typeof features>): number {
  const ci = Math.floor(u), cj = Math.floor(v);
  const { gx, gy, fx, fy } = f;
  let f1 = 9, f2 = 9;
  for (let dj = -1; dj <= 1; dj++) {
    const j = cj + dj;
    const row = wrap(j, gy) * gx;
    for (let di = -1; di <= 1; di++) {
      const i = ci + di;
      const k = row + wrap(i, gx);
      const ex = i + fx[k] - u, ey = j + fy[k] - v;
      const d = ex * ex + ey * ey;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  }
  return Math.sqrt(f2) - Math.sqrt(f1);
}

/** Tileable value noise sampled on a whole tile at once (g x g lattice), returned per texel. */
function valueField(n: number, g: number, seed: number): Float32Array {
  const lat = new Float32Array(g * g);
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) lat[j * g + i] = hash(i, j, seed);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const v = (y * g) / n, j = Math.floor(v), fy = v - j, sy = fy * fy * (3 - 2 * fy);
    const r0 = (j % g) * g, r1 = ((j + 1) % g) * g;
    for (let x = 0; x < n; x++) {
      const u = (x * g) / n, i = Math.floor(u), fx = u - i, sx = fx * fx * (3 - 2 * fx);
      const i0 = i % g, i1 = (i + 1) % g;
      const a = lat[r0 + i0], b = lat[r0 + i1], c = lat[r1 + i0], d = lat[r1 + i1];
      out[y * n + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

/** RGBA pixels of one seamless tile, `size` x `size`, around the given base tone. */
export function texturePixels(o: TextureOptions = DEFAULT_TEXTURE, base: readonly [number, number, number] = TEXTURE_BASE): Uint8ClampedArray {
  return colourise(textureShade(o), base);
}

/** The tile's luminance offsets (one per texel, mean ~0): the texture's character, independent of its base tone. */
export function textureShade(o: TextureOptions = DEFAULT_TEXTURE): Float32Array {
  const n = o.size;
  const h = new Float32Array(n * n);
  const [cx, cy] = o.coarse, [fx, fy] = o.fine;
  const coarse = features(cx, cy, o.seed), fine = features(fx, fy, o.seed + 7);
  const warpX = valueField(n, o.warpCells, o.seed + 41), warpY = valueField(n, o.warpCells, o.seed + 43);
  const swell = valueField(n, o.swell, o.seed + 13);
  const e1 = 1 / o.edge, e2 = 1 / (o.edge * 0.85);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const wx = x + o.warp * (warpX[i] - 0.5) * 2;
      const wy = y + o.warp * (warpY[i] - 0.5) * 2;
      const c1 = Math.min(1, crease((wx * cx) / n, (wy * cy) / n, coarse) * e1);
      const c2 = Math.min(1, crease((wx * fx) / n, (wy * fy) / n, fine) * e2);
      // Rounded pebble plateaus (sqrt) with soft creases between them.
      h[i] = Math.sqrt(c1) + o.fineWeight * Math.sqrt(c2) + 0.6 * swell[i];
    }
  }
  // Emboss: light from the top-left. Wrap indices so the tile stays seamless.
  const s = new Float32Array(n * n);
  let sum = 0, sum2 = 0;
  for (let y = 0; y < n; y++) {
    const ym = wrap(y - 1, n) * n, yp = wrap(y + 1, n) * n;
    for (let x = 0; x < n; x++) {
      const xm = wrap(x - 1, n), xp = wrap(x + 1, n);
      const v = h[ym + xm] + 0.5 * (h[ym + x] + h[y * n + xm]) - h[yp + xp] - 0.5 * (h[yp + x] + h[y * n + xp]);
      s[y * n + x] = v;
      sum += v;
      sum2 += v * v;
    }
  }
  const mean = sum / (n * n);
  const sd = Math.sqrt(Math.max(1e-9, sum2 / (n * n) - mean * mean));
  const gain = o.contrast / sd;
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const grain = (hash(i, 3, o.seed + 29) - 0.5) * 2.2;
    out[i] = (s[i] - mean) * gain + grain;
  }
  return out;
}

/** RGBA pixels from luminance offsets around a base tone. */
function colourise(shade: Float32Array, base: readonly [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(shade.length * 4);
  const [r, g, b] = base;
  for (let i = 0; i < shade.length; i++) {
    const d = shade[i];
    out[i * 4] = r + d;
    out[i * 4 + 1] = g + d;
    out[i * 4 + 2] = b + d;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export interface FridgeTexture {
  /** JPEG data URL of one seamless tile (the board's tone; also used by the exports). */
  href: string;
  /** The same tile in the tray's (darker, unchanged) tone. */
  trayHref: string;
  /** Texels per side. */
  px: number;
  /** Board units per tile side. */
  units: number;
  /** Generation time in ms (pixels + encoding). */
  ms: number;
  /** The tile canvas, for drawing the texture straight onto a 2D canvas. */
  canvas: HTMLCanvasElement;
}

let cached: FridgeTexture | null = null;

/** Generate the tile once per page (shared by every <fridge-face> instance). */
export function fridgeTexture(): FridgeTexture {
  if (cached) return cached;
  const t0 = performance.now();
  const px = DEFAULT_TEXTURE.size;
  const shade = textureShade(DEFAULT_TEXTURE); // the expensive part, shared by both tones
  const tile = (base: readonly [number, number, number]) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    canvas.getContext('2d')!.putImageData(new ImageData(colourise(shade, base) as Uint8ClampedArray<ArrayBuffer>, px, px), 0, 0);
    return { canvas, href: canvas.toDataURL('image/jpeg', 0.82) };
  };
  const board = tile(TEXTURE_BASE);
  const tray = tile(TRAY_TEXTURE_BASE);
  cached = { href: board.href, trayHref: tray.href, px, units: TEXTURE_UNITS, ms: performance.now() - t0, canvas: board.canvas };
  return cached;
}
