import { describe, expect, it } from 'vitest';
import { C_OVAL_SHARE, cFrameZoom, PHONE_COMFORT_MARGIN, PHONE_OVALS_ACROSS, phoneComfortZoom, DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, boardToScreen, clampZoom, fitTo, panBy, rotatedBounds, screenToBoard, zoomAt } from './camera';

describe('camera', () => {
  const cam = { x: 120, y: -40, zoom: 1.7 };

  it('converts screen <-> board and round-trips', () => {
    const b = screenToBoard(cam, { x: 300, y: 200 });
    const s = boardToScreen(cam, b);
    expect(s.x).toBeCloseTo(300);
    expect(s.y).toBeCloseTo(200);
  });

  it('zoomAt keeps the board point under the cursor fixed', () => {
    const p = { x: 333, y: 217 };
    for (const f of [0.5, 0.8, 1.25, 3]) {
      const before = screenToBoard(cam, p);
      const next = zoomAt(cam, p, f);
      const after = screenToBoard(next, p);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      expect(next.zoom).toBeCloseTo(cam.zoom * f);
    }
  });

  it('clamps zoom, and zoomAt stays invariant when clamped', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    const p = { x: 50, y: 60 };
    const out = zoomAt(DEFAULT_CAMERA, p, 1e6);
    expect(out.zoom).toBe(MAX_ZOOM);
    const a = screenToBoard(DEFAULT_CAMERA, p), b = screenToBoard(out, p);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
    expect(zoomAt(DEFAULT_CAMERA, p, 1e-9).zoom).toBe(MIN_ZOOM);
  });

  it('panBy shifts without changing zoom', () => {
    expect(panBy(cam, 10, -5)).toEqual({ x: 130, y: -45, zoom: 1.7 });
  });

  it('fitTo centres the bounds inside the margin', () => {
    const vp = { width: 1000, height: 600 };
    const r = { x: 100, y: 50, w: 400, h: 100 };
    const c = fitTo(r, vp, 50);
    expect(c.zoom).toBeCloseTo(900 / 400); // width-limited
    const tl = boardToScreen(c, { x: r.x, y: r.y });
    const br = boardToScreen(c, { x: r.x + r.w, y: r.y + r.h });
    expect(tl.x).toBeCloseTo(50);
    expect(br.x).toBeCloseTo(950);
    expect((tl.y + br.y) / 2).toBeCloseTo(300);
  });

  it('fitTo clamps zoom to min and to the supplied max', () => {
    const vp = { width: 800, height: 600 };
    expect(fitTo({ x: 0, y: 0, w: 1e6, h: 1e6 }, vp, 20).zoom).toBe(MIN_ZOOM);
    expect(fitTo({ x: 0, y: 0, w: 1, h: 1 }, vp, 20).zoom).toBe(MAX_ZOOM);
    expect(fitTo({ x: 0, y: 0, w: 1, h: 1 }, vp, 20, 2).zoom).toBe(2);
  });

  it('rotatedBounds follows rotation and is null when empty', () => {
    expect(rotatedBounds([], () => undefined)).toBeNull();
    const shape = { bbox: { x: 0, y: 0, w: 100, h: 20 }, centroid: { x: 50, y: 10 } };
    const flat = rotatedBounds([{ shapeId: 's', x: 0, y: 0, rotation: 0 }], () => shape)!;
    expect(flat.w).toBeCloseTo(100);
    expect(flat.h).toBeCloseTo(20);
    const up = rotatedBounds([{ shapeId: 's', x: 0, y: 0, rotation: 90 }], () => shape)!;
    expect(up.w).toBeCloseTo(20);
    expect(up.h).toBeCloseTo(100);
    expect(up.x + up.w / 2).toBeCloseTo(0);
  });
});

describe('phoneComfortZoom (v1.2.5: about four black ovals across the visible board\'s shorter side)', () => {
  const OVAL_W = 246.67; // a positive round's upright width, board units (about; the browser suite checks the real one)
  const across = (v: { width: number; height: number }) => (PHONE_OVALS_ACROSS * OVAL_W * phoneComfortZoom(v, OVAL_W)) / Math.min(v.width, v.height);

  it('portrait (393 x 659) and landscape (734 x 343): four ovals span the shorter side, within 5%', () => {
    for (const v of [{ width: 393, height: 659 }, { width: 734, height: 343 }]) {
      expect(across(v)).toBeGreaterThan(0.95);
      expect(across(v)).toBeLessThan(1.05);
    }
  });

  it('is the shorter side that counts, in either orientation, and the little margin keeps the row inside it', () => {
    expect(phoneComfortZoom({ width: 393, height: 659 }, OVAL_W)).toBeCloseTo(phoneComfortZoom({ width: 659, height: 393 }, OVAL_W), 12);
    expect(across({ width: 393, height: 659 })).toBeCloseTo(PHONE_COMFORT_MARGIN, 12);
    expect(PHONE_COMFORT_MARGIN).toBeLessThanOrEqual(1);
  });

  it('scales with the board, and falls back to zoom 1 for a board or shape with no size', () => {
    expect(phoneComfortZoom({ width: 786, height: 1318 }, OVAL_W)).toBeCloseTo(2 * phoneComfortZoom({ width: 393, height: 659 }, OVAL_W), 12);
    expect(phoneComfortZoom({ width: 0, height: 500 }, OVAL_W)).toBe(DEFAULT_CAMERA.zoom);
    expect(phoneComfortZoom({ width: 393, height: 659 }, 0)).toBe(DEFAULT_CAMERA.zoom);
  });
});

describe('cFrameZoom (v1.2.5: the guide\'s c on phones, the black oval 45% of the visible board\'s shorter side)', () => {
  const OVAL_W = 246.67;
  const C = { w: 420, h: 300 }; // about an oval and its wedge (board units)
  const share = (v: { width: number; height: number }, c = C) => (OVAL_W * cFrameZoom(v, OVAL_W, c, 8)) / Math.min(v.width, v.height);

  it('portrait and landscape: the oval is 45% of the shorter side (about 2.2 ovals across) when the whole c fits', () => {
    expect(C_OVAL_SHARE).toBe(0.45);
    expect(share({ width: 393, height: 659 })).toBeCloseTo(0.45, 9);
    expect(share({ width: 734, height: 343 })).toBeCloseTo(0.45, 9);
  });

  it('reduces just enough to fit the whole c (with its padding) when 45% would not', () => {
    const tall = { w: 420, h: 900 };
    const v = { width: 734, height: 343 };
    const z = cFrameZoom(v, OVAL_W, tall, 8);
    expect(z * tall.h).toBeCloseTo(v.height - 16, 9); // exactly fills the height, less the padding
    expect(share(v, tall)).toBeLessThan(0.45);
  });

  it('is steady for a missing size', () => {
    expect(cFrameZoom({ width: 0, height: 300 }, OVAL_W, C, 8)).toBe(1);
    expect(cFrameZoom({ width: 393, height: 659 }, 0, C, 8)).toBe(1);
  });
});
