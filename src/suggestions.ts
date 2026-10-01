import { rotatedBounds, type Rect } from './camera.ts';
import { deserialize, FORMAT_VERSION, serialize, type PlacedPiece, type SerializedPiece } from './serialize.ts';

/**
 * Letter suggestions (pure, no DOM). A Suggestion is ONE way to build a character: there is never a single
 * correct construction, so a character can have any number of numbered variants.
 *
 * One JSON file per suggestion in `src/suggestions/`:
 *
 *   { "v": 1, "char": "a", "variant": 1, "pieces": [{ "s", "x", "y", "r" }, ...], "baseline": 0 }
 *
 * `pieces` use the composition wire format (serialize.ts). Coordinates are relative to an origin ON THE
 * BASELINE at the construction's LEFT edge: the leftmost rotated bound sits at x = 0, and y = 0 is the baseline
 * (letters stand on it, so descenders have positive y and ascenders negative y; the board's y axis points down).
 */
export const SUGGESTION_VERSION = FORMAT_VERSION;
export const MAX_VARIANT = 999;

/** Space between neighbouring letters in a laid-out word, in board units: about one stem width (a positive stem is ~52 wide). */
export const WORD_GAP = 60;

export interface SuggestionFile {
  v: typeof SUGGESTION_VERSION;
  char: string;
  variant: number;
  pieces: SerializedPiece[];
  baseline: 0;
}
export interface Suggestion {
  char: string;
  variant: number;
  pieces: PlacedPiece[];
  /** The file name this was loaded from (or would be saved to). */
  filename: string;
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---- filenames: safe on case-insensitive filesystems (macOS) ----------------------------------------------------------

/** One code point that is a letter, number, punctuation or symbol (no whitespace, controls or lone marks). */
export function isSuggestionChar(s: unknown): s is string {
  return typeof s === 'string' && [...s].length === 1 && /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(s);
}

/** `a` -> `lower-a`, `A` -> `upper-a`, `7` -> `digit-7`, anything else -> `u` + code point in hex (`u0021`). */
export function charKey(char: string): string {
  if (!isSuggestionChar(char)) throw new Error('not a single character');
  if (/^[a-z]$/.test(char)) return `lower-${char}`;
  if (/^[A-Z]$/.test(char)) return `upper-${char.toLowerCase()}`;
  if (/^[0-9]$/.test(char)) return `digit-${char}`;
  return `u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`;
}

export function charFromKey(key: string): string | null {
  let m = /^(lower|upper)-([a-z])$/.exec(key);
  if (m) return m[1] === 'lower' ? m[2] : m[2].toUpperCase();
  m = /^digit-([0-9])$/.exec(key);
  if (m) return m[1];
  m = /^u([0-9a-f]{4,6})$/.exec(key);
  if (m) {
    const cp = parseInt(m[1], 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    const ch = String.fromCodePoint(cp);
    // A letter, digit or ASCII character has its own key; a second spelling is not a valid file name.
    return isSuggestionChar(ch) && charKey(ch) === key ? ch : null;
  }
  return null;
}

export const isVariant = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_VARIANT;

export function suggestionFilename(char: string, variant: number): string {
  if (!isVariant(variant)) throw new Error('variant must be a whole number from 1 to ' + MAX_VARIANT);
  return `${charKey(char)}-${variant}.json`;
}

export function parseSuggestionFilename(name: string): { char: string; variant: number } | null {
  const m = /^(.+)-([1-9][0-9]{0,2})\.json$/.exec(name);
  if (!m) return null;
  const char = charFromKey(m[1]);
  const variant = Number(m[2]);
  return char !== null && isVariant(variant) ? { char, variant } : null;
}

/** A safe suggestion file name (no path separators, dots or anything else): exactly what suggestionFilename can produce. */
export const isSafeSuggestionFilename = (name: unknown): name is string => typeof name === 'string' && parseSuggestionFilename(name) !== null;

// ---- validation -------------------------------------------------------------------------------------------------------

/**
 * Strict check of a parsed suggestion file. Uses the composition rules (`deserialize`): a bad piece makes the whole
 * suggestion invalid (nobody wants a letter with a piece missing), and so does an empty one.
 * When `filename` is given it must be the canonical name for the char and variant.
 */
export function validateSuggestion(raw: unknown, filename?: string): ParseResult<Suggestion> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'not an object' };
  const d = raw as Record<string, unknown>;
  if (d.v !== SUGGESTION_VERSION) return { ok: false, error: `unsupported version: ${String(d.v)}` };
  if (!isSuggestionChar(d.char)) return { ok: false, error: 'char is not a single character' };
  if (!isVariant(d.variant)) return { ok: false, error: 'variant is not a whole number from 1 to ' + MAX_VARIANT };
  if (d.baseline !== 0) return { ok: false, error: 'baseline must be 0' };
  const r = deserialize({ v: FORMAT_VERSION, pieces: d.pieces });
  if (!r.ok) return { ok: false, error: r.error };
  if (r.dropped > 0) return { ok: false, error: `${r.dropped} invalid piece(s)` };
  if (!r.pieces.length) return { ok: false, error: 'no pieces' };
  const want = suggestionFilename(d.char, d.variant);
  if (filename !== undefined && filename !== want) return { ok: false, error: `file name should be ${want}` };
  return { ok: true, value: { char: d.char, variant: d.variant, pieces: r.pieces, filename: want } };
}

/** The JSON object saved for a suggestion. */
export function toSuggestionFile(char: string, variant: number, pieces: readonly PlacedPiece[]): SuggestionFile {
  return { v: SUGGESTION_VERSION, char, variant, pieces: serialize(pieces).pieces, baseline: 0 };
}

// ---- geometry ---------------------------------------------------------------------------------------------------------

export type ShapeFrame = { bbox: Rect; centroid: { x: number; y: number } };
export type ShapeLookup = (id: string) => ShapeFrame | undefined;

const shift = (pieces: readonly PlacedPiece[], dx: number, dy: number): PlacedPiece[] =>
  pieces.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

/**
 * Re-express a composition for saving: shift it sideways so its leftmost ROTATED bound sits at x = 0.
 * y is untouched: it is already measured from the baseline (board y = 0).
 */
export function normaliseForSave(pieces: readonly PlacedPiece[], shapeOf: ShapeLookup): PlacedPiece[] {
  const b = rotatedBounds(pieces, shapeOf);
  return b ? shift(pieces, -b.x, 0) : [];
}

/** Move pieces rigidly so the centre of their rotated bounds lands on `target`. */
export function centreOn(pieces: readonly PlacedPiece[], shapeOf: ShapeLookup, target: { x: number; y: number }): PlacedPiece[] {
  const b = rotatedBounds(pieces, shapeOf);
  return b ? shift(pieces, target.x - (b.x + b.w / 2), target.y - (b.y + b.h / 2)) : [];
}

/**
 * Lay letter constructions out left to right on one shared baseline (board y = 0). Each construction keeps its own
 * y; its left edge goes where the previous one ended plus `gap`. The word starts at x = 0.
 */
export function layoutWord(
  constructions: readonly (readonly PlacedPiece[])[],
  shapeOf: ShapeLookup,
  gap: number = WORD_GAP,
): { pieces: PlacedPiece[]; bounds: Rect | null } {
  const out: PlacedPiece[] = [];
  let cursor = 0;
  for (const c of constructions) {
    const b = rotatedBounds(c, shapeOf);
    if (!b) continue;
    out.push(...shift(c, cursor - b.x, 0));
    cursor += b.w + gap;
  }
  return { pieces: out, bounds: rotatedBounds(out, shapeOf) };
}

// ---- collections ------------------------------------------------------------------------------------------------------

const categoryOf = (ch: string): number => (/[a-z]/.test(ch) ? 0 : /[A-Z]/.test(ch) ? 1 : /[0-9]/.test(ch) ? 2 : 3);

/** Characters in display order: a-z, A-Z, 0-9, then everything else by code point. */
export function sortChars(chars: Iterable<string>): string[] {
  return [...chars].sort((a, b) => categoryOf(a) - categoryOf(b) || a.codePointAt(0)! - b.codePointAt(0)!);
}

/** Suggestions grouped by character, variants in ascending order. Map order is display order. */
export function groupByChar(list: readonly Suggestion[]): Map<string, Suggestion[]> {
  const by = new Map<string, Suggestion[]>();
  for (const s of list) (by.get(s.char) ?? by.set(s.char, []).get(s.char)!).push(s);
  const out = new Map<string, Suggestion[]>();
  for (const ch of sortChars(by.keys())) out.set(ch, by.get(ch)!.sort((a, b) => a.variant - b.variant));
  return out;
}

/** The smallest unused variant number for a character (1 when there are none). */
export function nextVariant(list: readonly Suggestion[], char: string): number {
  const used = new Set(list.filter((s) => s.char === char).map((s) => s.variant));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * Turn the modules of an eager `import.meta.glob('./suggestions/*.json')` into suggestions. Invalid files are skipped
 * with a console warning; so is a second file for a char and variant that is already taken.
 */
export function loadSuggestions(modules: Record<string, unknown>, warn: (msg: string) => void = (m) => console.warn(m)): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const path of Object.keys(modules).sort()) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const r = validateSuggestion(modules[path], name);
    if (!r.ok) {
      warn(`fridgeface: skipping suggestion ${name} (${r.error})`);
      continue;
    }
    if (seen.has(r.value.filename)) continue;
    seen.add(r.value.filename);
    out.push(r.value);
  }
  return out;
}

/** The live set of suggestions. Components subscribe; the dev-only author mode and hot reload replace entries. */
export class SuggestionStore {
  private byFile = new Map<string, Suggestion>();
  private listeners = new Set<() => void>();

  get list(): readonly Suggestion[] {
    return [...this.byFile.values()];
  }
  get size(): number {
    return this.byFile.size;
  }
  get(char: string, variant: number): Suggestion | undefined {
    return this.byFile.get(suggestionFilename(char, variant));
  }
  setAll(list: readonly Suggestion[]) {
    this.byFile = new Map(list.map((s) => [s.filename, s]));
    this.emit();
  }
  set(s: Suggestion) {
    this.byFile.set(s.filename, s);
    this.emit();
  }
  remove(filename: string) {
    if (this.byFile.delete(filename)) this.emit();
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of [...this.listeners]) fn();
  }
}
