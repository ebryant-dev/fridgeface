import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXTURE, TEXTURE_BASE, TRAY_TEXTURE_BASE, texturePixels } from './texture';

const lum = (px: Uint8ClampedArray, i: number) => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

describe('texturePixels', () => {
  const o = { ...DEFAULT_TEXTURE, size: 128 };
  const px = texturePixels(o);
  const n = o.size;

  it('is a light warm grey with subtle contrast, darker than the negative shapes (#e6e7e8)', () => {
    let s = 0, s2 = 0;
    for (let i = 0; i < n * n; i++) { const l = lum(px, i); s += l; s2 += l * l; }
    const mean = s / (n * n), sd = Math.sqrt(s2 / (n * n) - mean * mean);
    expect(Math.abs(mean - (0.299 * TEXTURE_BASE[0] + 0.587 * TEXTURE_BASE[1] + 0.114 * TEXTURE_BASE[2]))).toBeLessThan(2);
    expect(mean).toBeLessThan(0xe6 - 6); // still visibly darker than the negative shapes (v1.4.1 halved the gap again)
    expect(sd).toBeGreaterThan(3);
    expect(sd).toBeLessThan(9);
  });

  it('board is lighter than before (v1.4.1: gap to #e6e7e8 halved again, from the v0.4.0 base 216,215,212); the tray keeps the original tone and the same texture', () => {
    const l = (c: readonly number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const neg = l([0xe6, 0xe7, 0xe8]);
    expect(TRAY_TEXTURE_BASE).toEqual([208, 206, 203]);
    expect(TEXTURE_BASE).toEqual([223, 222, 219]);
    const oldGap = neg - l([216, 215, 212]), newGap = neg - l(TEXTURE_BASE);
    expect(newGap).toBeGreaterThan(oldGap * 0.45);
    expect(newGap).toBeLessThan(oldGap * 0.6);
    expect(newGap, 'the white pieces still read').toBeGreaterThan(6);
    // Same character: the two tones differ by a constant offset per channel (barring clamping, which never happens here).
    const tray = texturePixels(o, TRAY_TEXTURE_BASE);
    for (let i = 0; i < n * n; i += 97) for (let c = 0; c < 3; c++) expect(px[i * 4 + c] - tray[i * 4 + c]).toBe(TEXTURE_BASE[c] - TRAY_TEXTURE_BASE[c]);
  });

  it('tiles seamlessly: the wrap seam is no rougher than the interior', () => {
    const diff = (a: number, b: number) => Math.abs(lum(px, a) - lum(px, b));
    let seam = 0, inner = 0;
    for (let y = 0; y < n; y++) {
      seam += diff(y * n + n - 1, y * n); // right edge -> left edge
      inner += diff(y * n + n / 2 - 1, y * n + n / 2);
    }
    for (let x = 0; x < n; x++) {
      seam += diff((n - 1) * n + x, x); // bottom edge -> top edge
      inner += diff((n / 2 - 1) * n + x, (n / 2) * n + x);
    }
    expect(seam).toBeLessThan(inner * 1.5);
  });

  it('is deterministic', () => {
    expect(texturePixels(o)).toEqual(px);
  });
});
