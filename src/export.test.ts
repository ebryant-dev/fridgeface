import { describe, expect, it } from 'vitest';
import { EXPORT_MIN_MARGIN, exportFilename, pngSize, renderCompositionSvg, type ExportShape } from './export';
import { REST_SHADOW } from './shadow';

const shape = (id: string, fill: string): ExportShape => ({
  id, fill,
  geometry: { kind: 'polygon', points: '0,0 100,0 100,200 0,200' },
  centroid: { x: 50, y: 100 },
  bbox: { x: 0, y: 0, w: 100, h: 200 },
});
const shapes = new Map([['a', shape('a', '#000')], ['b', shape('b', '#fff')]]);
const of = (id: string) => shapes.get(id);

describe('renderCompositionSvg', () => {
  it('draws pieces in stacking order as [shadow, shape], self-contained, no filter or external refs', () => {
    const r = renderCompositionSvg([{ shapeId: 'a', x: 0, y: 0, rotation: 0 }, { shapeId: 'b', x: 10, y: 0, rotation: 90 }], of);
    expect(r.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(r.svg.indexOf('fill="#000"/>')).toBeLessThan(r.svg.indexOf('fill="#fff"/>'));
    expect(r.svg).not.toMatch(/<filter|filter=|href|url\(|<image|<script/);
    expect(r.svg).toContain('rotate(90) translate(-50 -100)');
    // Each piece: a core copy + one stroke per soft layer, then the shape itself.
    const perPiece = 2 + 4 * REST_SHADOW.layers.length; // exports subdivide each soft layer in four
    expect((r.svg.match(/<polygon/g) ?? []).length).toBe(2 * perPiece);
    // The second piece's shadow sits after the first piece's shape: it falls on the piece below it.
    const firstShape = r.svg.indexOf('fill="#000"/>');
    const secondShadow = r.svg.indexOf('fill-opacity', firstShape);
    expect(secondShadow).toBeGreaterThan(firstShape);
    expect(secondShadow).toBeLessThan(r.svg.indexOf('fill="#fff"/>'));
  });

  it('shadows are offset outside the rotation, so they always fall down-right', () => {
    const r = renderCompositionSvg([{ shapeId: 'a', x: 0, y: 0, rotation: 180 }], of);
    const m = /<g transform="translate\(0 0\)"><g transform="translate\(([\d.]+) ([\d.]+)\)"><g transform="rotate\(180\)/.exec(r.svg);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![2])).toBeGreaterThan(Number(m![1]));
  });

  it('embeds the texture as a data-URL pattern anchored at the board origin', () => {
    const tex = { href: 'data:image/jpeg;base64,AAAA', units: 1024 };
    const r = renderCompositionSvg([{ shapeId: 'a', x: 0, y: 0, rotation: 0 }], of, tex);
    expect(r.svg).toContain('<pattern id="ff-tex" patternUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">');
    expect(r.svg).toContain('<image href="data:image/jpeg;base64,AAAA"');
    expect(r.svg).toContain('fill="url(#ff-tex)"');
    expect(r.svg).not.toMatch(/<filter|href="(?!data:)/);
    // Base colour under the texture, unless the caller (PNG path) paints the texture itself.
    expect((r.svg.match(/<rect/g) ?? []).length).toBe(2);
    expect((renderCompositionSvg([], of, tex, false).svg.match(/<rect/g) ?? []).length).toBe(1);
  });

  it('frames the ROTATED bounds plus a margin', () => {
    // 100x200 rotated 90 about its centroid at the origin -> 200 wide, 100 tall.
    const r = renderCompositionSvg([{ shapeId: 'a', x: 0, y: 0, rotation: 90 }], of);
    const margin = Math.max(EXPORT_MIN_MARGIN, 0.06 * 200);
    expect(r.width).toBeCloseTo(200 + 2 * margin, 1);
    expect(r.height).toBeCloseTo(100 + 2 * margin, 1);
    expect(r.svg).toContain(`viewBox="${-100 - margin} ${-50 - margin} `);
  });

  it('renders an empty composition as a blank board', () => {
    const r = renderCompositionSvg([], of);
    expect(r.width).toBe(400);
    expect(r.svg).not.toContain('<polygon');
  });
});

describe('pngSize / filename', () => {
  it('is 2x, capped to 4096 on the longest side', () => {
    expect(pngSize(300, 200)).toEqual({ width: 600, height: 400 });
    expect(pngSize(4000, 2000)).toEqual({ width: 4096, height: 2048 });
  });
  it('names files by local time', () => {
    expect(exportFilename('png', new Date(2026, 8, 5, 7, 3))).toBe('fridgeface-20260905-0703.png');
    expect(exportFilename('svg', new Date(2026, 11, 25, 23, 59))).toBe('fridgeface-20261225-2359.svg');
  });
});
