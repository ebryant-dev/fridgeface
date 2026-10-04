import { describe, expect, it, vi } from 'vitest';
import {
  filenameFor, groupByWord, isSafeSuggestionFilename, isWord, isWordText, loadSuggestions, nextVariant, parseSuggestionFilename,
  parseWordFilename, splitSuggestions, SuggestionStore, suggestionFilename, suggestionText, toFileFor, toWordFile, validateSuggestion,
  wordFilename, wordFromSlug, wordSlug, type AnySuggestion,
} from './suggestions';
import { introPieces, introWordComposition } from './intro';

const piece = { s: 'positive-stem', x: 50, y: -100, r: 0 };
const word = (over: Record<string, unknown> = {}) => ({ v: 1, text: 'play', variant: 1, pieces: [piece], baseline: 0, ...over });
const letter = (over: Record<string, unknown> = {}) => ({ v: 1, char: 'a', variant: 1, pieces: [piece], baseline: 0, ...over });

describe('word file names', () => {
  it('encodes the documented examples', () => {
    expect(wordFilename('play', 1)).toBe('word-play-1.json');
    expect(wordFilename('Play', 1)).toBe('word-_x0050lay-1.json');
    expect(wordFilename('hi there', 1)).toBe('word-hi_x0020there-1.json');
    expect(wordFilename('h2o', 12)).toBe('word-h2o-12.json');
    expect(wordSlug('é!')).toBe('_x00e9_x0021');
    expect(wordSlug('a\u{1F600}')).toBe('a_xd83d_xde00'); // astral: its two UTF-16 code units
  });
  it('round-trips case, spaces, punctuation, digits and Unicode', () => {
    const texts = ['play', 'Play', 'PLAY', 'pLaY', 'hi there', 'a b c', "don't", 'rock-n-roll', 'a.b', '__', '_x0050', 'h2o', '99',
      'café', 'CAFÉ', 'café', 'straße', '中文', 'Ωmega', 'ok!', '?!', 'a\u{1F600}', '\u{1F600}\u{1F601}', 'x'.repeat(24)];
    for (const t of texts) {
      expect(isWordText(t), t).toBe(true);
      expect(wordFromSlug(wordSlug(t)), t).toBe(t);
      for (const v of [1, 7, 999]) expect(parseWordFilename(wordFilename(t, v)), t).toEqual({ text: t, variant: v });
    }
  });
  it('is safe on case-insensitive filesystems: names are all lowercase, so words differing only in case never collide', () => {
    const names = ['play', 'Play', 'PLAY', 'pLaY', 'plaY'].map((t) => wordFilename(t, 1));
    for (const n of names) expect(n).toBe(n.toLowerCase());
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });
  it('refuses words that are too short, too long or contain other whitespace or controls', () => {
    for (const bad of ['', 'a', 'x'.repeat(25), ' ab', 'ab ', 'a\tb', 'a\nb', 'a\u0000b', '́ab', 'a\ud800', 42, null]) {
      expect(isWordText(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(() => wordFilename('a', 1)).toThrow();
    expect(() => wordFilename('ab', 0)).toThrow();
    expect(isWordText('\u{1F600}'.repeat(24))).toBe(false); // its file name would be too long
  });
  it('rejects names it could not have produced, including path traversal and non-canonical spellings', () => {
    for (const bad of ['word-play.json', 'word--1.json', 'word-p-1.json', 'word-PLAY-1.json', 'word-play-0.json', 'word-play-01.json', 'word-play-1000.json',
      'word-_x0070lay-1.json', /* "p" spelled as an escape */ 'word-_X0050lay-1.json', 'word-_x0050LAY-1.json', 'word-_x00E9t-1.json',
      'word-pl_x002-1.json', 'word-pl_y0020ay-1.json', 'word-_xd83d-1.json', /* lone surrogate */ 'word-_x0020ab-1.json', /* leading space */
      'word-../play-1.json', '../word-play-1.json', 'word-play-1.json/', 'sub/word-play-1.json', 'word-pl/ay-1.json', 'word-pl.ay-1.json',
      'word-play-1.json.json', 'word-play-1.JSON', ' word-play-1.json', 'word-pl_x002fay-1.json/..', 'word-a_x002f_x002e_x002e-1.json\0']) {
      expect(isSafeSuggestionFilename(bad), bad).toBe(false);
    }
    expect(isSafeSuggestionFilename('word-play-1.json')).toBe(true);
    expect(isSafeSuggestionFilename('word-_x0050lay-1.json')).toBe(true);
    expect(isSafeSuggestionFilename('lower-a-1.json')).toBe(true); // letters unchanged
    expect(parseSuggestionFilename('word-play-1.json')).toBeNull(); // a word is never read as a letter
    expect(parseWordFilename('lower-a-1.json')).toBeNull();
    // A "/" inside a word is escaped, so it can never become a path separator.
    expect(wordFilename('a/b', 1)).toBe('word-a_x002fb-1.json');
  });
  it('filenameFor: one character is a letter, more is a word', () => {
    expect(filenameFor('s', 1)).toBe(suggestionFilename('s', 1));
    expect(filenameFor('S', 2)).toBe('upper-s-2.json');
    expect(filenameFor('so', 1)).toBe('word-so-1.json');
    expect(filenameFor('\u{1F600}', 1)).toBe('u1f600-1.json'); // one code point, two UTF-16 units: still a letter
  });
});

describe('word file validation', () => {
  it('accepts a word file and reports its canonical name', () => {
    const r = validateSuggestion(word(), 'word-play-1.json');
    expect(r.ok && r.value).toEqual({ text: 'play', variant: 1, filename: 'word-play-1.json', pieces: [{ shapeId: 'positive-stem', x: 50, y: -100, rotation: 0 }] });
    expect(r.ok && isWord(r.value)).toBe(true);
    expect(validateSuggestion(word({ text: 'Play' }), 'word-_x0050lay-1.json').ok).toBe(true);
  });
  it('rejects malformed word files', () => {
    const bads: unknown[] = [word({ char: 'p' }), word({ text: 'p' }), word({ text: '' }), word({ text: 'x'.repeat(25) }), word({ text: 5 }), word({ text: ' play' }),
      word({ text: undefined }), word({ variant: 0 }), word({ baseline: 1 }), word({ pieces: [] }), word({ v: 2 }), word({ pieces: [piece, 'x'] })];
    for (const b of bads) expect(validateSuggestion(b).ok, JSON.stringify(b)).toBe(false);
    expect(validateSuggestion(letter({ text: 'ab' })).ok).toBe(false); // both char and text
  });
  it('requires the file name to match the word, its case and the variant', () => {
    expect(validateSuggestion(word(), 'word-play-2.json').ok).toBe(false);
    expect(validateSuggestion(word({ text: 'Play' }), 'word-play-1.json').ok).toBe(false);
    expect(validateSuggestion(word(), 'lower-p-1.json').ok).toBe(false);
    expect(validateSuggestion(letter(), 'word-a-1.json').ok).toBe(false);
  });
  it('writes words with text and no char; letters exactly as before', () => {
    const pcs = [{ shapeId: 'positive-stem', x: 1.234, y: -5, rotation: 190 }];
    expect(toWordFile('play', 2, pcs)).toEqual({ v: 1, text: 'play', variant: 2, pieces: [{ s: 'positive-stem', x: 1.2, y: -5, r: -170 }], baseline: 0 });
    expect(Object.keys(toFileFor('play', 1, pcs))).toEqual(['v', 'text', 'variant', 'pieces', 'baseline']);
    expect(Object.keys(toFileFor('p', 1, pcs))).toEqual(['v', 'char', 'variant', 'pieces', 'baseline']);
    expect(validateSuggestion(toFileFor('hi there', 3, pcs), 'word-hi_x0020there-3.json').ok).toBe(true);
  });
  it('loads letters and words side by side, skipping a mis-named word file', () => {
    const warn = vi.fn();
    const out = loadSuggestions({
      './suggestions/lower-a-1.json': letter(),
      './suggestions/word-play-1.json': word(),
      './suggestions/word-play-2.json': word(), // says variant 1
      './suggestions/word-yay-1.json': word({ text: 'yay' }),
    }, warn);
    expect(out.map((s) => s.filename)).toEqual(['lower-a-1.json', 'word-play-1.json', 'word-yay-1.json']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('word-play-2.json');
  });
});

describe('grouping letters and words', () => {
  const L = (char: string, variant = 1): AnySuggestion => ({ char, variant, pieces: [], filename: suggestionFilename(char, variant) });
  const W = (text: string, variant = 1): AnySuggestion => ({ text, variant, pieces: [], filename: wordFilename(text, variant) });
  it('splits letters from words, keeping order', () => {
    const { letters, words } = splitSuggestions([W('play'), L('a'), W('hi'), L('b')]);
    expect(letters.map((s) => s.char)).toEqual(['a', 'b']);
    expect(words.map((s) => s.text)).toEqual(['play', 'hi']);
    expect(splitSuggestions([])).toEqual({ letters: [], words: [] });
  });
  it('groups words alphabetically (ignoring case first), variants ascending', () => {
    const { words } = splitSuggestions([W('play', 2), W('Zoo'), W('apple'), W('Play'), W('play', 1), W('hi there')]);
    const g = groupByWord(words);
    expect([...g.keys()]).toEqual(['apple', 'hi there', 'Play', 'play', 'Zoo']);
    expect(g.get('play')!.map((s) => s.variant)).toEqual([1, 2]);
  });
  it('numbers variants per letter or word, case-sensitively', () => {
    const list = [W('play'), W('play', 2), L('p'), W('Play')];
    expect(nextVariant(list, 'play')).toBe(3);
    expect(nextVariant(list, 'Play')).toBe(2);
    expect(nextVariant(list, 'p')).toBe(2);
    expect(nextVariant(list, 'hi')).toBe(1);
    expect(list.map(suggestionText)).toEqual(['play', 'play', 'p', 'Play']);
  });
  it('the store holds both kinds and finds either by text and variant', () => {
    const s = new SuggestionStore();
    s.setAll([L('p'), W('play')]);
    expect(s.get('play', 1)?.filename).toBe('word-play-1.json');
    expect(s.get('p', 1)?.filename).toBe('lower-p-1.json');
    s.remove('word-play-1.json');
    expect(s.get('play', 1)).toBeUndefined();
  });
});

describe('intro word', () => {
  const frame = { bbox: { x: 0, y: 0, w: 100, h: 200 }, centroid: { x: 50, y: 100 } };
  const shapeOf = (id: string) => (id === 'positive-stem' ? frame : undefined);
  const stem = (x: number) => ({ shapeId: 'positive-stem', x, y: -100, rotation: 0 });
  const letters = ['p', 'l', 'a', 'y'].map((char): AnySuggestion => ({ char, variant: 1, pieces: [stem(50)], filename: suggestionFilename(char, 1) }));
  const play: AnySuggestion = { text: 'play', variant: 1, pieces: [stem(50), stem(170), stem(260)], filename: 'word-play-1.json' };
  it('uses word-play-1 as-is when it exists', () => {
    expect(introWordComposition([...letters, play])).toEqual(play.pieces);
    expect(introPieces([...letters, play], shapeOf)).toEqual(play.pieces);
    expect(introPieces([play], shapeOf)).toEqual(play.pieces); // no letters needed
  });
  it('falls back to the letters p, l, a, y otherwise (variant 2 or another case does not count)', () => {
    const others: AnySuggestion[] = [{ ...play, variant: 2, filename: 'word-play-2.json' }, { ...play, text: 'Play', filename: 'word-_x0050lay-1.json' }];
    expect(introWordComposition([...letters, ...others])).toBeNull();
    expect(introPieces([...letters, ...others], shapeOf)).toHaveLength(4);
    expect(introPieces(others, shapeOf)).toBeNull();
  });
});
