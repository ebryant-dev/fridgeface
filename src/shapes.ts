import positiveStemSvg from './shapes/positive-stem.svg?raw';
import positiveRoundSvg from './shapes/positive-round.svg?raw';
import negativeStemSvg from './shapes/negative-stem.svg?raw';
import negativeRoundSvg from './shapes/negative-round.svg?raw';
import wedgeSvg from './shapes/wedge.svg?raw';
import { uprightBounds } from './rotation';

export type Polarity = 'positive' | 'negative';
export type Pt = { x: number; y: number };

export interface Shape {
  id: string;
  name: string;
  polarity: Polarity;
  fill: string;
  /** Source geometry, exactly as drawn in the source file. */
  geometry: { kind: 'polygon'; points: string } | { kind: 'path'; d: string };
  /** Drawn (rest pose) orientation minus upright, in degrees, clockwise-positive, in (-90, 90]. */
  uprightOffsetDeg: number;
  /** Area centroid in source units (rotation pivot). */
  centroid: Pt;
  /** Bounding box in source units. */
  bbox: { x: number; y: number; w: number; h: number };
  /**
   * Bounds in the shape's UPRIGHT frame: the outline rotated by -uprightOffsetDeg about the centroid,
   * relative to the centroid (so the centroid is the origin). A selection box drawn from this and
   * rotated by fromUpright hugs the shape at any rotation.
   */
  uprightBox: { x: number; y: number; w: number; h: number };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function parse(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.querySelector('svg > polygon, svg > path') as SVGElement | null;
  if (!el) throw new Error('shape file has no geometry element');
  const fill = (/fill:\s*(#[0-9a-fA-F]{3,8})/.exec(svg)?.[1] ?? '#000').toLowerCase();
  const geometry: Shape['geometry'] =
    el.tagName === 'polygon'
      ? { kind: 'polygon', points: el.getAttribute('points')! }
      : { kind: 'path', d: el.getAttribute('d')! };
  return { fill, geometry };
}

function pointsOf(g: Shape['geometry']): { pts: Pt[]; isPolygon: boolean } {
  if (g.kind === 'polygon') {
    const n = g.points.trim().split(/[\s,]+/).map(Number);
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
    // drop duplicated closing point
    if (pts.length > 1 && pts[0].x === pts.at(-1)!.x && pts[0].y === pts.at(-1)!.y) pts.pop();
    return { pts, isPolygon: true };
  }
  // Sample the outline at uniform arc length using the browser's own path engine.
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', g.d);
  const len = p.getTotalLength();
  const N = 720;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const q = p.getPointAtLength((len * i) / N);
    pts.push({ x: q.x, y: q.y });
  }
  return { pts, isPolygon: false };
}

function areaCentroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const c = p.x * q.y - q.x * p.y;
    a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Normalise an angle in degrees to (-90, 90]. */
function norm90(d: number): number {
  let a = ((d % 180) + 180) % 180; // [0,180)
  if (a > 90) a -= 180;
  return a;
}

/** Clockwise angle (SVG, y down) of a direction measured from vertical (up). */
const fromVertical = (dx: number, dy: number) => norm90((Math.atan2(dx, -dy) * 180) / Math.PI);
/** Clockwise angle of a direction measured from horizontal (right). */
const fromHorizontal = (dx: number, dy: number) => norm90((Math.atan2(dy, dx) * 180) / Math.PI);

function longestEdge(pts: Pt[]) {
  let best = { len: -1, dx: 0, dy: 0 };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len > best.len) best = { len, dx: q.x - p.x, dy: q.y - p.y };
  }
  return best;
}

/** Principal axis of the outline samples (PCA); returns direction of the long axis. */
function principalAxis(pts: Pt[]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // long-axis angle from +x
  return { dx: Math.cos(theta), dy: Math.sin(theta) };
}

function build(id: string, name: string, polarity: Polarity, svg: string, upright: 'stem' | 'round' | 'wedge'): Shape {
  const { fill, geometry } = parse(svg);
  const { pts } = pointsOf(geometry);
  let off: number;
  if (upright === 'stem') {
    const e = longestEdge(pts);
    off = fromVertical(e.dx, e.dy);
  } else if (upright === 'round') {
    const a = principalAxis(pts);
    off = fromVertical(a.dx, a.dy);
  } else {
    // Wedge "upright" = longest edge horizontal, on the side nearest its rest pose (apex down).
    const e = longestEdge(pts);
    off = fromHorizontal(e.dx, e.dy);
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const centroid = areaCentroid(pts);
  return {
    id, name, polarity, fill, geometry,
    uprightOffsetDeg: off,
    centroid,
    bbox: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    uprightBox: uprightBounds(pts, centroid, off),
  };
}

export const SHAPES: Shape[] = [
  build('positive-stem', 'Positive stem', 'positive', positiveStemSvg, 'stem'),
  build('positive-round', 'Positive round', 'positive', positiveRoundSvg, 'round'),
  build('negative-stem', 'Negative stem', 'negative', negativeStemSvg, 'stem'),
  build('negative-round', 'Negative round', 'negative', negativeRoundSvg, 'round'),
  build('wedge', 'Wedge', 'negative', wedgeSvg, 'wedge'),
];
