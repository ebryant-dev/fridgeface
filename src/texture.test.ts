import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXTURE, TEXTURE_BASE, texturePixels } from './texture';

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
    expect(mean).toBeLessThan(0xe6 - 15);
    expect(sd).toBeGreaterThan(3);
    expect(sd).toBeLessThan(9);
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
