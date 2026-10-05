import { describe, expect, it, vi } from 'vitest';
import { rotatedBounds } from './camera';
import {
  centreOn, charFromKey, charKey, groupByChar, isSafeSuggestionFilename, layoutWord, loadSuggestions, nextVariant,
  normaliseForSave, parseSuggestionFilename, SuggestionStore, suggestionFilename, toSuggestionFile, validateSuggestion,
  WORD_GAP, type Suggestion,
} from './suggestions';
import { introConstructions, introPieces, introSchedule, introWanted, INTRO_TOTAL_MS } from './intro';

const frame = { bbox: { x: 0, y: 0, w: 100, h: 200 }, centroid: { x: 50, y: 100 } };
const shapeOf = (id: string) => (id === 'positive-stem' ? frame : undefined);
const stem = (x: number, y: number, rotation = 0) => ({ shapeId: 'positive-stem', x, y, rotation });
const file = (over: Record<string, unknown> = {}) => ({ v: 1, char: 'a', variant: 1, pieces: [{ s: 'positive-stem', x: 50, y: -100, r: 0 }], baseline: 0, ...over });

describe('filenames', () => {
  it('maps characters to case-insensitive-safe names', () => {
    expect(suggestionFilename('a', 1)).toBe('lower-a-1.json');
    expect(suggestionFilename('A', 1)).toBe('upper-a-1.json');
    expect(suggestionFilename('7', 12)).toBe('digit-7-12.json');
    expect(suggestionFilename('!', 1)).toBe('u0021-1.json');
    expect(suggestionFilename('é', 2)).toBe('u00e9-2.json');
    expect(suggestionFilename('\u{1F600}', 1)).toBe('u1f600-1.json');
  });
  it('never differs only by case (a and A are different names that are not equal ignoring case)', () => {
    expect(suggestionFilename('a', 1).toLowerCase()).not.toBe(suggestionFilename('A', 1).toLowerCase());
  });
  it('round-trips every kind of character', () => {
    for (const ch of ['a', 'z', 'A', 'Z', '0', '9', '!', '&', 'é', 'É', 'ß', '中', '\u{1F600}']) {
      for (const v of [1, 2, 999]) {
        const name = suggestionFilename(ch, v);
        expect(parseSuggestionFilename(name)).toEqual({ char: ch, variant: v });
      }
      expect(charFromKey(charKey(ch))).toBe(ch);
    }
  });
  it('rejects names it could not have produced', () => {
    for (const bad of ['', 'a-1.json', 'lower-a-0.json', 'lower-a-01.json', 'lower-a-1000.json', 'lower-A-1.json', 'upper-a-1.JSON', 'u0061-1.json', 'u0041-1.json',
      'u0030-1.json', 'ud800-1.json', 'u110000-1.json', 'u0020-1.json', '../lower-a-1.json', 'lower-a-1.json/', 'lower-a-1.json\0', 'sub/lower-a-1.json', 'lower-a-1.json.json', ' lower-a-1.json']) {
      expect(isSafeSuggestionFilename(bad), bad).toBe(false);
    }
    expect(isSafeSuggestionFilename('lower-a-1.json')).toBe(true);
  });
  it('refuses characters that are not one letter, digit, punctuation or symbol', () => {
    for (const bad of ['', 'ab', ' ', '\n', '́', '\ud800']) expect(() => charKey(bad), JSON.stringify(bad)).toThrow();
    expect(() => suggestionFilename('a', 0)).toThrow();
    expect(() => suggestionFilename('a', 1.5)).toThrow();
  });
});

describe('validateSuggestion', () => {
  it('accepts a good file and reports its canonical name', () => {
    const r = validateSuggestion(file(), 'lower-a-1.json');
    expect(r.ok && r.value).toMatchObject({ char: 'a', variant: 1, filename: 'lower-a-1.json', pieces: [{ shapeId: 'positive-stem', x: 50, y: -100, rotation: 0 }] });
  });
  it('rejects anything malformed', () => {
    const bads: unknown[] = [null, [], 'x', file({ v: 2 }), file({ char: 'ab' }), file({ char: ' ' }), file({ variant: 0 }), file({ variant: '1' }), file({ baseline: 5 }),
      file({ baseline: undefined }), file({ pieces: [] }), file({ pieces: 'no' }), file({ pieces: [{ s: 'nope', x: 0, y: 0, r: 0 }] }),
      file({ pieces: [{ s: 'positive-stem', x: NaN, y: 0, r: 0 }] }), file({ pieces: [{ s: 'positive-stem', x: 0, y: 0, r: 0 }, 5] })];
    for (const b of bads) expect(validateSuggestion(b).ok, JSON.stringify(b)).toBe(false);
  });
  it('requires the file name to match the char and variant', () => {
    expect(validateSuggestion(file(), 'lower-b-1.json').ok).toBe(false);
    expect(validateSuggestion(file(), 'upper-a-1.json').ok).toBe(false);
    expect(validateSuggestion(file({ char: 'A' }), 'upper-a-1.json').ok).toBe(true);
  });
  it('round-trips through toSuggestionFile', () => {
    const f = toSuggestionFile('a', 3, [stem(1.234, -5, 190)]);
    expect(f).toEqual({ v: 1, char: 'a', variant: 3, pieces: [{ s: 'positive-stem', x: 1.2, y: -5, r: -170 }], baseline: 0 });
    expect(validateSuggestion(f, 'lower-a-3.json').ok).toBe(true);
  });
});

describe('loadSuggestions', () => {
  it('skips and warns about invalid files, and ignores a duplicate char + variant', () => {
    const warn = vi.fn();
    const out = loadSuggestions({ './suggestions/lower-a-1.json': file(), './suggestions/lower-b-1.json': file({ char: 'a' }), './suggestions/junk.json': { hello: 1 } }, warn);
    expect(out.map((s) => s.filename)).toEqual(['lower-a-1.json']);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('junk.json');
  });
  it('is empty and silent for no files', () => {
    const warn = vi.fn();
    expect(loadSuggestions({}, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('grouping', () => {
  const mk = (char: string, variant: number): Suggestion => ({ char, variant, pieces: [], filename: suggestionFilename(char, variant) });
  it('groups by char in display order, variants ascending', () => {
    const g = groupByChar([mk('y', 2), mk('7', 1), mk('A', 1), mk('!', 1), mk('a', 3), mk('y', 1), mk('a', 1)]);
    expect([...g.keys()]).toEqual(['a', 'y', 'A', '7', '!']);
    expect(g.get('a')!.map((s) => s.variant)).toEqual([1, 3]);
    expect(g.get('y')!.map((s) => s.variant)).toEqual([1, 2]);
  });
  it('suggests the next free variant', () => {
    expect(nextVariant([], 'a')).toBe(1);
    expect(nextVariant([mk('a', 1), mk('a', 2), mk('b', 1)], 'a')).toBe(3);
    expect(nextVariant([mk('a', 1), mk('a', 3)], 'a')).toBe(2);
    expect(nextVariant([mk('A', 1)], 'a')).toBe(1);
  });
  it('store: set, remove and notify', () => {
    const s = new SuggestionStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.set(mk('a', 1));
    s.set(mk('a', 1));
    expect(s.size).toBe(1);
    s.remove('lower-a-1.json');
    s.remove('lower-a-1.json');
    expect(s.size).toBe(0);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(s.get('a', 1)).toBeUndefined();
  });
});

describe('save and layout geometry', () => {
  it('normaliseForSave puts the leftmost rotated bound at x = 0 and leaves y alone', () => {
    const out = normaliseForSave([stem(300, -100), stem(500, 40)], shapeOf);
    expect(rotatedBounds(out, shapeOf)!.x).toBeCloseTo(0, 6);
    expect(out.map((p) => p.y)).toEqual([-100, 40]);
    expect(out[1].x - out[0].x).toBe(200);
  });
  it('uses the ROTATED bound: a quarter turn makes a 100x200 piece 200 wide', () => {
    const out = normaliseForSave([stem(0, 0, 90)], shapeOf);
    expect(out[0].x).toBeCloseTo(100, 6); // half of the rotated width 200
    expect(normaliseForSave([], shapeOf)).toEqual([]);
  });
  it('centreOn centres the bounds on a point', () => {
    const out = centreOn([stem(10, 10), stem(310, 10)], shapeOf, { x: 1000, y: 500 });
    const b = rotatedBounds(out, shapeOf)!;
    expect(b.x + b.w / 2).toBeCloseTo(1000, 6);
    expect(b.y + b.h / 2).toBeCloseTo(500, 6);
  });
  it('layoutWord places constructions left to right, a gap apart, on a shared baseline', () => {
    const a = normaliseForSave([stem(50, -100)], shapeOf); // 100 wide, y centre -100 (stands on the baseline)
    const b = normaliseForSave([stem(120, 0), stem(240, 0, 90)], shapeOf); // wider; hangs below the baseline
    const { pieces, bounds } = layoutWord([a, b, a], shapeOf);
    expect(pieces).toHaveLength(4);
    const bw = rotatedBounds(b, shapeOf)!.w;
    const xs = [0, 100 + WORD_GAP, 100 + WORD_GAP + bw + WORD_GAP];
    expect(rotatedBounds([pieces[0]], shapeOf)!.x).toBeCloseTo(xs[0], 6);
    expect(rotatedBounds([pieces[1], pieces[2]], shapeOf)!.x).toBeCloseTo(xs[1], 6);
    expect(rotatedBounds([pieces[3]], shapeOf)!.x).toBeCloseTo(xs[2], 6);
    expect(pieces.map((p) => p.y)).toEqual([-100, 0, 0, -100]); // y never changes: one baseline
    expect(bounds!.x).toBeCloseTo(0, 6);
    expect(bounds!.w).toBeCloseTo(xs[2] + 100, 6);
  });
  it('layoutWord honours a custom gap and skips empty constructions', () => {
    const a = normaliseForSave([stem(50, 0)], shapeOf);
    const { pieces } = layoutWord([a, [], a], shapeOf, 10);
    expect(pieces.map((p) => p.x)).toEqual([50, 160]);
    expect(layoutWord([], shapeOf)).toEqual({ pieces: [], bounds: null });
  });
});

describe('intro', () => {
  const sug = (char: string): Suggestion => ({ char, variant: 1, pieces: normaliseForSave([stem(50, -100)], shapeOf), filename: suggestionFilename(char, 1) });
  it('needs all of p, l, a, y (variant 1)', () => {
    expect(introConstructions([])).toBeNull();
    expect(introConstructions([sug('p'), sug('l'), sug('a')])).toBeNull();
    expect(introConstructions([{ ...sug('y'), variant: 2 }, sug('p'), sug('l'), sug('a')])).toBeNull();
    expect(introConstructions([sug('y'), sug('a'), sug('l'), sug('p')])).toHaveLength(4);
    expect(introPieces([sug('p'), sug('l'), sug('a'), sug('y')], shapeOf)).toHaveLength(4);
  });
  it('is off by default (v1.2.0); opted in, it plays only on a first visit, with no share link, no no-intro, and not when skipped', () => {
    const base = { enabled: true, hasSavedComposition: false, hasShareLink: false, disabled: false };
    expect(introWanted({ ...base, enabled: false }), 'off unless the host sets the intro attribute').toBe(false);
    expect(introWanted(base)).toBe(true);
    expect(introWanted({ ...base, hasSavedComposition: true })).toBe(false);
    expect(introWanted({ ...base, hasShareLink: true })).toBe(false);
    expect(introWanted({ ...base, disabled: true })).toBe(false);
    expect(introWanted({ ...base, skip: true })).toBe(false);
  });
  it('schedules every piece inside the total budget', () => {
    for (const n of [0, 1, 2, 4, 19, 20, 21, 60, 500]) {
      const s = introSchedule(n);
      expect(s.delays).toHaveLength(n);
      expect(s.total).toBeLessThanOrEqual(INTRO_TOTAL_MS);
      expect([...s.delays].sort((a, b) => a - b)).toEqual(s.delays);
    }
    expect(introSchedule(1)).toEqual({ delays: [0], duration: 700, total: 700 });
  });
});
