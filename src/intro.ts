import { isWord, layoutWord, type AnySuggestion, type ShapeLookup } from './suggestions';
import type { PlacedPiece } from './serialize';

/**
 * The "play" intro is set aside (v1.2.0): it is OFF by default, so the toy starts on a blank board. A host opts in with the
 * `intro` attribute on <fridge-face>. When on, a first visit shows this word: the word composition `word-play-1.json` as it was built, when it exists;
 * otherwise variant 1 of each letter, set side by side (the fallback).
 */
export const INTRO_WORD = 'play';
export const INTRO_VARIANT = 1;
/** One piece's slide, ms. */
export const INTRO_PIECE_MS = 700;
/** The whole intro (last piece's delay + its slide) never exceeds this, ms. */
export const INTRO_TOTAL_MS = 1500;
/** Longest gap between one piece starting and the next, ms. */
export const INTRO_MAX_STAGGER_MS = 80;

export interface IntroConditions {
  /** The host opted in with the `intro` attribute (off by default since v1.2.0). */
  enabled: boolean;
  /** A valid auto-saved composition exists (even an empty one: the visitor has been here). */
  hasSavedComposition: boolean;
  hasShareLink: boolean;
  /** The host set the `no-intro` attribute. */
  disabled: boolean;
  /** Dev-only: the board is being used to build suggestions and wants to start empty. */
  skip?: boolean;
}

export function introWanted(c: IntroConditions): boolean {
  return c.enabled && !c.hasSavedComposition && !c.hasShareLink && !c.disabled && !c.skip;
}

/** The word composition for the intro word (variant 1), if there is one. */
export function introWordComposition(suggestions: readonly AnySuggestion[]): PlacedPiece[] | null {
  const w = suggestions.find((x) => isWord(x) && x.text === INTRO_WORD && x.variant === INTRO_VARIANT);
  return w && w.pieces.length ? w.pieces : null;
}

/** Variant 1 of every letter of the word, or null when any is missing. */
export function introConstructions(suggestions: readonly AnySuggestion[]): PlacedPiece[][] | null {
  const out: PlacedPiece[][] = [];
  for (const ch of INTRO_WORD) {
    const s = suggestions.find((x) => !isWord(x) && x.char === ch && x.variant === INTRO_VARIANT);
    if (!s) return null;
    out.push(s.pieces);
  }
  return out;
}

/**
 * The intro's pieces: the word composition as-is when it exists, else the letters laid out on one baseline from x = 0;
 * null when neither is available (then there is no intro). The component frames the result, so either is centred.
 */
export function introPieces(suggestions: readonly AnySuggestion[], shapeOf: ShapeLookup): PlacedPiece[] | null {
  const word = introWordComposition(suggestions);
  if (word) return word.map((p) => ({ ...p }));
  const parts = introConstructions(suggestions);
  if (!parts) return null;
  const { pieces } = layoutWord(parts, shapeOf);
  return pieces.length ? pieces : null;
}

/** Start delay per piece (in stacking order) and the whole thing's length. Total is always <= INTRO_TOTAL_MS. */
export function introSchedule(count: number): { delays: number[]; duration: number; total: number } {
  const duration = INTRO_PIECE_MS;
  const stagger = count > 1 ? Math.min(INTRO_MAX_STAGGER_MS, (INTRO_TOTAL_MS - duration) / (count - 1)) : 0;
  const delays = Array.from({ length: count }, (_, i) => Math.round(i * stagger));
  return { delays, duration, total: count ? delays[count - 1] + duration : 0 };
}
