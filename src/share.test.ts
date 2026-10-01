import { describe, expect, it } from 'vitest';
import { buildShareUrl, decode, encode, encodedFromHash, MAX_DECODED_BYTES, toBase64Url } from './share';
import { SHAPE_IDS, serialize, type PlacedPiece } from './serialize';

const sample = (n: number, seed = 7): PlacedPiece[] => {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, () => ({
    shapeId: SHAPE_IDS[Math.floor(rnd() * 5)],
    x: Math.round((rnd() * 4000 - 2000) * 10) / 10,
    y: Math.round((rnd() * 4000 - 2000) * 10) / 10,
    rotation: Math.round((rnd() * 360 - 180) * 100) / 100,
  }));
};

describe('share codec', () => {
  it('round-trips the compressed form', async () => {
    const c = serialize(sample(10));
    const e = await encode(c);
    expect(e.startsWith('1.')).toBe(true);
    expect(e).toMatch(/^[01]\.[A-Za-z0-9_-]*$/);
    const r = await decode(e);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serialize(r.pieces)).toEqual(c);
  });

  it('round-trips the plain fallback form', async () => {
    const c = serialize(sample(10));
    const e = await encode(c, { compress: false });
    expect(e.startsWith('0.')).toBe(true);
    const r = await decode(e);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serialize(r.pieces)).toEqual(c);
  });

  it('round-trips 100 random pieces in both forms, and an empty composition', async () => {
    const c = serialize(sample(100, 99));
    for (const compress of [true, false]) {
      const r = await decode(await encode(c, { compress }));
      expect(r.ok && serialize(r.pieces)).toEqual(c);
    }
    const empty = await decode(await encode(serialize([])));
    expect(empty).toMatchObject({ ok: true, pieces: [] });
  });

  it('reports encoded lengths', async () => {
    const l10 = (await encode(serialize(sample(10)))).length;
    const l100 = (await encode(serialize(sample(100, 99)))).length;
    expect(l10).toBeLessThan(400);
    expect(l100).toBeLessThan(3000);
  });

  it('never throws on a corrupt payload', async () => {
    for (const bad of ['1.', '1.AAAA', '1.!!!!', '1.' + toBase64Url(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), '0.bm90IGpzb24', '0.', '', '.', 'garbage', '1.A']) {
      const r = await decode(bad);
      expect(r.ok).toBe(false);
    }
    const good = await encode(serialize(sample(10)));
    const r = await decode(good.slice(0, good.length - 10));
    expect(r.ok).toBe(false);
    expect((await decode(null as unknown as string)).ok).toBe(false);
  });

  it('rejects an unknown tag', async () => {
    const r = await decode('9.' + toBase64Url(new TextEncoder().encode('{"v":1,"pieces":[]}')));
    expect(r).toEqual({ ok: false, error: 'unknown format tag: 9' });
  });

  it('passes through deserialize (bad version, bad pieces dropped)', async () => {
    const enc = (o: unknown) => '0.' + toBase64Url(new TextEncoder().encode(JSON.stringify(o)));
    expect((await decode(enc({ v: 2, pieces: [] }))).ok).toBe(false);
    const r = await decode(enc({ v: 1, pieces: [{ s: 'nope', x: 0, y: 0, r: 0 }, { s: 'wedge', x: 1, y: 2, r: 3 }] }));
    expect(r).toMatchObject({ ok: true, dropped: 1 });
  });

  it('limits decompressed size (zip bomb)', async () => {
    // ~2 MB of zeros deflates to a couple of KB.
    const bomb = new Uint8Array(2 * 1024 * 1024);
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    void w.write(bomb).then(() => w.close());
    const chunks: Uint8Array[] = [];
    const rd = cs.readable.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); }
    const z = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of chunks) { z.set(c, o); o += c.length; }
    expect(z.length).toBeLessThan(MAX_DECODED_BYTES);
    const r = await decode('1.' + toBase64Url(z));
    expect(r).toEqual({ ok: false, error: 'payload too large' });
    // plain form over the limit too
    const big = await decode('0.' + toBase64Url(new Uint8Array(MAX_DECODED_BYTES + 1)));
    expect(big).toEqual({ ok: false, error: 'payload too large' });
  });

  it('builds URLs and reads hashes', () => {
    expect(buildShareUrl('https://x.test/play?a=1#old', '1.abc')).toBe('https://x.test/play?a=1#c=1.abc');
    expect(encodedFromHash('#c=1.abc')).toBe('1.abc');
    expect(encodedFromHash('#x=1&c=0.zz')).toBe('0.zz');
    expect(encodedFromHash('#other')).toBeNull();
    expect(encodedFromHash('')).toBeNull();
  });
});
