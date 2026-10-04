import { describe, expect, it } from 'vitest';
import { COMPACT_MAX_H, COMPACT_MAX_W, columnTrayScale, layoutState } from './layout';

describe('layoutState', () => {
  it('desktop: wide and tall', () => {
    expect(layoutState(1440, 900)).toEqual({ compact: false, short: false, landscape: false });
    expect(layoutState(COMPACT_MAX_W + 1, COMPACT_MAX_H + 1)).toEqual({ compact: false, short: false, landscape: false });
  });
  it('compact when narrow (phone portrait), inclusive threshold', () => {
    expect(layoutState(393, 659)).toEqual({ compact: true, short: false, landscape: false });
    expect(layoutState(COMPACT_MAX_W, 900)).toEqual({ compact: true, short: false, landscape: false });
  });
  it('landscape compact: short AND wider than tall (phones in landscape), inclusive height threshold', () => {
    expect(layoutState(734, 343)).toEqual({ compact: true, short: true, landscape: true }); // iPhone 15 landscape profile
    expect(layoutState(844, 390)).toEqual({ compact: true, short: true, landscape: true });
    expect(layoutState(932, 430)).toEqual({ compact: true, short: true, landscape: true });
    expect(layoutState(1440, COMPACT_MAX_H)).toEqual({ compact: true, short: true, landscape: true });
  });
  it('short but not wider than tall keeps the bottom tray (not landscape)', () => {
    expect(layoutState(400, 450)).toEqual({ compact: true, short: true, landscape: false });
    expect(layoutState(450, 450)).toEqual({ compact: true, short: true, landscape: false }); // square: not wider
    expect(layoutState(451, 450)).toEqual({ compact: true, short: true, landscape: true });
  });
  it('tall and wide is never landscape compact, however wide', () => {
    expect(layoutState(2000, COMPACT_MAX_H + 1).landscape).toBe(false);
  });
  it('an unlaid-out element (0 x 0) is compact, as the container queries were', () => {
    expect(layoutState(0, 0)).toEqual({ compact: true, short: true, landscape: false });
  });
});

describe('columnTrayScale', () => {
  it('caps at the compact scale when there is room', () => {
    expect(columnTrayScale(1000, 1707, 24, 0.17)).toBe(0.17);
  });
  it('shrinks to fit a short column', () => {
    const tk = columnTrayScale(287, 1707, 24, 0.17);
    expect(tk).toBeLessThan(0.17);
    expect(1707 * tk + 24).toBeCloseTo(287, 6);
  });
  it('never collapses to zero or goes negative', () => {
    expect(columnTrayScale(10, 1707, 24, 0.17)).toBe(0.05);
    expect(columnTrayScale(300, 0, 24, 0.17)).toBe(0.17);
  });
});
