import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { AUTHOR_ROUTE } from './route.ts';
import { isSafeSuggestionFilename, suggestionFilename, validateSuggestion } from '../src/suggestions.ts';

/**
 * Dev-server middleware for the author mode: writes and deletes `src/suggestions/<name>.json`.
 * Only ever registered by `vite` (serve), never by `vite build`, so nothing here is in `dist/`.
 *
 *   POST   /__fridgeface/suggestion   { filename, data, overwrite? }  -> 200 { ok: true, filename } | 200 { ok: false, error: 'exists' } (nothing written) | 4xx
 *   DELETE /__fridgeface/suggestion   { filename }                    -> 200 { ok } | 404 | 4xx
 *
 * Safety: the file name must be exactly what `suggestionFilename` produces (no separators, dots or case tricks),
 * the data must be a valid suggestion whose char and variant match that name, a write never replaces an existing
 * file unless `overwrite` is true, a delete touches only that one file, and the request must be same-origin JSON.
 */
const MAX_BODY = 64 * 1024;

interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: string, fn: (...a: any[]) => void): void;
  destroy(): void;
}
interface Res {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function sendJson(res: Res, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: Req): Promise<string | null> {
  return new Promise((done) => {
    let size = 0;
    const parts: string[] = [];
    req.on('data', (c: { toString(): string; length: number }) => {
      size += c.length;
      if (size > MAX_BODY) {
        done(null);
        req.destroy();
        return;
      }
      parts.push(c.toString());
    });
    req.on('end', () => done(parts.join('')));
    req.on('error', () => done(null));
  });
}

const header = (req: Req, name: string): string => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

/** A same-origin request: an Origin (if sent) must be this very host, and the browser must not call it cross-site. */
function sameOrigin(req: Req): boolean {
  const origin = header(req, 'origin');
  if (origin) {
    try {
      if (new URL(origin).host !== header(req, 'host')) return false;
    } catch {
      return false;
    }
  }
  const site = header(req, 'sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}

export function authorServer(): Plugin {
  return {
    name: 'fridgeface-author-server',
    apply: 'serve',
    configureServer(server) {
      const dir = resolve(server.config.root, 'src/suggestions');
      server.middlewares.use(async (rawReq: unknown, rawRes: unknown, next: () => void) => {
        const req = rawReq as Req;
        const res = rawRes as Res;
        if ((req.url ?? '').split('?')[0] !== AUTHOR_ROUTE) return next();
        try {
          if (req.method !== 'POST' && req.method !== 'DELETE') return sendJson(res, 405, { error: 'method not allowed' });
          if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' });
          if (!header(req, 'content-type').toLowerCase().startsWith('application/json')) return sendJson(res, 415, { error: 'JSON only' });
          const text = await readBody(req);
          if (text === null) return sendJson(res, 413, { error: 'request too large or unreadable' });
          let body: Record<string, unknown>;
          try {
            const parsed = JSON.parse(text);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
            body = parsed as Record<string, unknown>;
          } catch {
            return sendJson(res, 400, { error: 'body is not a JSON object' });
          }
          const filename = body.filename;
          if (!isSafeSuggestionFilename(filename)) return sendJson(res, 400, { error: 'unsafe or invalid file name' });
          const target = join(dir, filename);
          if (dirname(resolve(target)) !== dir) return sendJson(res, 400, { error: 'unsafe path' });

          if (req.method === 'DELETE') {
            const exists = await stat(target).then((s: { isFile(): boolean }) => s.isFile(), () => false);
            if (!exists) return sendJson(res, 404, { error: 'no such suggestion' });
            await unlink(target);
            return sendJson(res, 200, { ok: true, filename });
          }

          const v = validateSuggestion(body.data);
          if (!v.ok) return sendJson(res, 400, { error: `not a valid suggestion: ${v.error}` });
          if (suggestionFilename(v.value.char, v.value.variant) !== filename) return sendJson(res, 400, { error: 'file name does not match the character and variant' });
          const data = body.data as { v: number; char: string; variant: number; pieces: unknown[]; baseline: number };
          // Write only the known fields, in a fixed order, pretty-printed.
          const json = JSON.stringify({ v: data.v, char: data.char, variant: data.variant, pieces: data.pieces, baseline: data.baseline }, null, 2) + '\n';
          await mkdir(dir, { recursive: true });
          try {
            // 'wx' creates the file only if it does not exist: the refusal to overwrite is atomic, not a check-then-write.
            await writeFile(target, json, { encoding: 'utf8', flag: body.overwrite === true ? 'w' : 'wx' });
          } catch (err) {
            if ((err as { code?: string }).code === 'EEXIST') return sendJson(res, 200, { ok: false, error: 'exists', filename }); // a normal outcome, not a failure: 200 keeps the browser console clean
            throw err;
          }
          return sendJson(res, 200, { ok: true, filename });
        } catch (err) {
          return sendJson(res, 500, { error: err instanceof Error ? err.message : 'failed' });
        }
      });
    },
  };
}
