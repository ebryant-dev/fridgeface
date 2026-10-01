import { deserialize, type DeserializeResult, type SerializedComposition } from './serialize';

/**
 * Share codec: composition -> compact URL-safe string, and back.
 *
 *   "1." + base64url(deflate-raw(JSON))   (CompressionStream available)
 *   "0." + base64url(JSON)                (fallback, or encode(..., { compress: false }))
 *
 * The JSON is the wire format from serialize.ts. decode() never throws, caps the decompressed size
 * (zip-bomb safe) and hands the result to the strict `deserialize`.
 */
export const TAG_DEFLATE = '1';
export const TAG_PLAIN = '0';
/** Decompressed JSON larger than this is refused. */
export const MAX_DECODED_BYTES = 256 * 1024;
/** Encoded strings longer than this are refused before any work is done. */
export const MAX_ENCODED_CHARS = 512 * 1024;

const B64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array | null {
  if (!B64URL.test(s) || s.length % 4 === 1) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const hasStreams = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function collect(readable: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function pipeThrough(bytes: Uint8Array, t: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array | null> {
  const writer = t.writable.getWriter();
  // A corrupt stream rejects both sides; the reader's failure is the one we report.
  const writing = writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => undefined);
  try {
    return await collect(t.readable as ReadableStream<Uint8Array>, limit);
  } finally {
    await writing;
  }
}

export interface EncodeOptions {
  /** Force the uncompressed `0.` form (used for tests and as the automatic fallback). */
  compress?: boolean;
}

/** Encode a serialized composition. Never throws for a well-formed composition. */
export async function encode(composition: SerializedComposition, opts: EncodeOptions = {}): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(composition));
  if (opts.compress !== false && hasStreams()) {
    try {
      const z = await pipeThrough(json, new CompressionStream('deflate-raw'), Number.MAX_SAFE_INTEGER);
      if (z) return `${TAG_DEFLATE}.${toBase64Url(z)}`;
    } catch {
      /* fall through to the plain form */
    }
  }
  return `${TAG_PLAIN}.${toBase64Url(json)}`;
}

/** Decode a share string. Never throws: returns the `deserialize` result, or `{ ok: false, error }`. */
export async function decode(str: string): Promise<DeserializeResult> {
  try {
    if (typeof str !== 'string') return { ok: false, error: 'not a string' };
    if (str.length > MAX_ENCODED_CHARS) return { ok: false, error: 'link too long' };
    const dot = str.indexOf('.');
    if (dot < 1) return { ok: false, error: 'missing format tag' };
    const tag = str.slice(0, dot);
    const bytes = fromBase64Url(str.slice(dot + 1));
    if (!bytes) return { ok: false, error: 'corrupt payload' };
    let json: Uint8Array | null;
    if (tag === TAG_PLAIN) {
      json = bytes.length > MAX_DECODED_BYTES ? null : bytes;
    } else if (tag === TAG_DEFLATE) {
      if (!hasStreams()) return { ok: false, error: 'this browser cannot open compressed links' };
      json = await pipeThrough(bytes, new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES).catch(() => undefined as never);
      if (json === undefined) return { ok: false, error: 'corrupt payload' };
    } else {
      return { ok: false, error: `unknown format tag: ${tag.slice(0, 8)}` };
    }
    if (!json) return { ok: false, error: 'payload too large' };
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(json);
    } catch {
      return { ok: false, error: 'corrupt payload' };
    }
    return deserialize(text);
  } catch {
    return { ok: false, error: 'unreadable link' };
  }
}

/** `<base>#c=<encoded>`; any existing hash on `base` is replaced. */
export function buildShareUrl(base: string, encoded: string): string {
  return `${base.split('#')[0]}#c=${encoded}`;
}

/** The encoded composition from a location hash (`#c=...`), or null when there is none. */
export function encodedFromHash(hash: string): string | null {
  const m = /^#?(?:.*&)?c=([^&]*)/.exec(hash);
  return m ? m[1] : null;
}
