import { describe, expect, it } from 'vitest';
import {
  LIFT_SHADOW, REST_SHADOW, SCREEN_SPLIT, SHADOW_BOARD_SCALE, SHADOW_MAX, SHADOW_MIN, SPREAD, layerPush, shadowCss, shadowFactor, shadowLayersMarkup, shadowReach,
  shadowUnit, staticShadowMarkup, subdivide,
} from './shadow';
import { EXPORT_SHADOW_SCALE } from './export';

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

  describe('scale with zoom (board space, clamped)', () => {
    const REF = 1 / SHADOW_BOARD_SCALE; // the default desktop view: 0.4 CSS px per board unit

    it('is exactly the reference size at the default desktop view, the exports\' proportions', () => {
      expect(REF).toBeCloseTo(0.4, 9);
      expect(shadowFactor(REF)).toBeCloseTo(1, 9);
      expect(shadowUnit(REF)).toBeCloseTo(EXPORT_SHADOW_SCALE, 9); // the same board units per shadow px as an export
    });

    it('scales linearly with the pieces inside the clamp', () => {
      for (const z of [0.5, 0.75, 1, 1.25, 1.5]) {
        expect(shadowFactor(REF * z)).toBeCloseTo(z, 9);
        expect(shadowUnit(REF * z)).toBeCloseTo(SHADOW_BOARD_SCALE, 9); // constant in board units: it zooms with the board
      }
      expect(shadowReach(REF * 0.5).extent).toBeCloseTo(shadowReach(REF).extent * 0.5, 9);
    });

    it('caps the on-screen size zoomed far in, and keeps a faint ~1 px contact edge zoomed far out', () => {
      expect(SHADOW_MAX).toBeCloseTo(1.5, 9);
      for (const z of [1.5, 2, 4, 40]) expect(shadowFactor(REF * z)).toBeCloseTo(SHADOW_MAX, 9);
      for (const z of [0.45, 0.25, 0.1, 0.001]) expect(shadowFactor(REF * z)).toBeCloseTo(SHADOW_MIN, 9);
      const far = shadowReach(REF * 0.01);
      expect(far.offset).toBeGreaterThanOrEqual(0.9); // about one screen px of contact edge
      expect(far.offset).toBeLessThanOrEqual(1.2);
      // In board units the clamps hold the on-screen size: shadowUnit x pxPerUnit = the factor.
      expect(shadowUnit(REF * 4) * REF * 4).toBeCloseTo(SHADOW_MAX, 9);
      expect(shadowUnit(REF * 0.1) * REF * 0.1).toBeCloseTo(SHADOW_MIN, 9);
      expect(shadowFactor(0)).toBe(1); // no layout yet: the reference, never NaN
      expect(shadowUnit(0)).toBe(SHADOW_BOARD_SCALE);
    });

    it('the lift scales the same way (one --px for both)', () => {
      const css = shadowCss();
      expect(css).toMatch(/\.lifted \.sh \{ transform: translate\(calc\(3\.5 \* var\(--px\)\)/);
      expect(css).toMatch(/\.lifted \.bd \{ transform: translate\(calc\(-1\.5 \* var\(--px\)\)/);
    });
  });
});
