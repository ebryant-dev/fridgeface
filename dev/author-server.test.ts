import { afterAll, describe, expect, it } from 'vitest';
import { readdir, readFile, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { authorServer } from './author-server.ts';
import { AUTHOR_ROUTE } from './route.ts';

/**
 * The dev-only author middleware, driven with fake requests. Files are written under a scratch root in the gitignored
 * .playwright-mcp/ folder (never src/suggestions/) and removed again by the test itself.
 */
const ROOT = resolve('.playwright-mcp/author-server-test');
const DIR = join(ROOT, 'src/suggestions');

type Handler = (req: unknown, res: unknown, next: () => void) => Promise<void> | void;
let handler: Handler;
const plugin = authorServer();
(plugin.configureServer as unknown as (s: unknown) => void)({ config: { root: ROOT }, middlewares: { use: (fn: Handler) => (handler = fn) } });

async function call(method: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const req = {
    method,
    url: AUTHOR_ROUTE,
    headers: { 'content-type': 'application/json', host: 'localhost:5173', origin: 'http://localhost:5173', ...headers },
    on(ev: string, fn: (...a: unknown[]) => void) {
      (listeners[ev] ??= []).push(fn);
      if (ev === 'end') queueMicrotask(() => { for (const f of listeners.data ?? []) f(text); for (const f of listeners.end ?? []) f(); });
    },
    destroy() {},
  };
  return new Promise((done) => {
    const res = {
      statusCode: 0,
      setHeader() {},
      end(out?: string) { done({ status: res.statusCode, body: out ? JSON.parse(out) : {} }); },
    };
    void handler(req, res, () => done({ status: -1, body: {} }));
  });
}

const pieces = [{ s: 'positive-stem', x: 50, y: -100, r: 0 }];
const wordData = (text: string, variant = 1) => ({ v: 1, text, variant, pieces, baseline: 0 });

describe('author middleware', () => {
  afterAll(async () => {
    // Remove the (by now empty) scratch folders this test created; never anything else.
    for (const d of [DIR, join(ROOT, 'src'), ROOT]) await rmdir(d).catch(() => {});
  });

  it('saves a word composition under its word- name, refuses to overwrite, replaces on request, deletes', async () => {
    const filename = 'word-_x0050lay-1.json';
    expect(await call('POST', { filename, data: wordData('Play') })).toEqual({ status: 200, body: { ok: true, filename } });
    const saved = JSON.parse(await readFile(join(DIR, filename), 'utf8'));
    expect(saved).toEqual(wordData('Play'));
    expect(Object.keys(saved)).toEqual(['v', 'text', 'variant', 'pieces', 'baseline']);
    expect(await call('POST', { filename, data: wordData('Play') })).toEqual({ status: 200, body: { ok: false, error: 'exists', filename } });
    expect((await call('POST', { filename, data: wordData('Play'), overwrite: true })).status).toBe(200);
    expect(await call('DELETE', { filename })).toEqual({ status: 200, body: { ok: true, filename } });
    expect((await call('DELETE', { filename })).status).toBe(404);
    expect(await readdir(DIR)).toEqual([]);
  });

  it('still saves letters in exactly the old format', async () => {
    const filename = 'lower-q-1.json';
    expect((await call('POST', { filename, data: { v: 1, char: 'q', variant: 1, pieces, baseline: 0, extra: 'dropped' } })).status).toBe(200);
    expect(Object.keys(JSON.parse(await readFile(join(DIR, filename), 'utf8')))).toEqual(['v', 'char', 'variant', 'pieces', 'baseline']);
    expect((await call('DELETE', { filename })).status).toBe(200);
  });

  it('refuses path traversal and any name it could not have produced', async () => {
    for (const filename of ['../word-play-1.json', '../../package.json', 'word-play-1.json/../x.json', 'sub/word-play-1.json', '/tmp/word-play-1.json',
      'word-..-1.json', 'word-play-1.json\0', 'word-PLAY-1.json', 'word-_x0070lay-1.json', '..', '.', '', 'word-a_x002f..-1.json']) {
      for (const method of ['POST', 'DELETE']) {
        const r = await call(method, { filename, data: wordData('play') });
        expect(r.status, `${method} ${filename}`).toBe(400);
      }
    }
  });

  it('refuses data that does not match the name or is not a valid word', async () => {
    expect((await call('POST', { filename: 'word-play-1.json', data: wordData('Play') })).status).toBe(400);
    expect((await call('POST', { filename: 'word-play-2.json', data: wordData('play', 1) })).status).toBe(400);
    expect((await call('POST', { filename: 'word-play-1.json', data: { ...wordData('play'), char: 'p' } })).status).toBe(400);
    expect((await call('POST', { filename: 'lower-p-1.json', data: wordData('play') })).status).toBe(400);
  });

  it('still refuses cross-origin and non-JSON requests', async () => {
    expect((await call('POST', { filename: 'word-play-1.json', data: wordData('play') }, { origin: 'http://evil.test' })).status).toBe(403);
    expect((await call('POST', { filename: 'word-play-1.json', data: wordData('play') }, { 'content-type': 'text/plain' })).status).toBe(415);
  });
});
