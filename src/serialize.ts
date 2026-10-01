import { normalise } from './rotation.ts';

/**
 * Composition wire format (pure, no DOM). Compact and stable: chunk 6 builds share links on it.
 *
 *   { v: 1, pieces: [{ s: shapeId, x, y, r }] }
 *
 * Array order IS the stacking order (first = bottom). x/y are rounded to 0.1 board units and r
 * (degrees, normalised to (-180, 180]) to 0.01. Piece ids are not stored: they are session-local.
 */
export const FORMAT_VERSION = 1;
export const MAX_PIECES = 2000;
/** Coordinates beyond this are rejected as garbage (the board is unbounded, but not that unbounded). */
export const MAX_COORD = 1_000_000;

/** The five shape ids (kept in step with src/shapes/*.svg by a test). */
export const SHAPE_IDS: readonly string[] = ['positive-stem', 'positive-round', 'negative-stem', 'negative-round', 'wedge'];
const KNOWN = new Set(SHAPE_IDS);

export interface SerializedPiece {
  s: string;
  x: number;
  y: number;
  r: number;
}
export interface SerializedComposition {
  v: typeof FORMAT_VERSION;
  pieces: SerializedPiece[];
}
export interface PlacedPiece {
  shapeId: string;
  x: number;
  y: number;
  rotation: number;
}
export type DeserializeResult =
  | { ok: true; pieces: PlacedPiece[]; dropped: number }
  | { ok: false; error: string };

const clean = (n: number) => (n === 0 ? 0 : n); // no -0
const round1 = (n: number) => clean(Math.round(n * 10) / 10);
const round2 = (n: number) => clean(Math.round(n * 100) / 100);

export function serialize(pieces: readonly PlacedPiece[]): SerializedComposition {
  return {
    v: FORMAT_VERSION,
    pieces: pieces.map((p) => ({ s: p.shapeId, x: round1(p.x), y: round1(p.y), r: round2(normalise(p.rotation)) })),
  };
}

export function serializeToString(pieces: readonly PlacedPiece[]): string {
  return JSON.stringify(serialize(pieces));
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Strict, never-throwing parse. Accepts a JSON string or an already-parsed value.
 * A malformed payload (not an object, wrong/unknown version, pieces not an array, too many pieces) is an error.
 * An individual bad piece (unknown shape, non-finite or non-number coordinate, wrong type) is dropped and counted.
 */
export function deserialize(input: unknown): DeserializeResult {
  try {
    let data = input;
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input);
      } catch {
        return { ok: false, error: 'not valid JSON' };
      }
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'not an object' };
    const d = data as Record<string, unknown>;
    if (d.v !== FORMAT_VERSION) return { ok: false, error: `unsupported version: ${String(d.v)}` };
    if (!Array.isArray(d.pieces)) return { ok: false, error: 'pieces is not an array' };
    if (d.pieces.length > MAX_PIECES) return { ok: false, error: `too many pieces (max ${MAX_PIECES})` };
    const pieces: PlacedPiece[] = [];
    let dropped = 0;
    for (const raw of d.pieces) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { dropped++; continue; }
      const p = raw as Record<string, unknown>;
      if (typeof p.s !== 'string' || !KNOWN.has(p.s) || !isNum(p.x) || !isNum(p.y) || !isNum(p.r)
        || Math.abs(p.x) > MAX_COORD || Math.abs(p.y) > MAX_COORD) {
        dropped++;
        continue;
      }
      pieces.push({ shapeId: p.s, x: round1(p.x), y: round1(p.y), rotation: round2(normalise(p.r)) });
    }
    return { ok: true, pieces, dropped };
  } catch {
    return { ok: false, error: 'unreadable payload' };
  }
}
