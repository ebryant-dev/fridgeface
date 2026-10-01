import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, boardToScreen, clampZoom, fitTo, panBy, rotatedBounds, screenToBoard, zoomAt } from './camera';

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
