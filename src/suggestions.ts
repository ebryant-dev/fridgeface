import { rotatedBounds, type Rect } from './camera.ts';
import { deserialize, FORMAT_VERSION, serialize, type PlacedPiece, type SerializedPiece } from './serialize.ts';

/**
 * Suggestions (pure, no DOM). A suggestion is ONE way to build a letter or a word: there is never a single correct
 * construction, so each letter or word can have any number of numbered variants.
 *
 * One JSON file per suggestion in `src/suggestions/`. A letter:
 *
 *   { "v": 1, "char": "a", "variant": 1, "pieces": [{ "s", "x", "y", "r" }, ...], "baseline": 0 }
 *
 * A word composition (a whole word built as ONE composition, 2 to 24 characters) has `text` instead of `char`;
 * a file with both, or neither, is invalid:
 *
 *   { "v": 1, "text": "play", "variant": 1, "pieces": [...], "baseline": 0 }
 *
 * The letter format is unchanged, so older readers still load every letter file and skip word files with a warning.
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
export interface WordFile {
  v: typeof SUGGESTION_VERSION;
  text: string;
  variant: number;
  pieces: SerializedPiece[];
  baseline: 0;
}
/** A letter suggestion. */
export interface Suggestion {
  char: string;
  variant: number;
  pieces: PlacedPiece[];
  /** The file name this was loaded from (or would be saved to). */
  filename: string;
  text?: undefined;
}
/** A word composition suggestion: the whole word as one composition. */
export interface WordSuggestion {
  text: string;
  variant: number;
  pieces: PlacedPiece[];
  filename: string;
  char?: undefined;
}
export type AnySuggestion = Suggestion | WordSuggestion;

export const isWord = (s: AnySuggestion): s is WordSuggestion => typeof s.text === 'string';
/** The letter or the word a suggestion builds. */
export const suggestionText = (s: AnySuggestion): string => (isWord(s) ? s.text : s.char);
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

// ---- word compositions: `word-<slug>-<variant>.json` -------------------------------------------------------------------

export const WORD_MIN = 2;
export const WORD_MAX = 24;
/** Longest file name a word may produce (filesystems allow 255 bytes; the name is plain ASCII). */
export const MAX_FILENAME = 255;

/**
 * The characters of a word: 2 to 24 code points, each a letter, number, punctuation, symbol, combining mark (not
 * first) or a plain space (not first or last). Its file name must also fit (only very long runs of emoji fail that).
 */
export function isWordText(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const cps = [...s];
  if (cps.length < WORD_MIN || cps.length > WORD_MAX) return false;
  if (!/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(cps[0]) || cps[cps.length - 1] === ' ') return false;
  if (!cps.every((c) => /^[\p{L}\p{N}\p{P}\p{S}\p{M} ]$/u.test(c))) return false;
  return `word-${wordSlug(s)}-999.json`.length <= MAX_FILENAME;
}

/**
 * Reversible, case-safe slug: lowercase a-z and 0-9 stay as they are; every other UTF-16 code unit becomes `_x` + four
 * lowercase hex digits ("Play" -> "_x0050lay", "hi there" -> "hi_x0020there", an emoji -> two escapes). The result
 * contains only lowercase letters, digits and "_", so two different words can never differ only by case.
 */
export function wordSlug(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out += /[a-z0-9]/.test(c) ? c : `_x${text.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return out;
}

/** The word a slug stands for, or null when the slug is not exactly what wordSlug produces for a valid word. */
export function wordFromSlug(slug: string): string | null {
  if (!/^(?:[a-z0-9]|_x[0-9a-f]{4})+$/.test(slug)) return null;
  const text = slug.replace(/_x([0-9a-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return isWordText(text) /* also refuses a lone surrogate */ && wordSlug(text) === slug ? text : null; // canonical: "_x0061" is not another spelling of "a"
}

export function wordFilename(text: string, variant: number): string {
  if (!isWordText(text)) throw new Error(`a word is ${WORD_MIN} to ${WORD_MAX} characters`);
  if (!isVariant(variant)) throw new Error('variant must be a whole number from 1 to ' + MAX_VARIANT);
  return `word-${wordSlug(text)}-${variant}.json`;
}

export function parseWordFilename(name: string): { text: string; variant: number } | null {
  const m = /^word-([a-z0-9_]+)-([1-9][0-9]{0,2})\.json$/.exec(name);
  if (!m || name.length > MAX_FILENAME) return null;
  const text = wordFromSlug(m[1]);
  const variant = Number(m[2]);
  return text !== null && isVariant(variant) ? { text, variant } : null;
}

/** One character: a letter suggestion's file name; 2 to 24: a word composition's. */
export function filenameFor(text: string, variant: number): string {
  return [...text].length === 1 ? suggestionFilename(text, variant) : wordFilename(text, variant);
}

/** A safe suggestion file name (no path separators, dots or anything else): exactly what suggestionFilename or wordFilename can produce. */
export const isSafeSuggestionFilename = (name: unknown): name is string =>
  typeof name === 'string' && (parseSuggestionFilename(name) !== null || parseWordFilename(name) !== null);

// ---- validation -------------------------------------------------------------------------------------------------------

/**
 * Strict check of a parsed suggestion file. Uses the composition rules (`deserialize`): a bad piece makes the whole
 * suggestion invalid (nobody wants a letter with a piece missing), and so does an empty one.
 * When `filename` is given it must be the canonical name for the char and variant.
 */
export function validateSuggestion(raw: unknown, filename?: string): ParseResult<AnySuggestion> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'not an object' };
  const d = raw as Record<string, unknown>;
  if (d.v !== SUGGESTION_VERSION) return { ok: false, error: `unsupported version: ${String(d.v)}` };
  const word = 'text' in d;
  if (word && 'char' in d) return { ok: false, error: 'has both char and text' };
  if (word ? !isWordText(d.text) : !isSuggestionChar(d.char)) {
    return { ok: false, error: word ? `text is not a word of ${WORD_MIN} to ${WORD_MAX} characters` : 'char is not a single character' };
  }
  if (!isVariant(d.variant)) return { ok: false, error: 'variant is not a whole number from 1 to ' + MAX_VARIANT };
  if (d.baseline !== 0) return { ok: false, error: 'baseline must be 0' };
  const r = deserialize({ v: FORMAT_VERSION, pieces: d.pieces });
  if (!r.ok) return { ok: false, error: r.error };
  if (r.dropped > 0) return { ok: false, error: `${r.dropped} invalid piece(s)` };
  if (!r.pieces.length) return { ok: false, error: 'no pieces' };
  const want = word ? wordFilename(d.text as string, d.variant) : suggestionFilename(d.char as string, d.variant);
  if (filename !== undefined && filename !== want) return { ok: false, error: `file name should be ${want}` };
  return {
    ok: true,
    value: word
      ? { text: d.text as string, variant: d.variant, pieces: r.pieces, filename: want }
      : { char: d.char as string, variant: d.variant, pieces: r.pieces, filename: want },
  };
}

/** The JSON object saved for a letter suggestion. */
export function toSuggestionFile(char: string, variant: number, pieces: readonly PlacedPiece[]): SuggestionFile {
  return { v: SUGGESTION_VERSION, char, variant, pieces: serialize(pieces).pieces, baseline: 0 };
}

/** The JSON object saved for a word composition. */
export function toWordFile(text: string, variant: number, pieces: readonly PlacedPiece[]): WordFile {
  return { v: SUGGESTION_VERSION, text, variant, pieces: serialize(pieces).pieces, baseline: 0 };
}

/** One character: a letter file; 2 to 24: a word file. */
export function toFileFor(text: string, variant: number, pieces: readonly PlacedPiece[]): SuggestionFile | WordFile {
  return [...text].length === 1 ? toSuggestionFile(text, variant, pieces) : toWordFile(text, variant, pieces);
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

/** Letters and word compositions, apart (each in the order given). */
export function splitSuggestions(list: readonly AnySuggestion[]): { letters: Suggestion[]; words: WordSuggestion[] } {
  const letters: Suggestion[] = [];
  const words: WordSuggestion[] = [];
  for (const s of list) {
    if (isWord(s)) words.push(s);
    else letters.push(s);
  }
  return { letters, words };
}

/** Word compositions grouped by word (alphabetical ignoring case, then by code point), variants ascending. */
export function groupByWord(list: readonly WordSuggestion[]): Map<string, WordSuggestion[]> {
  const by = new Map<string, WordSuggestion[]>();
  for (const s of list) (by.get(s.text) ?? by.set(s.text, []).get(s.text)!).push(s);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const keys = [...by.keys()].sort((a, b) => cmp(a.toLowerCase(), b.toLowerCase()) || cmp(a, b));
  return new Map(keys.map((k) => [k, by.get(k)!.sort((a, b) => a.variant - b.variant)]));
}

/** The smallest unused variant number for a character or a word (1 when there are none). */
export function nextVariant(list: readonly AnySuggestion[], char: string): number {
  const used = new Set(list.filter((s) => suggestionText(s) === char).map((s) => s.variant));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * Turn the modules of an eager `import.meta.glob('./suggestions/*.json')` into suggestions. Invalid files are skipped
 * with a console warning; so is a second file for a char and variant that is already taken.
 */
export function loadSuggestions(modules: Record<string, unknown>, warn: (msg: string) => void = (m) => console.warn(m)): AnySuggestion[] {
  const out: AnySuggestion[] = [];
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

/** The live set of suggestions (letters and words). Components subscribe; the dev-only author mode and hot reload replace entries. */
export class SuggestionStore {
  private byFile = new Map<string, AnySuggestion>();
  private listeners = new Set<() => void>();

  get list(): readonly AnySuggestion[] {
    return [...this.byFile.values()];
  }
  get size(): number {
    return this.byFile.size;
  }
  /** A letter (one character) or a word composition (2 to 24) by its text and variant. */
  get(text: string, variant: number): AnySuggestion | undefined {
    return this.byFile.get(filenameFor(text, variant));
  }
  setAll(list: readonly AnySuggestion[]) {
    this.byFile = new Map(list.map((s) => [s.filename, s]));
    this.emit();
  }
  set(s: AnySuggestion) {
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
