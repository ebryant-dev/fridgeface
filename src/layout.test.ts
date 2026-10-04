import { describe, expect, it } from 'vitest';
import { COMPACT_MAX_H, COMPACT_MAX_W, layoutState } from './layout';

describe('layoutState', () => {
  it('desktop: wide and tall', () => {
    expect(layoutState(1440, 900)).toEqual({ compact: false, short: false });
    expect(layoutState(COMPACT_MAX_W + 1, COMPACT_MAX_H + 1)).toEqual({ compact: false, short: false });
  });
  it('compact when narrow (phone portrait), inclusive threshold', () => {
    expect(layoutState(393, 659)).toEqual({ compact: true, short: false });
    expect(layoutState(COMPACT_MAX_W, 900)).toEqual({ compact: true, short: false });
  });
  it('compact and short when short (phone landscape), inclusive threshold', () => {
    expect(layoutState(734, 343)).toEqual({ compact: true, short: true });
    expect(layoutState(1440, COMPACT_MAX_H)).toEqual({ compact: true, short: true });
  });
  it('an unlaid-out element (0 x 0) is compact, as the container queries were', () => {
    expect(layoutState(0, 0)).toEqual({ compact: true, short: true });
  });
});
