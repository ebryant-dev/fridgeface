import { layoutWord, type ShapeLookup, type Suggestion } from './suggestions';
import type { PlacedPiece } from './serialize';

/** The first-visit intro spells this word from variant 1 of each letter. */
export const INTRO_WORD = 'play';
export const INTRO_VARIANT = 1;
/** One piece's slide, ms. */
export const INTRO_PIECE_MS = 700;
/** The whole intro (last piece's delay + its slide) never exceeds this, ms. */
export const INTRO_TOTAL_MS = 1500;
/** Longest gap between one piece starting and the next, ms. */
export const INTRO_MAX_STAGGER_MS = 80;

export interface IntroConditions {
  /** A valid auto-saved composition exists (even an empty one: the visitor has been here). */
  hasSavedComposition: boolean;
  hasShareLink: boolean;
  /** The host set the `no-intro` attribute. */
  disabled: boolean;
  /** Dev-only: the board is being used to build suggestions and wants to start empty. */
  skip?: boolean;
}

export function introWanted(c: IntroConditions): boolean {
  return !c.hasSavedComposition && !c.hasShareLink && !c.disabled && !c.skip;
}

/** Variant 1 of every letter of the word, or null when any is missing (then there is no intro). */
export function introConstructions(suggestions: readonly Suggestion[]): PlacedPiece[][] | null {
  const out: PlacedPiece[][] = [];
  for (const ch of INTRO_WORD) {
    const s = suggestions.find((x) => x.char === ch && x.variant === INTRO_VARIANT);
    if (!s) return null;
    out.push(s.pieces);
  }
  return out;
}

/** The word, laid out on one baseline from x = 0, or null when a letter is missing. */
export function introPieces(suggestions: readonly Suggestion[], shapeOf: ShapeLookup): PlacedPiece[] | null {
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
