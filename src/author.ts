/**
 * DEV-ONLY author mode (`/?author` on the dev server). Imported dynamically behind `import.meta.env.DEV`, so it is
 * not part of any production build. It adds a baseline guide to the board and a panel for saving, loading and
 * deleting suggestions (letters, and word compositions) through the dev-server middleware (dev/author-server.ts).
 * One character in Text saves a letter; 2 to 24 save a word composition. The baseline guide is the same for both.
 */
import { AUTHOR_ROUTE } from '../dev/route';
import type { Camera } from './camera';
import type { PlacedPiece } from './serialize';
import { SHAPES } from './shapes';
import {
  filenameFor, groupByChar, groupByWord, isSuggestionChar, isVariant, isWordText, nextVariant, normaliseForSave, splitSuggestions,
  suggestionText, toFileFor, validateSuggestion, WORD_MAX, WORD_MIN, type ShapeLookup, type SuggestionStore,
} from './suggestions';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The faint x-height guide: the height of ONE positive round standing upright (about two thirds of a positive stem,
 * the usual lowercase-to-ascender ratio). A lowercase letter built from rounds should top out on this line; a stem
 * letter (l, d, b...) rises above it. It is only a guide for consistency, never a rule.
 */
export const X_HEIGHT = SHAPES.find((s) => s.id === 'positive-round')!.uprightBox.h;
/** Baseline extent: far enough that it spans any sensible view. */
const GUIDE_REACH = 100_000;

export interface AuthorHost {
  boardEl: HTMLElement;
  cameraEl: SVGGElement;
  piecesLayer: SVGGElement;
  root: ShadowRoot;
  /** CSS px per board unit at zoom 1. */
  scale(): number;
  view(): Camera;
  /** Called after every camera change. */
  onView(fn: () => void): void;
  pieces(): PlacedPiece[];
  /** Replace the board with these pieces as one undoable step, keeping the view. */
  loadPieces(pieces: PlacedPiece[]): void;
  /** Show the baseline origin comfortably in view. */
  showBaseline(): void;
  say(text: string): void;
  shapeOf: ShapeLookup;
  store: SuggestionStore;
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const CSS = `
.author { position: absolute; top: calc(10px + var(--sat, 0px)); left: calc(10px + var(--sal, 0px)); z-index: 6; width: 284px; max-width: calc(100% - 20px); max-height: calc(100% - 96px);
  display: flex; flex-direction: column; box-sizing: border-box; padding: 0; gap: 0; align-items: stretch; flex-wrap: nowrap; }
.author .ahead { display: flex; align-items: center; justify-content: space-between; padding: 2px 2px 2px 12px; border-bottom: 2px solid var(--ink); }
.author h2 { margin: 0; font: 700 13px/1.2 var(--font); letter-spacing: 0.1em; text-transform: uppercase; }
.author .abody { overflow: auto; padding: 8px 10px 10px; touch-action: pan-y; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 8px; }
.author[data-collapsed] .abody { display: none; }
.author label { display: flex; flex-direction: column; gap: 3px; font: 700 11px/1 var(--font); letter-spacing: 0.1em; text-transform: uppercase; }
.author input { -webkit-user-select: text; user-select: text; box-sizing: border-box; min-height: 40px; font: 500 18px/1 var(--font); padding: 0 8px; border: 2px solid var(--ink); border-radius: 0; color: var(--ink); background: var(--paper); text-transform: none; letter-spacing: normal; }
.author input:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.author p { margin: 0; font: 500 12px/1.35 var(--font); }
.author .astatus { min-height: 1.35em; font-weight: 700; }
.author .arow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.author .arow[hidden], .author .alist li .confirm[hidden] { display: none; }
.author h3 { margin: 4px 0 0; font: 700 11px/1 var(--font); letter-spacing: 0.1em; text-transform: uppercase; }
.author ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.author li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; border-bottom: 1px solid #d0d0d0; padding-bottom: 4px; font: 500 12px/1.2 var(--font); }
.author li .name { flex: 1 1 100%; font-family: ui-monospace, monospace; }
.author li button.b, .author .arow button.b { min-height: 36px; min-width: 36px; padding: 0 8px; font-size: 11px; }
`;

/** Spell out the case so a capital can't be saved by accident unnoticed. */
const caseLabel = (ch: string): string =>
  /[a-z]/.test(ch) ? `lowercase ${ch}` : /[A-Z]/.test(ch) ? `capital ${ch}` : `"${ch}"`;

/** "lowercase s" for a letter, `word "play"` for a word composition. */
const whatLabel = (text: string): string => ([...text].length === 1 ? caseLabel(text) : `word "${text}"`);

/** One character (a letter) or 2 to 24 (a word composition). */
const isAuthorText = (t: string): boolean => isSuggestionChar(t) || isWordText(t);

export function mountAuthor(host: AuthorHost): void {
  const { store, boardEl } = host;

  // ---- guide: baseline, origin mark, x-height ----
  const guide = el('g', { 'data-guide': '', 'pointer-events': 'none', 'aria-hidden': 'true' });
  const ink = { stroke: '#000', fill: 'none', 'vector-effect': 'non-scaling-stroke' };
  guide.append(
    el('line', { ...ink, x1: String(-GUIDE_REACH), x2: String(GUIDE_REACH), y1: '0', y2: '0', 'stroke-width': '1.5', 'stroke-opacity': '0.75' }),
    el('line', { ...ink, x1: String(-GUIDE_REACH), x2: String(GUIDE_REACH), y1: String(-X_HEIGHT), y2: String(-X_HEIGHT), 'stroke-width': '1', 'stroke-opacity': '0.28', 'stroke-dasharray': '6 5' }),
  );
  const label = (text: string, x: number, y: number) => {
    const t = el('text', { x: String(x), y: String(y), style: 'font:700 10px/1 var(--font);letter-spacing:0.1em;text-transform:uppercase;fill:#000;fill-opacity:0.55' });
    t.textContent = text;
    return t;
  };
  // Screen-sized marks (counter-scaled by zoom): the origin at x = 0 on the baseline, and the x-height label.
  const origin = el('g', {});
  origin.append(
    el('path', { ...ink, d: 'M0 -18V6M-6 0H6', 'stroke-width': '1.5' }),
    el('circle', { ...ink, r: '4', 'stroke-width': '1.5' }),
    label('baseline', 10, 14),
  );
  const xh = el('g', {});
  xh.append(label('x-height', 10, -4));
  guide.append(origin, xh);
  host.cameraEl.insertBefore(guide, host.piecesLayer);
  const syncMarks = () => {
    const s = 1 / (host.scale() * host.view().zoom);
    origin.setAttribute('transform', `scale(${s})`);
    xh.setAttribute('transform', `translate(0 ${-X_HEIGHT}) scale(${s})`);
  };
  host.onView(syncMarks);
  syncMarks();

  // ---- panel ----
  const style = document.createElement('style');
  style.textContent = CSS;
  host.root.append(style);
  const panel = document.createElement('div');
  panel.className = 'author panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Author mode');
  panel.innerHTML = `
    <div class="ahead"><h2>Author mode</h2><button type="button" class="b" data-a="toggle" aria-expanded="true" aria-label="Collapse author panel">&minus;</button></div>
    <div class="abody" data-scroll>
      <p>Build one letter, or a whole word as one composition, on the baseline. Type it in Text, Save. Each save is one way to build it.</p>
      <label>Text<input data-a="char" maxlength="48" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="a-status"></label>
      <label>Variant<input data-a="variant" type="number" min="1" max="999" step="1" inputmode="numeric"></label>
      <button type="button" class="b" data-a="save">Save suggestion</button>
      <div class="arow" data-a="replace" role="group" aria-label="Replace the existing file" hidden>
        <p data-a="replace-text"></p>
        <button type="button" class="b" data-a="replace-yes">Replace</button>
        <button type="button" class="b" data-a="replace-no">Cancel</button>
      </div>
      <p class="astatus" id="a-status" role="status" aria-live="polite"></p>
      <button type="button" class="b" data-a="baseline">Show baseline</button>
      <h3>Saved suggestions <span data-a="count"></span></h3>
      <ul class="alist" data-a="list"></ul>
    </div>`;
  boardEl.append(panel);
  const q = <T extends HTMLElement>(a: string) => panel.querySelector<T>(`[data-a="${a}"]`)!;
  const charIn = q<HTMLInputElement>('char');
  const varIn = q<HTMLInputElement>('variant');
  const statusEl = panel.querySelector<HTMLElement>('#a-status')!;
  const say = (t: string) => {
    statusEl.textContent = t;
  };

  let variantTouched = false;
  const suggestVariant = () => {
    if (variantTouched || !isAuthorText(charIn.value)) return;
    varIn.value = String(nextVariant(store.list, charIn.value));
  };
  charIn.addEventListener('input', () => {
    variantTouched = false;
    suggestVariant();
  });
  varIn.addEventListener('input', () => (variantTouched = true));

  const post = async (method: 'POST' | 'DELETE', body: unknown): Promise<{ status: number; body: { ok?: boolean; error?: string; filename?: string } }> => {
    const r = await fetch(AUTHOR_ROUTE, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  let pending: { filename: string; file: ReturnType<typeof toFileFor> } | null = null;
  const showReplace = (on: boolean) => {
    q('replace').hidden = !on;
    if (on) q<HTMLButtonElement>('replace-yes').focus();
  };

  const save = async (overwrite: boolean) => {
    const ch = charIn.value;
    const variant = Number(varIn.value);
    if (!isAuthorText(ch)) return say(`Type one character for a letter (a letter, digit or symbol), or ${WORD_MIN} to ${WORD_MAX} for a word.`);
    if (!isVariant(variant)) return say('Variant must be a whole number from 1 to 999.');
    let file = pending?.file;
    let filename = pending?.filename ?? '';
    if (!overwrite || !pending) {
      const pieces = host.pieces();
      if (!pieces.length) return say('The board is empty: build the letter or word first.');
      file = toFileFor(ch, variant, normaliseForSave(pieces, host.shapeOf));
      filename = filenameFor(ch, variant);
    }
    try {
      const r = await post('POST', { filename, data: file, overwrite });
      if (r.status === 200 && r.body.error === 'exists') {
        pending = { filename, file: file! };
        q('replace-text').textContent = `${filename} already exists. Replace it?`;
        say('');
        return showReplace(true);
      }
      if (r.status !== 200) return say(`Not saved: ${r.body.error ?? r.status}`);
      pending = null;
      showReplace(false);
      // Clear the fields BEFORE updating the list: the list update re-suggests a variant for whatever
      // character is still typed, which flashed the next number (e.g. 2) for the letter just saved.
      const what = `${whatLabel(ch)}, variant ${variant} (${filename})`;
      charIn.value = '';
      varIn.value = '';
      variantTouched = false;
      const v = validateSuggestion(file, filename);
      if (v.ok) store.set(v.value); // shown at once; the dev server's hot reload then re-reads the file
      say(`Saved ${what}.`);
      host.say(`Saved ${what}.`);
      renderList();
    } catch {
      say('Not saved: the dev server did not answer.');
    }
  };

  q('save').addEventListener('click', () => void save(false));
  q('replace-yes').addEventListener('click', () => void save(true));
  q('replace-no').addEventListener('click', () => {
    pending = null;
    showReplace(false);
    say('Not replaced.');
    q<HTMLButtonElement>('save').focus();
  });
  q('baseline').addEventListener('click', () => host.showBaseline());
  q('toggle').addEventListener('click', () => {
    const collapsed = panel.toggleAttribute('data-collapsed');
    const t = q('toggle');
    t.setAttribute('aria-expanded', String(!collapsed));
    t.setAttribute('aria-label', collapsed ? 'Expand author panel' : 'Collapse author panel');
    t.textContent = collapsed ? '+' : '−';
  });

  // ---- existing suggestions ----
  const listEl = q('list');
  const renderList = () => {
    const { letters, words } = splitSuggestions(store.list);
    const rows = [...[...groupByChar(letters).values()].flat(), ...[...groupByWord(words).values()].flat()];
    q('count').textContent = `(${rows.length})`;
    listEl.replaceChildren();
    if (!rows.length) {
      const li = document.createElement('li');
      li.textContent = 'None yet.';
      listEl.append(li);
    }
    for (const s of rows) {
      const li = document.createElement('li');
      li.dataset.file = s.filename;
      li.innerHTML = `<span class="name"></span>
        <button type="button" class="b" data-row="load">Load</button>
        <button type="button" class="b" data-row="delete">Delete</button>
        <span class="confirm arow" role="group" hidden><span>Delete it?</span>
          <button type="button" class="b" data-row="delete-yes">Delete</button>
          <button type="button" class="b" data-row="delete-no">Cancel</button></span>`;
      li.querySelector('.name')!.textContent = s.filename;
      li.querySelector('[data-row=load]')!.setAttribute('aria-label', `Load ${s.filename} onto the board`);
      li.querySelector('[data-row=delete]')!.setAttribute('aria-label', `Delete ${s.filename}`);
      listEl.append(li);
    }
    suggestVariant();
  };
  listEl.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const li = b?.closest('li');
    const filename = li?.dataset.file;
    if (!b || !li || !filename) return;
    const act = b.dataset.row;
    const confirm = li.querySelector<HTMLElement>('.confirm')!;
    if (act === 'load') {
      const s = store.list.find((x) => x.filename === filename);
      if (!s) return;
      host.loadPieces(s.pieces);
      charIn.value = suggestionText(s);
      varIn.value = String(s.variant);
      variantTouched = true;
      say(`Loaded ${filename}. Edit it, then Save and choose Replace.`);
    } else if (act === 'delete') {
      confirm.hidden = false;
      li.querySelector<HTMLButtonElement>('[data-row=delete-no]')!.focus();
    } else if (act === 'delete-no') {
      confirm.hidden = true;
      li.querySelector<HTMLButtonElement>('[data-row=delete]')!.focus();
    } else if (act === 'delete-yes') {
      try {
        const r = await post('DELETE', { filename });
        if (r.status === 200 || r.status === 404) {
          store.remove(filename);
          say(`Deleted ${filename}.`);
          host.say(`Deleted ${filename}.`);
        } else say(`Not deleted: ${r.body.error ?? r.status}`);
      } catch {
        say('Not deleted: the dev server did not answer.');
      }
    }
  });
  store.subscribe(renderList);
  renderList();

  if (!host.pieces().length) host.showBaseline();
}
