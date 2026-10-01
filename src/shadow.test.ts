import { describe, expect, it } from 'vitest';
import { LIFT_SHADOW, REST_SHADOW, SCREEN_SPLIT, SPREAD, layerPush, shadowCss, shadowLayersMarkup, staticShadowMarkup, subdivide } from './shadow';

describe('shadows', () => {
  it('never use filters', () => {
    expect(shadowCss()).not.toMatch(/filter/);
    expect(staticShadowMarkup('<path d="M0 0" {a}/>', 2.5)).not.toMatch(/filter/);
  });

  it('fall down-right, and grow and soften when lifted', () => {
    for (const s of [REST_SHADOW, LIFT_SHADOW]) {
      expect(s.dx).toBeGreaterThan(0);
      expect(s.dy).toBeGreaterThan(s.dx);
    }
    expect(Math.hypot(LIFT_SHADOW.dx, LIFT_SHADOW.dy)).toBeGreaterThan(Math.hypot(REST_SHADOW.dx, REST_SHADOW.dy));
    expect(LIFT_SHADOW.layers.at(-1)![0]).toBeGreaterThan(REST_SHADOW.layers.at(-1)![0]);
  });

  it('pushes each layer less than its half-width, so its inner half stays under the shape and core', () => {
    expect(SPREAD).toBeLessThan(1);
    for (const s of [REST_SHADOW, LIFT_SHADOW]) {
      for (const [w] of s.layers) {
        const [px, py] = layerPush(s, w);
        expect(w / 2).toBeGreaterThanOrEqual(Math.hypot(px, py));
      }
    }
  });

  it('subdivision keeps the total density of each band', () => {
    const d = subdivide(REST_SHADOW, 4);
    expect(d.layers.length).toBe(4 * REST_SHADOW.layers.length);
    const t = d.layers.slice(0, 4).reduce((acc, [, a]) => acc * (1 - a), 1);
    expect(1 - t).toBeCloseTo(REST_SHADOW.layers[0][1], 9);
    expect(d.layers[3][0]).toBe(REST_SHADOW.layers[0][0]);
  });

  it('builds one rotated copy per layer on screen', () => {
    const m = shadowLayersMarkup('<path d="M0 0" {a}/>', 'rotate(10)');
    expect((m.match(/<path/g) ?? []).length).toBe(1 + SCREEN_SPLIT * REST_SHADOW.layers.length);
    expect((m.match(/data-rot transform="rotate\(10\)"/g) ?? []).length).toBe(1 + SCREEN_SPLIT * REST_SHADOW.layers.length);
  });
});
