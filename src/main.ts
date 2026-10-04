import { SHAPES, type Shape } from './shapes';
import { Composition, type Piece } from './composition';
import { DEFAULT_CAMERA, fitTo, panBy, rotatedBounds, screenToBoard, zoomAt, type Camera } from './camera';
import { History } from './history';
import { deserialize, serialize, serializeToString, type SerializedComposition, type DeserializeResult } from './serialize';
import { buildShareUrl, decode, encode, encodedFromHash } from './share';
import { exportFilename, pngSize, renderCompositionSvg } from './export';
import { centreOn, groupByChar, groupByWord, isWord, splitSuggestions, type AnySuggestion, type Suggestion, type WordSuggestion } from './suggestions';
import { suggestionStore } from './suggestion-store';
import { introPieces, introSchedule, introWanted } from './intro';
import { fromUpright, normalise, rotationFor, snapNearest, snapTowardUpright, stepFromUpright } from './rotation';
import { fridgeTexture, type FridgeTexture } from './texture';
import { LIFT_MS, shadowCss, shadowLayersMarkup } from './shadow';
import { FONT_STACK, registerFont } from './font';
import { icon } from './icons';
import { layoutState } from './layout';
import {
  announceAdded, announceDeleted, announceHistory, announceLoaded, announceMoved, announceRestacked, announceRotated,
  announceSelected, announceSnap, announceZoom, announceSuggestion, announceWord, announceIntro, pieceCount,
} from './announce';

const PAD = 4; // source units of padding around each tray shape's bounding box
const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 6; // px of pointer travel before a tray press becomes a drag
const HANDLE_GAP = 36; // CSS px between the selection box's upright top and the rotate handle's centre
const HANDLE_HIT = 44; // CSS px, touch target diameter
const SELECT_PAD = 6; // CSS px between a shape and its selection box
const PAN_THRESHOLD = 4; // px of travel before a press on empty board becomes a pan
const BUTTON_ZOOM = 1.25; // factor per zoom button / key press
const FIT_MARGIN = 64; // CSS px kept clear around the composition by Frame all
const COMFORT_STEM = 0.25; // default view: a positive stem is this fraction of the board's shorter side
const FIT_MAX_COMFORT = 2; // Frame all never zooms past this multiple of the comfortable scale
const STORAGE_KEY = 'fridgeface:composition:v1';
const SAVE_DEBOUNCE_MS = 400;
const NOTICE_MS = 3500;
const PAN_KEY_PX = 60; // CSS px per arrow-key pan step (x4 with Shift)
const ANNOUNCE_BATCH_MS = 60; // announcements arriving within this window are read as one
const ANNOUNCE_SETTLE_MS = 450; // rapid keypresses (rotate, nudge, zoom) are summarised once they pause
const SHARE_PRECOMPUTE_MS = 250;
const THUMB_HEIGHT = 88; // CSS px, suggestion thumbnails
const SUGGESTION_NOTE = "One way to build it. There's no right way — make your own.";
const INTRO_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));
const STEM_LENGTH = SHAPE_BY_ID.get('positive-stem')!.uprightBox.h;

const STYLES = `
/* The compact layouts follow the element's own box, not the window's: a ResizeObserver on the host sets
   data-compact / data-short on the top elements (see syncLayout). Not @container queries: with them, Edward's iPhone
   showed the desktop layout (2026-10-04; not reproduced in desktop WebKit, so the exact cause is unconfirmed). Size containment keeps the host's size independent of its content, as before. */
:host {
  --ink: #000;
  --paper: #fff;
  --font: ${FONT_STACK};
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  contain: strict; /* size layout paint style */
  touch-action: none;
  /* No iOS long-press callout, text selection, tap flash or double-tap zoom on the board, tray or controls. */
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  font-family: var(--font);
  color: var(--ink);
  background: rgb(197 195 192);
}
.root {
  --k: 0.3; /* board scale: CSS px per board unit at zoom 1 */
  --tk: 0.32; /* tray scale: CSS px per source unit */
  /* Safe-area insets that actually overlap this element (set from JS; 0 when the element is not at a screen edge). */
  --sat: 0px; --sar: 0px; --sab: 0px; --sal: 0px;
  display: flex; flex-direction: column; width: 100%; height: 100%;
}
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.probe { position: absolute; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
.board { position: relative; flex: 1 1 auto; min-height: 0; background: rgb(197 195 192); }
.board svg.surface { display: block; width: 100%; height: 100%; touch-action: none; outline: none; user-select: none; -webkit-user-select: none; }
.board svg.surface:focus-visible { outline: 3px solid var(--ink); outline-offset: -6px; }
.board svg.surface [data-piece-id] { cursor: grab; }
.board.space svg.surface, .board.space svg.surface [data-piece-id] { cursor: grab; }
.board.panning svg.surface, .board.panning svg.surface [data-piece-id] { cursor: grabbing; }
${shadowCss()}

/* ---- controls: flat black-and-white, Jost caps ---- */
.panel {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px;
  background: var(--paper); border: 2px solid var(--ink); border-radius: 0;
  box-shadow: 2px 3px 0 rgb(0 0 0 / 0.18);
}
button.b {
  touch-action: manipulation;
  font: 500 13px/1 var(--font); letter-spacing: 0.1em; text-transform: uppercase;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-width: 44px; min-height: 44px; padding: 0 12px; box-sizing: border-box;
  background: var(--paper); color: var(--ink); border: 2px solid var(--ink); border-radius: 0; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
button.b[hidden] { display: none; }
button.b .ic { display: none; width: 22px; height: 22px; flex: none; }
button.b:hover:not(:disabled) { background: #e8e8e8; }
button.b[aria-pressed="true"], button.b[aria-expanded="true"] { background: var(--ink); color: var(--paper); }
button.b[aria-pressed="true"]:hover, button.b[aria-expanded="true"]:hover { background: var(--ink); }
button.b:disabled { color: #767676; border-color: #767676; cursor: default; background: var(--paper); }
/* Focus: an inset ring in the button's own text colour (black on white, white on black: 21:1), so it never
   merges with the panel border; tray shapes get an outside ring on the grey band (>= 9:1). */
button.b:focus-visible, .linkbox input:focus-visible, .helpbody:focus-visible { outline: 2px solid currentColor; outline-offset: -7px; }
.tray button:focus-visible { outline: 3px solid var(--ink); outline-offset: 4px; }
.msg { font: 700 13px/1.2 var(--font); letter-spacing: 0.08em; text-transform: uppercase; }
.dock {
  position: absolute; left: calc(10px + var(--sal)); right: calc(10px + var(--sar)); bottom: 10px; display: flex; flex-wrap: wrap; gap: 8px;
  align-items: flex-end; pointer-events: none;
}
.dock > * { pointer-events: auto; }
.view { margin-left: auto; }
.exportmenu { flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 4px; }
.exportmenu[hidden], .linkbox[hidden], .notice [hidden] { display: none; }
.notice { flex: 0 0 100%; display: flex; pointer-events: none; }
.notice .msg { color: var(--paper); background: var(--ink); padding: 11px 14px; }
.linkbox { flex: 0 0 100%; box-sizing: border-box; flex-wrap: nowrap; }
.linkbox input { -webkit-user-select: text; user-select: text; flex: 1 1 auto; min-width: 0; min-height: 44px; box-sizing: border-box; font: 14px/1 ui-monospace, monospace; padding: 0 8px; border: 2px solid var(--ink); border-radius: 0; color: var(--ink); background: var(--paper); }
.history .main, .history .confirm { display: contents; }
.history [hidden] { display: none; }
.history .msg { padding: 0 8px; }
.actions {
  position: absolute; top: calc(10px + var(--sat)); left: 50%; transform: translateX(-50%);
  flex-wrap: nowrap; justify-content: center; max-width: calc(100% - 16px - var(--sal) - var(--sar)); box-sizing: border-box;
}
.actions[hidden] { display: none; }

/* ---- suggestions (letters and words): a panel on desktop, a bottom sheet in the compact layout ---- */
.sugg {
  position: absolute; z-index: 5; display: flex; flex-direction: column; box-sizing: border-box; min-height: 0;
  right: calc(10px + var(--sar)); bottom: calc(var(--dock-h, 66px) + 18px);
  width: min(360px, calc(100% - 20px - var(--sal) - var(--sar)));
  max-height: calc(100% - var(--dock-h, 66px) - 90px - var(--sat));
  background: var(--paper); border: 2px solid var(--ink); box-shadow: 4px 6px 0 rgb(0 0 0 / 0.25); --sheet: 0;
}
.sugg[hidden] { display: none; }
.sghead { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 4px 4px 14px; border-bottom: 2px solid var(--ink); }
.sghead h2 { margin: 0; font: 700 15px/1.2 var(--font); letter-spacing: 0.1em; text-transform: uppercase; }
.sgnote { flex: none; margin: 0; padding: 10px 14px; font: 500 12px/1.4 var(--font); letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid #d0d0d0; }
.sgbody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px 14px 14px; touch-action: pan-y; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.sgchars, .sgvars { display: flex; flex-wrap: wrap; gap: 6px; }
.sgchars button.b { text-transform: none; letter-spacing: 0; font: 700 22px/1 var(--font); padding: 0; }
.sgsec[hidden] { display: none; }
.sgsec:not([hidden]) ~ .sgsec { margin-top: 18px; padding-top: 14px; border-top: 1px solid #d0d0d0; }
.sgs { margin: 0 0 10px; font: 700 13px/1.2 var(--font); letter-spacing: 0.12em; text-transform: uppercase; }
.sgh { margin: 14px 0 8px; font: 700 12px/1.2 var(--font); letter-spacing: 0.12em; text-transform: uppercase; }
.sgh .ch { text-transform: none; }
.sgvars { gap: 8px; }
.sgvars button.b { flex-direction: column; gap: 4px; min-width: 72px; padding: 6px 8px 5px; }
.sgvars img { display: block; height: ${THUMB_HEIGHT}px; width: auto; max-width: 100%; pointer-events: none; }
.sgvars .vn { font: 700 11px/1 var(--font); letter-spacing: 0.1em; }
.sgwords { display: flex; flex-direction: column; gap: 8px; }
.sgwords button.b { flex-direction: column; gap: 6px; width: 100%; padding: 8px 8px 6px; text-transform: none; letter-spacing: 0; }
.sgwords img { display: block; width: auto; height: auto; max-width: 100%; max-height: ${THUMB_HEIGHT}px; pointer-events: none; }
.sgwords .vn { font: 700 12px/1 var(--font); letter-spacing: 0.04em; }
.help li.sg-only { display: none; }
.help.has-sugg li.sg-only { display: flex; }

/* ---- tray: a slightly darker band of the same fridge door ---- */
.tray {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: center;
  gap: 12px 56px;
  padding: 18px calc(16px + var(--sar)) calc(12px + var(--sab)) calc(16px + var(--sal));
  background-color: rgb(186 184 181);
  background-image: linear-gradient(rgb(0 0 0 / 0.055), rgb(0 0 0 / 0.055)), var(--tex, none);
  background-size: auto, calc(1024px * var(--tk)) calc(1024px * var(--tk));
  box-shadow: inset 0 2px 0 rgb(0 0 0 / 0.12);
  box-sizing: border-box;
  --px: calc(1px / var(--tk));
}
.tray .grp { display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.tray .shapes { display: flex; align-items: flex-end; justify-content: center; gap: 28px; }
.tray .bracket { display: flex; align-items: flex-end; gap: 10px; height: 14px; margin: 0 4px; }
.tray .bracket::before, .tray .bracket::after {
  content: ""; flex: 1 1 0; height: 12px; border-bottom: 1.5px solid var(--ink); box-sizing: border-box;
}
.tray .bracket::before { border-left: 1.5px solid var(--ink); }
.tray .bracket::after { border-right: 1.5px solid var(--ink); }
.tray .bracket span { font: 700 13px/1 var(--font); letter-spacing: 0.1em; text-transform: uppercase; transform: translateY(6px); white-space: nowrap; }
.tray button {
  all: unset;
  box-sizing: content-box;
  cursor: grab;
  line-height: 0;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  width: calc(var(--w) * var(--tk) * 1px);
  height: calc(var(--h) * var(--tk) * 1px);
}
.tray svg { display: block; width: 100%; height: 100%; overflow: visible; }
.preview { position: fixed; z-index: 10; pointer-events: none; line-height: 0; opacity: 0.9; }
.preview svg { display: block; width: 100%; height: 100%; overflow: visible; }

/* Compact layout (phones, either orientation): the element is narrow OR short (data-compact, set from JS on .root
   and .help). Icon controls, a small tray. */
.root[data-compact] { --k: 0.17; --tk: 0.17; }
[data-compact] .tray { gap: 10px 14px; padding: 12px calc(10px + var(--sar)) calc(10px + var(--sab)) calc(10px + var(--sal)); }
[data-compact] .tray .grp { display: contents; }
[data-compact] .tray .shapes { display: contents; }
[data-compact] .tray .bracket { display: none; }
[data-compact] .tray button { position: relative; }
[data-compact] .tray button::after { content: ""; position: absolute; inset: -6px -9px; } /* thin stems get a larger touch target */
[data-compact] button.b.i { padding: 0; width: 44px; }
[data-compact] button.b.i .ic { display: block; }
[data-compact] button.b.i .tx { display: none; }
[data-compact] .panel { gap: 3px; padding: 3px; }
[data-compact] .dock { left: calc(8px + var(--sal)); right: calc(8px + var(--sar)); bottom: 8px; gap: 6px; }
[data-compact] .actions { top: calc(8px + var(--sat)); }
[data-compact] .msg { font-size: 12px; }
/* The share, export, letters and help buttons live in the menu on phones; the menu button exists only there. */
[data-compact] .share, [data-compact] [data-view=suggest], [data-compact] [data-view=help] { display: none; }
.root:not([data-compact]) [data-view=menu], .root:not([data-compact]) .menu { display: none; }
.menu { position: absolute; z-index: 6; flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 3px; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; }
.menu[hidden] { display: none; }
.menu button.b { justify-content: flex-start; gap: 12px; padding: 0 16px 0 10px; white-space: nowrap; text-align: left; }
.menu button.b .ic { display: block; }
.menu button.b[aria-disabled="true"] { color: #767676; border-color: #767676; cursor: default; background: var(--paper); }
.menu button.b[aria-disabled="true"]:hover { background: var(--paper); }
.menu .sub { display: flex; gap: 3px; padding-left: 34px; }
.menu .sub[hidden] { display: none; }
.menu .sub button.b { flex: 1 1 0; justify-content: center; padding: 0 10px; }
/* Short (landscape) screens: two columns, so the menu stays low enough not to reach the piece action bar. */
.root[data-short] .menu:not([hidden]) { display: grid; grid-template-columns: 1fr 1fr; width: min(520px, calc(100% - 16px)); }
.root[data-short] .menu .sub { grid-column: 1 / -1; order: 5; padding-left: 0; }
/* Bottom sheet: full width, over the dock, no taller than most of the board. */
[data-compact] .sugg { --sheet: 1; left: 0; right: 0; bottom: 0; width: auto; max-height: 64%; border-width: 2px 0 0; box-shadow: none; }
/* Short (phones in landscape): a thinner tray band. */
[data-short] .tray { padding-top: 8px; padding-bottom: calc(6px + var(--sab)); }

/* ---- keyboard shortcuts dialog ---- */
.help {
  position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
  padding: calc(12px + var(--sat, 0px)) calc(12px + var(--sar, 0px)) calc(12px + var(--sab, 0px)) calc(12px + var(--sal, 0px));
  background: rgb(0 0 0 / 0.6); box-sizing: border-box;
}
.help[hidden] { display: none; }
.helpbox {
  display: flex; flex-direction: column; width: min(760px, 100%); max-height: 100%; box-sizing: border-box;
  background: var(--paper); border: 2px solid var(--ink); box-shadow: 4px 6px 0 rgb(0 0 0 / 0.25);
}
.helphead { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 6px 6px 16px; border-bottom: 2px solid var(--ink); }
.helphead h2 { margin: 0; font: 700 15px/1.2 var(--font); letter-spacing: 0.1em; text-transform: uppercase; }
.helpbody { overflow: auto; padding: 4px 16px 16px; touch-action: pan-y; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.helpbody h3 { margin: 16px 0 6px; font: 700 12px/1.2 var(--font); letter-spacing: 0.12em; text-transform: uppercase; }
.helpbody ul { margin: 0; padding: 0; list-style: none; columns: 2 340px; column-gap: 28px; }
.helpbody li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 5px 0; break-inside: avoid; border-bottom: 1px solid #d0d0d0; font: 500 13px/1.3 var(--font); letter-spacing: 0.08em; text-transform: uppercase; }
.helpbody li > span:first-child { flex: 1 1 0; min-width: 0; }
.helpbody .keys { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 4px; flex: 0 1 auto; max-width: 62%; }
.helpbody kbd { font: 700 12px/1 var(--font); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 6px; border: 1.5px solid var(--ink); background: #f2f2f2; min-width: 12px; text-align: center; box-sizing: content-box; }
.helpbody .combo { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.helpbody .or { font-size: 11px; align-self: center; color: #4a4a4a; }

/* ---- motion: none at all when the visitor asks for less ---- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;

/** Every keyboard shortcut, in the order the help dialog lists them. Each entry is a list of alternative key combos. */
const SHORTCUTS: readonly { title: string; items: readonly { keys: readonly (readonly string[])[]; text: string; when?: string }[] }[] = [
  { title: 'Add and choose', items: [
    { keys: [['1'], ['2'], ['3'], ['4'], ['5']], text: 'Add a piece (tray order)' },
    { keys: [['N'], ['P']], text: 'Next or previous piece in the stacking order' },
    { keys: [['Esc']], text: 'Close a menu, then deselect' },
  ] },
  { title: 'Move and rotate the selected piece', items: [
    { keys: [['Arrows'], ['Shift', 'Arrows']], text: 'Move 1 unit, or 10' },
    { keys: [[','], ['.']], text: 'Rotate 1 degree anticlockwise or clockwise' },
    { keys: [['Shift', ','], ['Shift', '.']], text: 'Rotate one 15 degree step' },
    { keys: [['S']], text: 'Turn snap on or off' },
  ] },
  { title: 'Stack and delete', items: [
    { keys: [[']'], ['[']], text: 'Bring forward, send backward' },
    { keys: [['Delete'], ['Backspace']], text: 'Delete the piece' },
  ] },
  { title: 'View', items: [
    { keys: [['Arrows'], ['Alt', 'Arrows']], text: 'Pan the board; Shift for bigger steps. With a piece selected, only Alt + Arrows pans' },
    { keys: [['+'], ['\u2212']], text: 'Zoom in or out' },
    { keys: [['F'], ['Shift', '1']], text: 'Frame all pieces' },
    { keys: [['Space', 'drag']], text: 'Pan with the pointer' },
  ] },
  { title: 'History, share and export', items: [
    { keys: [['Ctrl', 'Z'], ['Cmd', 'Z']], text: 'Undo' },
    { keys: [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']], text: 'Redo' },
    { keys: [['C']], text: 'Copy the share link' },
    { keys: [['E']], text: 'Open the export menu' },
    { keys: [['L']], text: 'Show or hide letter suggestions', when: 'sg-only' },
  ] },
  { title: 'Everything else', items: [
    { keys: [['Tab'], ['Shift', 'Tab']], text: 'Move to the next or previous control' },
    { keys: [['?']], text: 'Show or hide this list' },
  ] },
  { title: 'Pointer and touch', items: [
    { keys: [['Drag']], text: 'Drag a shape from the tray onto the board, or move a piece' },
    { keys: [['Handle']], text: 'Drag the round handle above a piece to rotate it' },
    { keys: [['Wheel'], ['Pinch']], text: 'Pan or zoom the board' },
  ] },
];

function shortcutsHtml(): string {
  const combo = (c: readonly string[]) => `<span class="combo">${c.map((k) => `<kbd>${k}</kbd>`).join('<span class="or" aria-hidden="true">+</span>')}</span>`;
  return SHORTCUTS.map(
    (sec) =>
      `<h3>${sec.title}</h3><ul>` +
      sec.items
        .map((it) => `<li${it.when ? ` class="${it.when}"` : ''}><span>${it.text}</span><span class="keys">${it.keys.map(combo).join('<span class="or">or</span>')}</span></li>`)
        .join('') +
      `</ul>`,
  ).join('');
}

/** A control button: text label on wide screens, icon on narrow ones (`i`). */
function btn(attrs: string, label: string, ic?: string): string {
  return `<button type="button" class="b${ic ? ' i' : ''}" ${attrs}>${ic ? icon(ic) : ''}<span class="tx">${label}</span></button>`;
}

/** One item of the phone menu (a button with role=menuitem; arrow keys move between them, so none is in the tab order). */
function menuItem(id: string, label: string, ic: string, attrs: string): string {
  return `<button type="button" class="b mi" role="menuitem" tabindex="-1" data-menu="${id}" ${attrs}>${ic ? icon(ic) : ''}<span class="tx">${label}</span></button>`;
}

/** The geometry element with an `{a}` placeholder for attributes. */
function geometryTemplate(s: Shape): string {
  return s.geometry.kind === 'polygon' ? `<polygon points="${s.geometry.points}" {a}/>` : `<path d="${s.geometry.d}" {a}/>`;
}

function geometryHtml(s: Shape): string {
  return geometryTemplate(s).replace('{a}', `fill="${s.fill}"`);
}

/** A shape at rest in its own source coordinates, with its magnet shadow (tray and drag preview). */
function shapeSvg(s: Shape): string {
  const { x, y, w, h } = s.bbox;
  return (
    `<svg viewBox="${x - PAD} ${y - PAD} ${w + 2 * PAD} ${h + 2 * PAD}" aria-hidden="true" focusable="false">` +
    `<g class="sh">${shadowLayersMarkup(geometryTemplate(s))}</g><g class="bd">${geometryHtml(s)}</g></svg>`
  );
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const n3 = (v: number) => String(Math.round(v * 1000) / 1000);

/** Rotation about the centroid, which the piece group has already moved to (x, y). */
function rotationTransform(p: Piece, s: Shape): string {
  return `rotate(${n3(p.rotation)}) translate(${n3(-s.centroid.x)} ${n3(-s.centroid.y)})`;
}

interface PieceEls {
  g: SVGGElement;
  /** Every group that carries the piece's rotation (shadow layers and the shape). */
  rots: SVGGElement[];
  last?: Piece;
}

export class FridgeFace extends HTMLElement {
  readonly composition = new Composition();

  private surface!: SVGSVGElement;
  private cameraEl!: SVGGElement;
  private piecesLayer!: SVGGElement;
  private overlay!: SVGGElement;
  private actions!: HTMLElement;
  private boardEl!: HTMLElement;
  private trayEl!: HTMLElement;
  private rootEl!: HTMLElement;
  private liveEl!: HTMLElement;
  private helpEl!: HTMLElement;
  private insetProbe!: HTMLElement;
  private helpOpener: HTMLElement | SVGElement | null = null;
  private suggEl!: HTMLElement;
  private suggBtn!: HTMLButtonElement;
  private dockEl!: HTMLElement;
  private menuEl!: HTMLElement;
  private menuBtn!: HTMLButtonElement;
  private suggOpener: HTMLElement | SVGElement | null = null;
  private suggChar: string | null = null;
  private unsubSuggestions: (() => void) | null = null;
  private thumbs = new WeakMap<AnySuggestion, string>();
  private viewListeners = new Set<() => void>();
  private introAnims: Animation[] = [];
  private introQueued = false;
  private insets = '';
  private sayQueue: string[] = [];
  private sayTimer = 0;
  private sayClearTimer = 0;
  private later = new Map<string, number>();
  private shareVer = 0; // bumped on every composition change
  private shareTimer = 0;
  private shareCache: { url: string; ver: number; base: string } | null = null;
  private els = new Map<string, PieceEls>();
  private texture!: FridgeTexture;
  private textureRect!: SVGRectElement;
  private liftedId: string | null = null;
  private liftTimer = 0;
  private viewReady = false;
  private pxZoom = NaN;
  private kCache = 0;
  private vpCache: { width: number; height: number } | null = null;
  private selectedId: string | null = null;
  private snap = false;
  private touches = new Map<number, { x: number; y: number }>();
  private rotating: { pointerId: number; id: string; grab: number; startRot: number } | null = null;
  private twist: { id: string; lastAngle: number; accum: number; startRot: number; startPos: { x: number; y: number }; startMid: { x: number; y: number } } | null = null;

  private moving: { pointerId: number; id: string; startPt: { x: number; y: number }; startX: number; startY: number; moved?: boolean } | null = null;
  private trayDrag: { pointerId: number; shape: Shape; startX: number; startY: number; active: boolean; preview?: HTMLElement } | null = null;
  private suppressClick = false;

  // History and persistence.
  private history = new History<readonly Piece[]>([], { equals: sameSnapshot });
  private applying = false; // true while undo/redo/load rewrite the composition
  private restoring = false; // true while the saved composition is read back on load
  private coalesceKey: string | null = null;
  private saveTimer = 0;
  private pendingFit = false;
  private historyEl!: HTMLElement;
  private shareEl!: HTMLElement;
  private noticeEl!: HTMLElement;
  private linkboxEl!: HTMLElement;
  private noticeTimer = 0;
  private readonly onHashChange = () => void this.consumeHash();
  private readonly onPageHide = () => this.flushSave();

  // Camera (view) state. Changes only touch the <g data-camera> transform, batched per animation frame.
  private view: Camera = { ...DEFAULT_CAMERA };
  private frame = 0;
  private overlayZoom = NaN;
  private spaceDown = false;
  private pan: { pointerId: number; startX: number; startY: number; startView: Camera; active: boolean } | null = null;
  private pinch: { ids: [number, number]; lastMid: { x: number; y: number }; lastDist: number } | null = null;
  private readonly onWindowKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') this.setSpace(false); };
  private readonly onWindowBlur = () => this.setSpace(false);
  private readonly onWindowResize = () => this.syncInsets();
  private readonly onIntroInput = () => this.finishIntro();

  connectedCallback() {
    window.addEventListener('keyup', this.onWindowKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('hashchange', this.onHashChange);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('orientationchange', this.onWindowResize);
    this.unsubSuggestions ??= suggestionStore.subscribe(() => this.syncSuggestions());
    if (this.shadowRoot) return;
    // A landmark for the whole toy (the host page can override either attribute).
    if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
    if (!this.hasAttribute('aria-label') && !this.hasAttribute('aria-labelledby')) this.setAttribute('aria-label', 'Fridgeface');
    registerFont();
    this.texture = fridgeTexture();
    const tex = this.texture;
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    const wrap = document.createElement('div');
    wrap.className = 'root';
    wrap.innerHTML = `
      <div class="board" part="board">
        <svg class="surface" tabindex="0" role="application" aria-label="Fridgeface board" aria-describedby="ff-desc">
          <defs><pattern id="ff-tex" patternUnits="userSpaceOnUse" x="0" y="0" width="${tex.units}" height="${tex.units}"><image href="${tex.href}" x="0" y="0" width="${tex.units}" height="${tex.units}" preserveAspectRatio="none"/></pattern></defs>
          <g data-camera aria-hidden="true" transform="matrix(1 0 0 1 0 0)"><rect data-texture fill="url(#ff-tex)" x="0" y="0" width="0" height="0"/><g data-pieces></g><g data-overlay></g></g>
        </svg>
        <div class="actions panel" role="toolbar" aria-label="Piece actions" hidden>
          ${btn('data-action="delete" aria-label="Delete piece"', 'Delete', 'delete')}
          ${btn('data-action="rotate-left" aria-label="Rotate left 15°"', '&#8630; 15°', 'rotate-left')}
          ${btn('data-action="rotate-right" aria-label="Rotate right 15°"', '15° &#8631;', 'rotate-right')}
          ${btn('data-action="snap" aria-label="Snap 15°" aria-pressed="false"', 'Snap 15°', 'snap')}
          ${btn('data-action="forward" aria-label="Bring forward"', 'Forward', 'forward')}
          ${btn('data-action="backward" aria-label="Send backward"', 'Back', 'backward')}
        </div>
        <div class="dock">
          <div class="notice" aria-hidden="true"><span class="msg" hidden></span></div>
          <div class="linkbox panel" role="group" aria-label="Share link" hidden>
            <input type="text" readonly aria-label="Share link (copy it from here)" />
            ${btn('data-share="close" aria-label="Close share link"', 'Close', 'close')}
          </div>
          <div class="history panel" role="group" aria-label="History">
            <span class="main" role="group" aria-label="Undo, redo and clear">
              ${btn('data-history="undo" aria-label="Undo" disabled', 'Undo', 'undo')}
              ${btn('data-history="redo" aria-label="Redo" disabled', 'Redo', 'redo')}
              ${btn('data-history="clear" aria-label="Clear board" disabled', 'Clear', 'clear')}
            </span>
            <span class="confirm" role="alertdialog" aria-label="Confirm clearing the board" hidden>
              <span class="msg">Clear everything?</span>
              ${btn('data-history="clear-yes" aria-label="Confirm clear board"', 'Clear')}
              ${btn('data-history="clear-no" aria-label="Cancel clear board"', 'Cancel')}
            </span>
          </div>
          <div class="share panel" role="group" aria-label="Share and export">
            ${btn('data-share="copy" aria-label="Copy share link" disabled', 'Share', 'share')}
            ${btn('data-share="export" aria-label="Export" aria-haspopup="true" aria-expanded="false" aria-controls="ff-export" disabled', 'Export', 'export')}
            <div class="exportmenu" id="ff-export" role="group" aria-label="Export as" hidden>
              ${btn('data-export="png" aria-label="Download PNG"', 'PNG')}
              ${btn('data-export="svg" aria-label="Download SVG"', 'SVG')}
            </div>
          </div>
          <div class="view panel" role="group" aria-label="View">
            ${btn('data-view="out" aria-label="Zoom out"', '&minus;', 'zoom-out')}
            ${btn('data-view="fit" aria-label="Frame all pieces"', 'Fit', 'fit')}
            ${btn('data-view="in" aria-label="Zoom in"', '+', 'zoom-in')}
            ${btn('data-view="suggest" aria-label="Letter suggestions" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="L" hidden', 'Letters', 'letters')}
            ${btn('data-view="help" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-keyshortcuts="?"', '?', 'help')}
            ${btn('data-view="menu" aria-label="Menu" aria-haspopup="true" aria-expanded="false" aria-controls="ff-menu"', 'Menu', 'menu')}
          </div>
        </div>
        <div class="menu panel" id="ff-menu" role="menu" aria-label="Menu" hidden>
          ${menuItem('share', 'Copy share link', 'share', 'aria-keyshortcuts="C"').replace('tabindex="-1"', 'tabindex="0"')}
          ${menuItem('download', 'Download', 'export', 'aria-haspopup="true" aria-expanded="false" aria-keyshortcuts="E"')}
          <div class="sub" role="group" aria-label="Download as" hidden>
            ${menuItem('png', 'PNG', '', 'aria-label="Download PNG"')}
            ${menuItem('svg', 'SVG', '', 'aria-label="Download SVG"')}
          </div>
          ${menuItem('letters', 'Letters', 'letters', 'aria-haspopup="dialog" aria-keyshortcuts="L" hidden')}
          ${menuItem('help', 'Keyboard shortcuts', 'help', 'aria-haspopup="dialog" aria-keyshortcuts="?"')}
        </div>
        <div class="sugg" role="dialog" aria-labelledby="ff-sugg-title" hidden>
          <div class="sghead"><h2 id="ff-sugg-title">Suggestions</h2>${btn('data-sugg="close" aria-label="Close suggestions"', 'Close', 'close')}</div>
          <p class="sgnote">${SUGGESTION_NOTE}</p>
          <div class="sgbody" data-scroll>
            <section class="sgsec" data-sec="letters" aria-labelledby="ff-sugg-lt">
              <h3 class="sgs" id="ff-sugg-lt">Letters</h3>
              <div class="sgchars" role="group" aria-label="Characters"></div>
              <h4 class="sgh" id="ff-sugg-vh"></h4>
              <div class="sgvars" role="group" aria-labelledby="ff-sugg-vh"></div>
            </section>
            <section class="sgsec" data-sec="words" aria-labelledby="ff-sugg-wd" hidden>
              <h3 class="sgs" id="ff-sugg-wd">Words</h3>
              <div class="sgwords" role="group" aria-labelledby="ff-sugg-wd"></div>
            </section>
          </div>
        </div>
      </div>
      <div class="tray" part="tray" role="group" aria-label="Add a piece">
        <div class="grp" role="group" aria-label="Positive shapes"><div class="shapes" data-polarity="positive"></div><div class="bracket" aria-hidden="true"><span>Positive</span></div></div>
        <div class="grp" role="group" aria-label="Negative shapes"><div class="shapes" data-polarity="negative"></div><div class="bracket" aria-hidden="true"><span>Negative</span></div></div>
      </div>`;
    wrap.insertAdjacentHTML('afterbegin', '<div class="probe" aria-hidden="true"></div>');
    const outer = document.createElement('div'); // siblings of .root: never made inert, so the live region keeps working
    outer.innerHTML = `
      <div class="sr" id="ff-desc">Press 1 to 5 to add a piece. N and P choose a piece. Arrow keys move it, comma and period rotate it, the bracket keys restack it, Delete removes it. Press question mark for every shortcut.</div>
      <div class="sr" id="ff-live" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="help" hidden>
        <div class="helpbox" role="dialog" aria-modal="true" aria-labelledby="ff-help-title">
          <div class="helphead"><h2 id="ff-help-title">Keyboard shortcuts</h2>${btn('data-help="close" aria-label="Close keyboard shortcuts"', 'Close', 'close')}</div>
          <div class="helpbody" tabindex="0" role="region" aria-label="Shortcut list">${shortcutsHtml()}</div>
        </div>
      </div>`;
    this.rootEl = wrap;
    this.liveEl = outer.querySelector('#ff-live')!;
    this.helpEl = outer.querySelector('.help')!;
    this.insetProbe = wrap.querySelector('.probe')!;
    this.boardEl = wrap.querySelector('.board')!;
    this.trayEl = wrap.querySelector('.tray')!;
    this.surface = wrap.querySelector('svg.surface')!;
    this.cameraEl = wrap.querySelector('[data-camera]')!;
    this.textureRect = wrap.querySelector('[data-texture]')!;
    this.piecesLayer = wrap.querySelector('[data-pieces]')!;
    this.overlay = wrap.querySelector('[data-overlay]')!;
    this.actions = wrap.querySelector('.actions')!;
    this.historyEl = wrap.querySelector('.history')!;
    this.shareEl = wrap.querySelector('.share')!;
    this.noticeEl = wrap.querySelector('.notice .msg')!;
    this.linkboxEl = wrap.querySelector('.linkbox')!;
    this.suggEl = wrap.querySelector('.sugg')!;
    this.suggBtn = wrap.querySelector('[data-view=suggest]')!;
    this.dockEl = wrap.querySelector('.dock')!;
    this.menuEl = wrap.querySelector('.menu')!;
    this.menuBtn = wrap.querySelector('[data-view=menu]')!;
    this.trayEl.style.setProperty('--tex', `url("${tex.href}")`);

    for (const s of SHAPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.shape = s.id;
      b.setAttribute('aria-label', `Add ${s.name.toLowerCase()}`);
      b.setAttribute('aria-keyshortcuts', String(SHAPES.indexOf(s) + 1));
      b.style.setProperty('--w', String(s.bbox.w + 2 * PAD));
      b.style.setProperty('--h', String(s.bbox.h + 2 * PAD));
      b.innerHTML = shapeSvg(s);
      wrap.querySelector(`.tray [data-polarity=${s.polarity}]`)!.appendChild(b);
    }
    root.append(style, wrap, ...outer.children);
    // Layout state first, synchronously, so the very first frame already has the right layout (no desktop flash).
    this.syncLayout();
    new ResizeObserver(() => this.syncLayout()).observe(this);

    this.trayEl.addEventListener('pointerdown', (e) => this.onTrayDown(e));
    this.trayEl.addEventListener('pointermove', (e) => this.onTrayMove(e));
    this.trayEl.addEventListener('pointerup', (e) => this.onTrayUp(e));
    this.trayEl.addEventListener('pointercancel', (e) => this.endTrayDrag(e, false));
    this.trayEl.addEventListener('click', (e) => this.onTrayClick(e));

    this.surface.addEventListener('pointerdown', (e) => this.onBoardDown(e));
    this.surface.addEventListener('pointermove', (e) => this.onBoardMove(e));
    this.surface.addEventListener('pointerup', (e) => this.onBoardUp(e));
    this.surface.addEventListener('pointercancel', (e) => this.onBoardUp(e));

    this.actions.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.action;
      if (!act || !this.selectedId) return;
      this.runAction(act, this.selectedId);
      // The pressed button may now be disabled or gone (Delete hides the bar): keep keyboard focus on the board.
      const pressed = (e.target as HTMLElement).closest('button')!;
      if (this.actions.hidden || pressed.disabled) this.surface.focus();
    });
    this.addEventListener('keydown', (e) => this.onKey(e));
    this.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Safari reports trackpad pinch as proprietary gesture events; the page must never zoom.
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) this.addEventListener(t, (e) => e.preventDefault());
    wrap.querySelector('.view')!.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest('button')?.dataset.view;
      if (v === 'in') this.zoomBy(BUTTON_ZOOM);
      else if (v === 'out') this.zoomBy(1 / BUTTON_ZOOM);
      else if (v === 'fit') this.frameAll();
      else if (v === 'help') this.openHelp(e.target as HTMLElement);
      else if (v === 'suggest') this.toggleSuggestions(e.target as HTMLElement);
      else if (v === 'menu') { if (this.menuOpen) this.closeMenu(true); else this.openMenu(); }
    });
    this.menuEl.addEventListener('click', (e) => this.onMenuClick(e));
    this.suggEl.addEventListener('click', (e) => this.onSuggestionsClick(e));
    new ResizeObserver(() => this.rootEl.style.setProperty('--dock-h', `${Math.round(this.dockEl.getBoundingClientRect().height)}px`)).observe(this.dockEl);
    this.helpEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.helpEl || t.closest('[data-help=close]')) this.closeHelp();
    });

    this.historyEl.addEventListener('click', (e) => this.onHistoryClick(e));
    this.shareEl.addEventListener('click', (e) => this.onShareClick(e));
    this.linkboxEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.hideLinkBox();
    });
    this.shadowRoot!.addEventListener('pointerdown', (e) => {
      if (!(e as PointerEvent).composedPath().includes(this.shareEl)) this.showExportMenu(false);
    });

    this.composition.onChange((pieces) => this.onCompositionChange(pieces));
    new ResizeObserver(() => {
      const before = this.viewReady && !this.pendingFit ? this.vpCache : null;
      const centre = before ? screenToBoard(this.view, { x: before.width / 2, y: before.height / 2 }) : null;
      this.syncViewBox();
      this.syncInsets();
      const after = this.vpCache;
      if (centre && after && (after.width !== before!.width || after.height !== before!.height)) {
        // Window resize, rotation, the iOS URL bar: keep the same board point at the centre of the board.
        const z = this.view.zoom;
        this.setView({ x: after.width / 2 - centre.x * z, y: after.height / 2 - centre.y * z, zoom: z });
      } else if (this.pendingFit && this.boardEl.clientWidth) {
        this.pendingFit = false;
        this.viewReady = true;
        this.fitToComposition();
      } else if (!this.viewReady && this.boardEl.clientWidth) {
        this.viewReady = true;
        this.setView(this.defaultView());
      }
      this.applyView(); // the texture rect follows the viewport size
      this.render();
      if (this.introQueued && this.boardEl.clientWidth) this.startIntroAnimation(); // the board was not laid out yet when the intro began
    }).observe(this.boardEl);
    this.syncViewBox();
    this.syncInsets();
    if (this.boardEl.clientWidth) {
      this.viewReady = true;
      this.view = this.defaultView();
    }
    this.applyView();
    const hadSaved = this.restoreSaved();
    this.render();
    this.syncSuggestions();
    const authoring = import.meta.env.DEV && new URLSearchParams(location.search).has('author');
    this.maybeIntro(hadSaved, authoring);
    void this.consumeHash();
    if (import.meta.env.DEV && authoring) {
      // Dev-only author mode: the whole module is dropped from production builds.
      void import('./author').then(({ mountAuthor }) =>
        mountAuthor({
          boardEl: this.boardEl, cameraEl: this.cameraEl, piecesLayer: this.piecesLayer, root: this.shadowRoot!,
          scale: () => this.k,
          view: () => this.getView(),
          onView: (fn) => void this.viewListeners.add(fn),
          pieces: () => this.composition.pieces.map(({ shapeId, x, y, rotation }) => ({ shapeId, x, y, rotation })),
          loadPieces: (pieces) => {
            this.selectedId = null;
            this.composition.replace(pieces);
            this.say(announceLoaded(this.composition.pieces.length));
          },
          showBaseline: () => this.setView(this.originView()),
          say: (t) => this.say(t),
          shapeOf: (id) => SHAPE_BY_ID.get(id),
          store: suggestionStore,
        }),
      );
    }
  }

  disconnectedCallback() {
    window.removeEventListener('keyup', this.onWindowKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('hashchange', this.onHashChange);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('orientationchange', this.onWindowResize);
    this.unsubSuggestions?.();
    this.unsubSuggestions = null;
    this.closeMenu(false);
    this.finishIntro();
    this.flushSave();
  }

  // ---- history, persistence, public API --------------------------------------

  /** The composition in the wire format (`{ v: 1, pieces: [{ s, x, y, r }] }`), bottom piece first. */
  getComposition(): SerializedComposition {
    return serialize(this.composition.pieces);
  }

  /**
   * Replace the board with a composition (object or JSON string in the wire format) and frame it.
   * One undoable step. Never throws; an invalid payload leaves the board untouched.
   */
  loadComposition(data: unknown): DeserializeResult {
    const r = deserialize(data);
    if (!r.ok) return r;
    this.applyLoaded(r.pieces, true);
    return r;
  }

  private applyLoaded(pieces: Parameters<Composition['replace']>[0], undoable: boolean) {
    this.finishIntro();
    this.selectedId = null;
    this.coalesceKey = null;
    this.applying = !undoable;
    this.restoring = !undoable;
    try {
      this.composition.replace(pieces);
    } finally {
      this.applying = false;
      this.restoring = false;
    }
    if (!undoable) this.history.reset(this.composition.pieces);
    else this.say(announceLoaded(this.composition.pieces.length));
    this.render();
    if (this.boardEl.clientWidth) this.fitToComposition();
    else this.pendingFit = true;
  }

  /** Read the auto-save back. Returns whether a VALID saved composition existed (even an empty one). */
  private restoreSaved(): boolean {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return false; // storage unavailable: the toy simply works unsaved
    }
    if (raw === null) return false;
    const r = deserialize(raw);
    if (!r.ok) {
      console.warn(`fridgeface: ignoring saved composition (${r.error})`);
      return false;
    }
    if (r.pieces.length) this.applyLoaded(r.pieces, false);
    return true;
  }

  private onCompositionChange(pieces: readonly Piece[]) {
    if (this.introAnims.length) this.finishIntro();
    if (!this.applying && !this.inGesture) this.history.record(pieces, this.coalesceKey);
    if (!this.restoring) this.scheduleSave(); // restoring what is already saved needs no write-back
    this.scheduleShareUrl();
    this.render();
  }

  private get inGesture(): boolean {
    return !!(this.moving || this.rotating || this.twist);
  }

  /** A drag / handle drag / twist is one step: record once, when the gesture ends. */
  private commitGesture() {
    if (this.inGesture) return;
    if (this.history.record(this.composition.pieces)) this.render();
  }

  private coalesced(key: string, fn: () => void) {
    this.coalesceKey = key;
    try {
      fn();
    } finally {
      this.coalesceKey = null;
    }
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  private flushSave() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    try {
      localStorage.setItem(STORAGE_KEY, serializeToString(this.composition.pieces));
    } catch {
      /* storage full, blocked or unavailable: carry on without saving */
    }
  }

  undo() {
    this.stepHistory('undo', () => this.history.undo());
  }

  redo() {
    this.stepHistory('redo', () => this.history.redo());
  }

  private stepHistory(kind: 'undo' | 'redo', fn: () => readonly Piece[] | undefined) {
    if (this.inGesture) return;
    const snap = fn();
    this.say(announceHistory(kind, !!snap));
    if (!snap) return;
    this.applying = true;
    try {
      this.composition.restore(snap); // render() drops the selection if that piece no longer exists
    } finally {
      this.applying = false;
    }
  }

  private clearBoard() {
    this.composition.clear();
  }

  private showConfirm(on: boolean) {
    this.historyEl.querySelector<HTMLElement>('.main')!.hidden = on;
    this.historyEl.querySelector<HTMLElement>('.confirm')!.hidden = !on;
    if (on) this.say('Clear everything? Choose Clear to confirm or Cancel. Escape cancels.');
    const target = on ? 'clear-no' : 'clear';
    this.historyEl.querySelector<HTMLButtonElement>(`[data-history=${target}]`)!.focus();
  }

  private confirming(): boolean {
    return !this.historyEl.querySelector<HTMLElement>('.confirm')!.hidden;
  }

  private onHistoryClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button');
    const act = b?.dataset.history;
    if (!b || !act) return;
    if (act === 'undo') this.undo();
    else if (act === 'redo') this.redo();
    else if (act === 'clear') this.showConfirm(true);
    else if (act === 'clear-no') this.showConfirm(false);
    else if (act === 'clear-yes') {
      this.clearBoard();
      this.say('Board cleared.');
      this.showConfirm(false);
      this.surface.focus();
    }
    if (b.disabled) this.surface.focus(); // keep keyboard focus alive when the pressed button turns off
  }

  // ---- share and export -------------------------------------------------------

  /** Share URL for the current composition: `<share-base>#c=<encoded>`. The base is the `share-base` attribute, else this page without its hash. */
  async getShareUrl(): Promise<string> {
    const ver = this.shareVer;
    const base = this.shareBase();
    const url = buildShareUrl(base, await encode(this.getComposition()));
    if (ver === this.shareVer) this.shareCache = { url, ver, base };
    return url;
  }

  private shareBase(): string {
    let base = this.getAttribute('share-base') || location.href;
    try {
      base = new URL(base, location.href).href;
    } catch {
      base = location.href;
    }
    return base;
  }

  /**
   * Safari only allows `navigator.clipboard.writeText` synchronously inside the user gesture, and encoding is
   * async. So the URL is precomputed shortly after every composition change; the Share click then uses it directly.
   */
  private scheduleShareUrl() {
    this.shareVer++;
    this.shareCache = null;
    clearTimeout(this.shareTimer);
    if (!this.composition.pieces.length) return;
    this.shareTimer = window.setTimeout(() => void this.getShareUrl().catch(() => {}), SHARE_PRECOMPUTE_MS);
  }

  /** The composition as a standalone SVG string (the same renderer the PNG uses): texture, shadows, pieces. */
  exportSVG(): string {
    return this.renderExport().svg;
  }

  private renderExport(opaqueBase = true) {
    const t = this.texture ?? fridgeTexture();
    return renderCompositionSvg(this.composition.pieces, (id) => SHAPE_BY_ID.get(id), { href: t.href, units: t.units }, opaqueBase);
  }

  /** The composition rasterised at 2x (longest side capped at 4096 px). */
  async exportPNG(): Promise<Blob> {
    const r = this.renderExport(false);
    const { width, height } = pngSize(r.width, r.height);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('could not rasterise the composition'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`;
    });
    await img.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    // Lay the same texture tile first, mapped exactly like the SVG's board-space pattern. Some WebKit
    // versions draw an SVG image's nested data-URL <image> late or not at all; this keeps the PNG right.
    const t = this.texture ?? fridgeTexture();
    const pat = ctx.createPattern(t.canvas, 'repeat');
    const vb = /viewBox="([-\d.]+) ([-\d.]+)/.exec(r.svg)!;
    const sc = width / r.width;
    if (pat) {
      pat.setTransform(new DOMMatrix().scale(sc).translate(-Number(vb[1]), -Number(vb[2])).scale(t.units / t.px));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  }

  private notice(text: string) {
    this.noticeEl.textContent = text;
    this.noticeEl.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeEl.hidden = true;
      this.noticeEl.textContent = '';
    }, NOTICE_MS);
  }

  private showExportMenu(on: boolean) {
    this.shareEl.querySelector<HTMLElement>('.exportmenu')!.hidden = !on;
    this.shareEl.querySelector('[data-share=export]')!.setAttribute('aria-expanded', String(on));
  }

  private showLinkBox(url: string) {
    this.linkboxEl.hidden = false;
    this.say('Copying was blocked. The share link is selected: copy it from the field.');
    const input = this.linkboxEl.querySelector<HTMLInputElement>('input')!;
    input.value = url;
    input.focus();
    input.select();
  }

  private hideLinkBox() {
    this.linkboxEl.hidden = true;
    // On phones the share button lives in the menu: focus goes back to the menu button.
    (this.isCompact ? this.menuBtn : this.shareEl.querySelector<HTMLButtonElement>('[data-share=copy]')!).focus();
  }

  private onShareClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.share === 'copy') this.copyShareLink();
    else if (b.dataset.share === 'export') this.showExportMenu(!!this.shareEl.querySelector<HTMLElement>('.exportmenu')!.hidden);
    else if (b.dataset.export === 'png' || b.dataset.export === 'svg') {
      this.showExportMenu(false);
      this.shareEl.querySelector<HTMLButtonElement>('[data-share=export]')!.focus(); // the menu button just vanished
      void this.download(b.dataset.export);
    }
  }

  private copyShareLink() {
    const c = this.shareCache;
    if (c && c.ver === this.shareVer && c.base === this.shareBase() && navigator.clipboard?.writeText) {
      // Fast path: the URL is ready, so the clipboard write happens synchronously inside the click.
      let p: Promise<void>;
      try {
        p = navigator.clipboard.writeText(c.url);
      } catch {
        p = Promise.reject(new Error('clipboard unavailable'));
      }
      p.then(() => this.linkCopied(), () => this.showLinkBox(c.url));
      return;
    }
    void this.copyShareLinkSlow(); // precompute stale or pending: compute now (may end at the selectable field)
  }

  private async copyShareLinkSlow() {
    const url = await this.getShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      this.linkCopied();
    } catch {
      this.showLinkBox(url); // clipboard unavailable or refused: let the visitor copy it by hand
    }
  }

  private linkCopied() {
    this.hideLinkBoxQuietly();
    this.notice('Link copied');
    this.say('Link copied.');
  }

  private hideLinkBoxQuietly() {
    this.linkboxEl.hidden = true;
  }

  private async download(kind: 'png' | 'svg') {
    try {
      const name = exportFilename(kind);
      const blob = kind === 'png' ? await this.exportPNG() : new Blob([this.exportSVG()], { type: 'image/svg+xml' });
      const file = new File([blob], name, { type: blob.type });
      const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      if (touch && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          this.say(`${kind.toUpperCase()} shared.`);
          return;
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return; // the visitor closed the share sheet
          // otherwise fall through to a plain download
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.say(`${kind.toUpperCase()} exported.`);
    } catch (err) {
      console.warn('fridgeface: export failed', err);
      this.notice("Couldn't export that");
      this.say("Couldn't export that.");
    }
  }

  /** Apply `#c=` from the location, if present: one undoable load, framed, then the hash is removed. */
  private async consumeHash() {
    const enc = encodedFromHash(location.hash);
    if (enc === null) return;
    try {
      history.replaceState(history.state, '', location.pathname + location.search); // a reload then uses auto-save
    } catch {
      /* some sandboxes forbid it: harmless */
    }
    const r = await decode(enc);
    if (!r.ok || (r.pieces.length === 0 && r.dropped > 0)) {
      this.notice("That link couldn't be opened");
      this.say("That link couldn't be opened.");
      return;
    }
    this.applyLoaded(r.pieces, true);
  }

  private renderShareUi() {
    if (!this.shareEl) return;
    const empty = this.composition.pieces.length === 0;
    for (const sel of ['[data-share=copy]', '[data-share=export]']) this.shareEl.querySelector<HTMLButtonElement>(sel)!.disabled = empty;
    if (empty) this.showExportMenu(false);
    if (this.menuEl) {
      for (const k of ['share', 'download']) this.menuEl.querySelector(`[data-menu=${k}]`)!.setAttribute('aria-disabled', String(empty));
      if (empty) this.setDownloadOpen(false);
    }
  }

  // ---- phone menu (compact layout only) -----------------------------------------------

  private get isCompact(): boolean {
    return !!this.rootEl && this.rootEl.hasAttribute('data-compact');
  }

  private get menuOpen(): boolean {
    return !!this.menuEl && !this.menuEl.hidden;
  }

  private readonly onDocPointerDown = (e: Event) => {
    const path = e.composedPath();
    if (path.includes(this.menuEl) || path.includes(this.menuBtn)) return; // the button's own click toggles
    this.closeMenu(false); // an outside tap: it still does whatever it was aimed at
  };

  /** Open the menu and focus its first item (or, with `download`, the PNG choice). Compact layout only. */
  private openMenu(download = false) {
    if (!this.isCompact || this.menuOpen) return;
    this.showExportMenu(false);
    this.menuEl.hidden = false;
    this.menuBtn.setAttribute('aria-expanded', 'true');
    this.setDownloadOpen(download && this.composition.pieces.length > 0);
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
    this.positionMenu();
    const first = download && !this.menuEl.querySelector<HTMLElement>('.sub')!.hasAttribute('hidden') ? '[data-menu=png]' : '[data-menu=share]';
    this.menuEl.querySelector<HTMLElement>(first)!.focus();
  }

  private closeMenu(refocus: boolean) {
    if (!this.menuOpen) return;
    this.menuEl.hidden = true;
    this.menuBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    if (refocus) this.menuBtn.focus();
  }

  private setDownloadOpen(on: boolean) {
    this.menuEl.querySelector<HTMLElement>('.sub')!.hidden = !on;
    this.menuEl.querySelector('[data-menu=download]')!.setAttribute('aria-expanded', String(on));
    if (this.menuOpen) {
      this.positionMenu();
      if (on) this.menuEl.scrollTop = this.menuEl.scrollHeight; // a short screen may clip the choices: show them
    }
  }

  /** Anchor the menu to its button, right edges aligned, above it if it fits (else below), always inside the element. */
  private positionMenu() {
    const m = this.menuEl;
    const host = this.getBoundingClientRect();
    const b = this.menuBtn.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const px = (v: string) => parseFloat(v) || 0;
    const cs = getComputedStyle(this.rootEl);
    let top0 = edge + px(cs.getPropertyValue('--sat'));
    if (!this.actions.hidden) top0 = Math.max(top0, this.actions.getBoundingClientRect().bottom - host.top + gap); // never over the piece action bar
    m.style.maxHeight = '';
    m.style.top = '0px';
    m.style.left = '0px';
    const mw = m.offsetWidth;
    const mh = m.scrollHeight;
    const above = b.top - host.top - gap - top0;
    const below = host.bottom - b.bottom - gap - edge;
    const up = mh <= above || above >= below;
    const room = Math.max(0, up ? above : below);
    const h = Math.min(mh, room);
    m.style.maxHeight = `${h}px`;
    const minLeft = edge + px(cs.getPropertyValue('--sal'));
    const maxLeft = host.width - mw - edge - px(cs.getPropertyValue('--sar'));
    m.style.left = `${Math.round(Math.max(minLeft, Math.min(b.right - host.left - mw, maxLeft)))}px`;
    m.style.top = `${Math.round(up ? b.top - host.top - gap - h : b.bottom - host.top + gap)}px`;
  }

  private onMenuClick(e: MouseEvent) {
    const it = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-menu]');
    if (!it) return;
    const id = it.dataset.menu;
    if (it.getAttribute('aria-disabled') === 'true') return; // disabled items stay focusable (menu convention) but do nothing
    if (id === 'download') {
      this.setDownloadOpen(this.menuEl.querySelector<HTMLElement>('.sub')!.hasAttribute('hidden'));
    } else if (id === 'share') {
      this.closeMenu(true);
      this.copyShareLink();
    } else if (id === 'png' || id === 'svg') {
      this.closeMenu(true);
      void this.download(id);
    } else if (id === 'letters') {
      this.closeMenu(false);
      this.openSuggestions(this.menuBtn);
    } else if (id === 'help') {
      this.closeMenu(false);
      this.openHelp(this.menuBtn);
    }
  }

  /** Menu keys while it is open. Returns true when the key is fully handled. */
  private onMenuKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.closeMenu(true);
      e.preventDefault();
      return true;
    }
    if (e.key === 'Tab') {
      this.closeMenu(true); // focus is back on the menu button; the browser's Tab continues from there
      return true;
    }
    const items = [...this.menuEl.querySelectorAll<HTMLElement>('[role=menuitem]')].filter((i) => i.offsetParent !== null);
    const i = items.indexOf(this.shadowRoot!.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % items.length : e.key === 'ArrowUp' ? (i <= 0 ? items.length - 1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (to >= 0) {
      items[to]?.focus();
      e.preventDefault();
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ' || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return false;
    this.closeMenu(true); // any other key (C, E, L, ?, a number...) closes the menu, then does its usual thing
    return false;
  }

  // ---- geometry helpers -------------------------------------------------

  /** CSS px per board unit at zoom 1 (from `--k`), cached by syncViewBox so per-frame paths never read styles. */
  private get k(): number {
    return this.kCache || this.readK();
  }

  private readK(): number {
    return parseFloat(getComputedStyle(this.boardEl).getPropertyValue('--k')) || 0.3;
  }

  /** Board units are `k` CSS px: size the viewBox to the board's pixel size divided by k. */
  private syncViewBox() {
    const r = this.boardEl.getBoundingClientRect();
    const k = (this.kCache = this.readK());
    if (!r.width || !r.height) return;
    this.vpCache = { width: r.width / k, height: r.height / k };
    this.pxZoom = NaN; // k may have changed: refresh the shadows' screen-px scale
    this.surface.setAttribute('viewBox', `0 0 ${r.width / k} ${r.height / k}`);
  }

  /** Client point -> screen (viewBox) units, the camera's input space. */
  private clientToScreen(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.boardEl.getBoundingClientRect();
    const k = this.k;
    return { x: (clientX - r.left) / k, y: (clientY - r.top) / k };
  }

  /** Client point -> board units, through the camera state (not the DOM, which lags by a frame). */
  private toBoard(clientX: number, clientY: number): { x: number; y: number } {
    return screenToBoard(this.view, this.clientToScreen(clientX, clientY));
  }

  private viewport(): { width: number; height: number } {
    if (this.vpCache) return this.vpCache;
    const r = this.boardEl.getBoundingClientRect();
    const k = this.k;
    return { width: r.width / k, height: r.height / k };
  }

  // ---- camera ---------------------------------------------------------------

  /** Current view (a copy). zoom 1 = default; screen = board * zoom + (x, y) in viewBox units (CSS px / k). */
  getView(): Camera {
    return { ...this.view };
  }

  private setView(c: Camera) {
    this.view = c;
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.applyView();
      });
    }
  }

  /**
   * The only per-frame work for pan and zoom: the camera transform and the texture rect's bounds. On a ZOOM
   * change only, the screen-px scale `--px` (shadows) and the selection overlay are updated too.
   */
  private applyView() {
    const { x, y, zoom } = this.view;
    this.cameraEl.setAttribute('transform', `matrix(${zoom} 0 0 ${zoom} ${x} ${y})`);
    // The texture lives in BOARD space (it moves and scales with the view); its rect just covers the viewport.
    const vp = this.viewport();
    const tl = screenToBoard(this.view, { x: 0, y: 0 });
    const r = this.textureRect;
    r.setAttribute('x', String(tl.x - 2));
    r.setAttribute('y', String(tl.y - 2));
    r.setAttribute('width', String(vp.width / zoom + 4));
    r.setAttribute('height', String(vp.height / zoom + 4));
    if (zoom !== this.pxZoom) {
      this.pxZoom = zoom;
      this.cameraEl.style.setProperty('--px', `${1 / (this.k * zoom)}px`);
    }
    if (zoom !== this.overlayZoom) this.renderOverlay();
    for (const fn of this.viewListeners) fn();
  }

  /** The zoom at which a positive stem is COMFORT_STEM of the board's shorter visible side. */
  comfortZoom(): number {
    const vp = this.viewport();
    const side = Math.min(vp.width, vp.height);
    return side > 0 ? (COMFORT_STEM * side) / STEM_LENGTH : DEFAULT_CAMERA.zoom;
  }

  /** The default view: comfortable scale, board origin at the top-left. */
  private defaultView(): Camera {
    return { x: 0, y: 0, zoom: this.comfortZoom() };
  }

  /** A view with the board origin (x = 0, the baseline y = 0) comfortably in sight, left of centre and below the middle. */
  private originView(): Camera {
    const vp = this.viewport();
    return { x: vp.width * 0.3, y: vp.height * 0.62, zoom: this.comfortZoom() };
  }

  private zoomBy(factor: number) {
    const vp = this.viewport();
    this.setView(zoomAt(this.view, { x: vp.width / 2, y: vp.height / 2 }, factor));
    this.sayLater('zoom', () => announceZoom(this.view.zoom / this.comfortZoom()));
  }

  private frameAll() {
    this.fitToComposition();
    this.say(this.composition.pieces.length ? 'Framed all pieces.' : 'View reset.');
  }

  /** Pan by a screen-pixel step in the direction of the arrow key (the board moves the other way). */
  private panKey(dx: number, dy: number, big: boolean) {
    const px = (big ? 4 : 1) * PAN_KEY_PX;
    const k = this.k;
    this.setView(panBy(this.view, (-dx * px) / k, (-dy * px) / k));
    this.sayLater('pan', () => 'Panned.');
  }

  /** Pan (keeping the zoom) only if the piece is off the visible board or too close to its edge. */
  private revealPiece(p: Piece) {
    const vp = this.viewport();
    const at = { x: p.x * this.view.zoom + this.view.x, y: p.y * this.view.zoom + this.view.y };
    const m = 48 / this.k;
    if (at.x >= m && at.x <= vp.width - m && at.y >= m && at.y <= vp.height - m) return;
    this.setView({ ...this.view, x: vp.width / 2 - p.x * this.view.zoom, y: vp.height / 2 - p.y * this.view.zoom });
  }

  // ---- announcements (one polite live region) -------------------------------------

  /** Queue text for the live region; texts arriving within a few ms are read together. */
  private say(text: string) {
    if (!this.liveEl || !text) return;
    if (this.sayQueue[this.sayQueue.length - 1] !== text) this.sayQueue.push(text);
    if (this.sayTimer) return;
    this.sayTimer = window.setTimeout(() => {
      this.sayTimer = 0;
      const out = this.sayQueue.join(' ');
      this.sayQueue = [];
      this.liveEl.textContent = ''; // clear first so a repeated message is announced again
      this.liveEl.textContent = out;
      clearTimeout(this.sayClearTimer);
      this.sayClearTimer = window.setTimeout(() => (this.liveEl.textContent = ''), 10_000);
    }, ANNOUNCE_BATCH_MS);
  }

  /** Rapid input (1 degree rotations, nudges, zoom steps): say only the final state, once input pauses. */
  private sayLater(key: string, text: () => string | null) {
    clearTimeout(this.later.get(key));
    this.later.set(key, window.setTimeout(() => {
      this.later.delete(key);
      const t = text();
      if (t) this.say(t);
    }, ANNOUNCE_SETTLE_MS));
  }

  private nameOf(p: Piece): string {
    return SHAPE_BY_ID.get(p.shapeId)!.name;
  }

  private rotationText(id: string): string | null {
    const p = this.composition.getPiece(id);
    return p ? announceRotated(this.nameOf(p), fromUpright(this.offsetOf(p), p.rotation)) : null;
  }

  private movedText(id: string): string | null {
    const p = this.composition.getPiece(id);
    return p ? announceMoved(this.nameOf(p)) : null;
  }

  private sayRotation(id: string) {
    this.sayLater(`rot:${id}`, () => this.rotationText(id));
  }

  private sayMoved(id: string) {
    this.sayLater(`move:${id}`, () => this.movedText(id));
  }

  // ---- layout state ------------------------------------------------------------------

  /**
   * data-compact (narrow OR short) and data-short (short) on the shadow root's top elements, from the host's own size.
   * Replaces @container queries, under which a real iPhone showed the desktop layout (cause unconfirmed).
   */
  private syncLayout() {
    if (!this.rootEl) return;
    const { compact, short } = layoutState(this.clientWidth, this.clientHeight); // the host's own (untransformed) box
    for (const el of [this.rootEl, this.helpEl]) {
      el.toggleAttribute('data-compact', compact);
      el.toggleAttribute('data-short', short);
    }
    if (this.menuEl) {
      if (!compact) this.closeMenu(false);
      else if (this.menuOpen) this.positionMenu();
    }
  }

  // ---- insets ------------------------------------------------------------------------

  /** Safe-area insets, but only the part that overlaps THIS element (an embedded box mid-page needs none). */
  private syncInsets() {
    if (!this.insetProbe) return;
    const cs = getComputedStyle(this.insetProbe);
    const r = this.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const px = (v: string) => parseFloat(v) || 0;
    // How far the element's edge is from the matching screen edge (never negative); the inset only counts where it overlaps.
    const over = (inset: number, gap: number) => (inset > 0 ? Math.max(0, inset - Math.max(0, gap)) : 0);
    const t = over(px(cs.paddingTop), r.top);
    const rt = over(px(cs.paddingRight), vw - r.right);
    const b = over(px(cs.paddingBottom), vh - r.bottom);
    const l = over(px(cs.paddingLeft), r.left);
    const key = `${t}|${rt}|${b}|${l}`;
    if (key === this.insets) return;
    this.insets = key;
    for (const st of [this.rootEl.style, this.helpEl.style]) {
      st.setProperty('--sat', `${t}px`);
      st.setProperty('--sar', `${rt}px`);
      st.setProperty('--sab', `${b}px`);
      st.setProperty('--sal', `${l}px`);
    }
  }

  // ---- keyboard shortcuts dialog -------------------------------------------------------

  private get helpOpen(): boolean {
    return !!this.helpEl && !this.helpEl.hidden;
  }

  private openHelp(opener?: HTMLElement | null) {
    if (this.helpOpen) return;
    this.helpOpener = opener?.closest?.('button') ?? (this.shadowRoot!.activeElement as HTMLElement | null) ?? this.surface;
    this.showExportMenu(false);
    this.helpEl.hidden = false;
    this.rootEl.inert = true; // contains focus and hides the rest from assistive tech while the dialog is open
    this.helpEl.querySelector<HTMLElement>('[data-help=close]')!.focus();
  }

  private closeHelp() {
    if (!this.helpOpen) return;
    this.helpEl.hidden = true;
    this.rootEl.inert = false;
    const back: HTMLElement | SVGElement = this.helpOpener && this.helpOpener.isConnected && !(this.helpOpener as HTMLButtonElement).disabled ? this.helpOpener : this.surface;
    this.helpOpener = null;
    back.focus();
  }

  /** Dialog keys: Escape closes; Tab and Shift+Tab wrap inside the dialog. */
  private onHelpKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.closeHelp();
      e.preventDefault();
    } else if (e.key === 'Tab') {
      const items = [...this.helpEl.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
      const active = this.shadowRoot!.activeElement as HTMLElement | null;
      const i = active ? items.indexOf(active) : -1;
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i < 0 || i === items.length - 1 ? 0 : i + 1;
      items[next]?.focus();
      e.preventDefault();
    } else if (e.key === '?') {
      this.closeHelp();
      e.preventDefault();
    }
  }

  /** Frame every piece (rotated bounds) with a margin; with no pieces, reset to the default view. */
  fitToComposition() {
    const b = rotatedBounds(this.composition.pieces, (id) => SHAPE_BY_ID.get(id));
    if (!b) {
      this.setView(this.defaultView());
      return;
    }
    this.setView(fitTo(b, this.viewport(), FIT_MARGIN / this.k, FIT_MAX_COMFORT * this.comfortZoom()));
  }

  private setSpace(on: boolean) {
    if (this.spaceDown === on) return;
    this.spaceDown = on;
    this.boardEl?.classList.toggle('space', on);
  }

  private onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) e.preventDefault(); // pinch arrives as ctrl+wheel: the page must never zoom
    if (e.composedPath().some((n) => n instanceof HTMLElement && n.hasAttribute('data-scroll'))) return; // a scrolling panel keeps its wheel
    if (!this.overBoard(e.clientX, e.clientY)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.boardEl.clientHeight : 1;
    if (e.ctrlKey || e.metaKey) {
      const d = Math.max(-60, Math.min(60, e.deltaY * unit));
      this.setView(zoomAt(this.view, this.clientToScreen(e.clientX, e.clientY), Math.exp(-d * 0.0075)));
    } else {
      const k = this.k;
      this.setView(panBy(this.view, (-e.deltaX * unit) / k, (-e.deltaY * unit) / k));
    }
  }

  private overBoard(clientX: number, clientY: number): boolean {
    const r = this.boardEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  // ---- adding pieces ----------------------------------------------------

  private addAt(shape: Shape, x: number, y: number) {
    const p = this.composition.addPiece(shape.id, x, y);
    this.select(p.id);
    this.say(announceAdded(shape.name, this.composition.pieces.length));
  }

  private addNearCentre(shape: Shape) {
    const r = this.boardEl.getBoundingClientRect();
    const c = this.toBoard(r.left + r.width / 2, r.top + r.height / 2);
    let { x, y } = c;
    while (this.composition.pieces.some((p) => p.x === x && p.y === y)) {
      x += 12;
      y += 12;
    }
    this.addAt(shape, x, y);
  }

  private shapeOf(target: EventTarget | null): Shape | undefined {
    const b = (target as HTMLElement | null)?.closest?.('button[data-shape]') as HTMLElement | null;
    return b ? SHAPE_BY_ID.get(b.dataset.shape!) : undefined;
  }

  private onTrayDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const shape = this.shapeOf(e.target);
    if (!shape || this.trayDrag) return;
    this.suppressClick = false;
    this.trayDrag = { pointerId: e.pointerId, shape, startX: e.clientX, startY: e.clientY, active: false };
    (e.target as HTMLElement).closest('button')!.setPointerCapture(e.pointerId);
  }

  private onTrayMove(e: PointerEvent) {
    const d = this.trayDrag;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.active = true;
      const s = d.shape;
      const prev = document.createElement('div');
      prev.className = 'preview';
      prev.style.width = `${(s.bbox.w + 2 * PAD) * this.k * this.view.zoom}px`;
      prev.style.height = `${(s.bbox.h + 2 * PAD) * this.k * this.view.zoom}px`;
      prev.innerHTML = shapeSvg(s);
      prev.classList.add('lifted'); // a piece in the hand casts the lifted shadow
      prev.style.setProperty('--px', `${1 / (this.k * this.view.zoom)}px`);
      this.shadowRoot!.appendChild(prev);
      d.preview = prev;
    }
    // Keep the shape's centroid under the pointer, matching where the piece will land.
    const s = d.shape;
    const k = this.k * this.view.zoom; // the ghost is drawn at the size the piece will land at
    // The ghost is positioned against the host (layout containment makes it the containing block), so subtract its origin.
    const host = this.getBoundingClientRect();
    d.preview!.style.left = `${e.clientX - host.left - (s.centroid.x - (s.bbox.x - PAD)) * k}px`;
    d.preview!.style.top = `${e.clientY - host.top - (s.centroid.y - (s.bbox.y - PAD)) * k}px`;
  }

  private onTrayUp(e: PointerEvent) {
    this.endTrayDrag(e, true);
  }

  private endTrayDrag(e: PointerEvent, commit: boolean) {
    const d = this.trayDrag;
    if (!d || d.pointerId !== e.pointerId) return;
    this.trayDrag = null;
    d.preview?.remove();
    if (!d.active) return; // a plain press: the click event adds the piece
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 100);
    if (commit && this.overBoard(e.clientX, e.clientY)) {
      const p = this.toBoard(e.clientX, e.clientY);
      this.addAt(d.shape, p.x, p.y);
    }
  }

  private onTrayClick(e: MouseEvent) {
    // detail === 0 means keyboard-initiated (Enter/Space); drags must not also add.
    if (this.suppressClick && e.detail !== 0) return;
    const shape = this.shapeOf(e.target);
    if (shape) this.addNearCentre(shape);
  }

  // ---- selecting and moving ----------------------------------------------

  private select(id: string | null) {
    this.selectedId = id;
    this.render();
  }

  /** N / P: step the selection through the stacking order (bottom to top, wrapping). */
  private cycleSelection(dir: 1 | -1) {
    const pieces = this.composition.pieces;
    if (!pieces.length) {
      this.say('No pieces on the board.');
      return;
    }
    const cur = this.selectedId ? this.composition.indexOf(this.selectedId) : -1;
    const i = cur < 0 ? (dir === 1 ? 0 : pieces.length - 1) : (cur + dir + pieces.length) % pieces.length;
    const p = pieces[i];
    this.select(p.id);
    this.revealPiece(p);
    this.say(announceSelected(this.nameOf(p), i, pieces.length, fromUpright(this.offsetOf(p), p.rotation)));
  }

  private onBoardDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        if (this.touches.size === 2 && !this.twist && !this.pinch) {
          // Twist rotates a piece only if the first finger landed on it (or its handle); otherwise two fingers pinch/pan the board.
          if ((this.moving || this.rotating) && this.selectedId) this.startTwist(e);
          else this.startPinch();
        }
        return; // extra fingers never select or move anything
      }
    }
    if (this.spaceDown || e.button === 1) {
      this.startPan(e, true);
      e.preventDefault();
      return;
    }
    const handle = (e.target as Element).closest?.('[data-handle]');
    const sel = this.selectedId ? this.composition.getPiece(this.selectedId) : undefined;
    if (handle && sel) {
      const pt = this.toBoard(e.clientX, e.clientY);
      this.rotating = { pointerId: e.pointerId, id: sel.id, grab: this.angleTo(sel, pt), startRot: sel.rotation };
      this.surface.setPointerCapture(e.pointerId);
      this.syncLift();
      e.preventDefault();
      return;
    }
    const id = (e.target as Element).closest?.('[data-piece-id]')?.getAttribute('data-piece-id') ?? null;
    if (!id) {
      this.startPan(e, false); // a click without movement deselects (on release)
      return;
    }
    const piece = this.composition.getPiece(id);
    if (!piece) return;
    this.select(id); // selecting never changes stacking order
    this.moving = { pointerId: e.pointerId, id, startPt: this.toBoard(e.clientX, e.clientY), startX: piece.x, startY: piece.y };
    this.surface.setPointerCapture(e.pointerId);
  }

  private startPan(e: PointerEvent, active: boolean) {
    this.pan = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startView: { ...this.view }, active };
    if (active) this.boardEl.classList.add('panning');
    this.surface.setPointerCapture(e.pointerId);
  }

  private startPinch() {
    const ids = [...this.touches.keys()].slice(0, 2) as [number, number];
    this.pan = null;
    this.boardEl.classList.remove('panning');
    this.pinch = { ids, ...this.pinchState(ids) } as typeof this.pinch;
  }

  private pinchState(ids: [number, number]) {
    const a = this.touches.get(ids[0])!, b = this.touches.get(ids[1])!;
    return {
      lastMid: this.clientToScreen((a.x + b.x) / 2, (a.y + b.y) / 2),
      lastDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    };
  }

  private angleTo(p: Piece, pt: { x: number; y: number }): number {
    return (Math.atan2(pt.y - p.y, pt.x - p.x) * 180) / Math.PI;
  }

  private offsetOf(p: Piece): number {
    return SHAPE_BY_ID.get(p.shapeId)!.uprightOffsetDeg;
  }

  /** Apply a raw (unsnapped) rotation, snapping to the nearest step from upright when asked. */
  private applyRaw(p: Piece, raw: number, snap: boolean) {
    const off = this.offsetOf(p);
    this.composition.setRotation(p.id, snap ? rotationFor(off, snapNearest(off + raw)) : raw);
  }

  private startTwist(e: PointerEvent) {
    const sel = this.composition.getPiece(this.selectedId!);
    const [a, b] = [...this.touches.values()];
    if (!sel || !a || !b) return;
    this.moving = null;
    this.rotating = null;
    this.surface.setPointerCapture(e.pointerId);
    this.twist = {
      id: sel.id,
      lastAngle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      accum: 0,
      startRot: sel.rotation,
      startPos: { x: sel.x, y: sel.y },
      startMid: this.toBoard((a.x + b.x) / 2, (a.y + b.y) / 2),
    };
    this.syncLift();
  }

  private onBoardMove(e: PointerEvent) {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pn = this.pinch;
    if (pn) {
      if (!this.touches.has(pn.ids[0]) || !this.touches.has(pn.ids[1])) return;
      const next = this.pinchState(pn.ids);
      let v = zoomAt(this.view, pn.lastMid, next.lastDist / pn.lastDist);
      v = panBy(v, next.lastMid.x - pn.lastMid.x, next.lastMid.y - pn.lastMid.y);
      this.setView(v);
      pn.lastMid = next.lastMid;
      pn.lastDist = next.lastDist;
      return;
    }
    const pa = this.pan;
    if (pa && pa.pointerId === e.pointerId) {
      if (!pa.active) {
        if (Math.hypot(e.clientX - pa.startX, e.clientY - pa.startY) < PAN_THRESHOLD) return;
        pa.active = true;
        this.boardEl.classList.add('panning');
      }
      const k = this.k;
      this.setView(panBy(pa.startView, (e.clientX - pa.startX) / k, (e.clientY - pa.startY) / k));
      return;
    }
    const t = this.twist;
    if (t) {
      const piece = this.composition.getPiece(t.id);
      const [a, b] = [...this.touches.values()];
      if (!piece || !a || !b) return;
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      t.accum += normalise(ang - t.lastAngle);
      t.lastAngle = ang;
      const mid = this.toBoard((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.composition.movePiece(t.id, t.startPos.x + (mid.x - t.startMid.x), t.startPos.y + (mid.y - t.startMid.y));
      this.applyRaw(this.composition.getPiece(t.id)!, t.startRot + t.accum, this.snap);
      return;
    }
    const r = this.rotating;
    if (r && r.pointerId === e.pointerId) {
      const piece = this.composition.getPiece(r.id);
      if (!piece) return;
      const ang = this.angleTo(piece, this.toBoard(e.clientX, e.clientY));
      this.applyRaw(piece, r.startRot + (ang - r.grab), this.snap || e.shiftKey);
      return;
    }
    const m = this.moving;
    if (!m || m.pointerId !== e.pointerId) return;
    const pt = this.toBoard(e.clientX, e.clientY);
    if (!m.moved && pt.x === m.startPt.x && pt.y === m.startPt.y) return;
    m.moved = true;
    this.composition.movePiece(m.id, m.startX + (pt.x - m.startPt.x), m.startY + (pt.y - m.startPt.y));
    this.syncLift();
  }

  private onBoardUp(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    if (this.pinch && this.touches.size < 2) this.pinch = null; // the remaining finger does nothing
    if (this.pan && this.pan.pointerId === e.pointerId) {
      if (!this.pan.active && e.type === 'pointerup') this.select(null);
      this.pan = null;
      this.boardEl.classList.remove('panning');
    }
    // One summary per gesture, never per pixel.
    let said: (() => string | null) | null = null;
    if (this.twist && this.touches.size < 2) {
      const id = this.twist.id;
      this.twist = null; // ends cleanly; the remaining finger does nothing
      said = () => this.rotationText(id);
    }
    if (this.moving && this.moving.pointerId === e.pointerId) {
      const { id, moved } = this.moving;
      this.moving = null;
      if (moved) said = () => this.movedText(id);
    }
    if (this.rotating && this.rotating.pointerId === e.pointerId) {
      const id = this.rotating.id;
      this.rotating = null;
      said = () => this.rotationText(id);
    }
    this.syncLift();
    this.commitGesture();
    const t = said?.();
    if (t) this.say(t);
  }

  // ---- keyboard and actions -----------------------------------------------

  /** Rotate-by-step: dir 1 = clockwise, -1 = anticlockwise. Off-step angles snap toward upright first. */
  private stepRotate(id: string, dir: 1 | -1) {
    const p = this.composition.getPiece(id);
    if (!p) return;
    const off = this.offsetOf(p);
    this.composition.setRotation(id, rotationFor(off, stepFromUpright(fromUpright(off, p.rotation), dir)));
  }

  private setSnap(on: boolean) {
    this.snap = on;
    const p = on && this.selectedId ? this.composition.getPiece(this.selectedId) : undefined;
    this.say(announceSnap(on));
    if (p) {
      const off = this.offsetOf(p);
      if (this.composition.setRotation(p.id, rotationFor(off, snapTowardUpright(fromUpright(off, p.rotation))))) this.sayRotation(p.id);
    }
    this.render();
  }

  private runAction(act: string, id: string) {
    if (act === 'rotate-left' || act === 'rotate-right') {
      this.stepRotate(id, act === 'rotate-left' ? -1 : 1);
      this.sayRotation(id);
    } else if (act === 'snap') this.setSnap(!this.snap);
    else if (act === 'delete') {
      if (this.composition.deletePiece(id)) this.say(announceDeleted(this.composition.pieces.length));
    } else if (act === 'forward' || act === 'backward') {
      const dir = act === 'forward' ? 'forward' : 'backward';
      const moved = dir === 'forward' ? this.composition.bringForward(id) : this.composition.sendBackward(id);
      this.say(announceRestacked(dir, moved, this.composition.indexOf(id), this.composition.pieces.length));
    }
  }

  private nudge(id: string, x: number, y: number) {
    this.coalesced(`nudge:${id}`, () => this.composition.movePiece(id, x, y));
    this.sayMoved(id);
  }

  private onKey(e: KeyboardEvent) {
    if (this.helpOpen) {
      this.onHelpKey(e);
      return;
    }
    if (this.menuOpen && this.onMenuKey(e)) return;
    const origin = e.composedPath()[0] as HTMLElement | undefined;
    const inField = origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement;
    if (inField) {
      if (e.key === 'Escape' && !this.linkboxEl.hidden) { this.hideLinkBox(); e.preventDefault(); }
      return; // typing, selecting and copying in the share field are the browser's
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { if (e.shiftKey) this.redo(); else this.undo(); e.preventDefault(); return; }
      if (k === 'y' && e.ctrlKey) { this.redo(); e.preventDefault(); return; }
    }
    // Escape closes the innermost thing first: export menu, clear confirm, share field, then the selection.
    if (e.key === 'Escape') {
      if (!this.shareEl.querySelector<HTMLElement>('.exportmenu')!.hidden) {
        this.showExportMenu(false);
        this.shareEl.querySelector<HTMLButtonElement>('[data-share=export]')!.focus();
        e.preventDefault();
      } else if (this.confirming()) {
        this.showConfirm(false);
        e.preventDefault();
      } else if (!this.linkboxEl.hidden) {
        this.hideLinkBox();
        e.preventDefault();
      } else if (this.suggOpen) {
        this.closeSuggestions();
        e.preventDefault();
      } else if (this.selectedId) {
        this.select(null);
        this.say('Selection cleared.');
        e.preventDefault();
      }
      return;
    }
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (plain) {
      const inPanel = this.suggOpen && !!origin && this.suggEl.contains(origin);
      if (e.code === 'Space') {
        if (!origin?.closest?.('button')) {
          this.setSpace(true);
          e.preventDefault();
        }
        return;
      }
      if (e.key === '?') { this.openHelp(); e.preventDefault(); return; }
      if (e.key.toLowerCase() === 'l' && suggestionStore.size) { this.toggleSuggestions(); e.preventDefault(); return; }
      if (inPanel) return; // the panel's own buttons: only Tab, Enter and Space (the browser's) apply
      if (e.key === '+' || e.key === '=') { this.zoomBy(BUTTON_ZOOM); e.preventDefault(); return; }
      if (e.key === '-' || e.key === '_') { this.zoomBy(1 / BUTTON_ZOOM); e.preventDefault(); return; }
      if (e.shiftKey && e.code === 'Digit1') { this.frameAll(); e.preventDefault(); return; }
      if (!e.shiftKey && e.key >= '1' && e.key <= '5') { this.addNearCentre(SHAPES[Number(e.key) - 1]); e.preventDefault(); return; }
      const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
      if (letter === 'n' || letter === 'p') { this.cycleSelection(letter === 'n' ? 1 : -1); e.preventDefault(); return; }
      if (letter === 'f') { this.frameAll(); e.preventDefault(); return; }
      if (letter === 'c' || letter === 'e') {
        if (!this.composition.pieces.length) this.say('Nothing to share or export yet.');
        else if (letter === 'c') this.copyShareLink();
        else if (this.isCompact) {
          this.closeSuggestions(); // the sheet would cover the menu's button
          this.openMenu(true); // the export choices live in the menu on phones
        } else {
          this.showExportMenu(true);
          this.shareEl.querySelector<HTMLButtonElement>('[data-export=png]')!.focus();
        }
        e.preventDefault();
        return;
      }
    }
    // Arrow keys: move the selected piece, or pan the board (Alt always pans). Shift = bigger steps.
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as string] as [number, number] | undefined;
    const id = this.selectedId;
    if (arrow && !e.metaKey && !e.ctrlKey) {
      if (e.altKey || !id) {
        this.panKey(arrow[0], arrow[1], e.shiftKey);
        e.preventDefault();
        return;
      }
      const piece = this.composition.getPiece(id);
      if (!piece) return;
      const step = e.shiftKey ? 10 : 1;
      this.nudge(id, piece.x + arrow[0] * step, piece.y + arrow[1] * step);
      e.preventDefault();
      return;
    }
    if (['PageUp', 'PageDown', 'Home', 'End'].includes(e.key) && plain && origin === (this.surface as unknown)) {
      e.preventDefault(); // the focused board never scrolls the page behind it
      return;
    }
    if (!id || e.metaKey || e.ctrlKey || e.altKey) return;
    const piece = this.composition.getPiece(id);
    if (!piece) return;
    // Shift+, and Shift+. produce < and > on US layouts, so match on the physical key too.
    const rot = e.code === 'Period' || e.key === '.' || e.key === '>' ? 1 : e.code === 'Comma' || e.key === ',' || e.key === '<' ? -1 : 0;
    if (rot) {
      if (e.shiftKey) this.stepRotate(id, rot as 1 | -1);
      else this.coalesced(`rot1:${id}`, () => this.composition.rotatePiece(id, rot));
      this.sayRotation(id);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Delete':
      case 'Backspace': this.runAction('delete', id); break;
      case ']': this.runAction('forward', id); break;
      case '[': this.runAction('backward', id); break;
      case 's':
      case 'S': this.runAction('snap', id); break;
      default: return;
    }
    e.preventDefault();
  }


  // ---- letter suggestions ---------------------------------------------------------------

  private get suggOpen(): boolean {
    return !!this.suggEl && !this.suggEl.hidden;
  }

  /** The dock button exists only while there is at least one suggestion; the panel follows the store. */
  private syncSuggestions() {
    if (!this.suggEl) return;
    const has = suggestionStore.size > 0;
    this.suggBtn.hidden = !has;
    this.menuEl.querySelector<HTMLElement>('[data-menu=letters]')!.hidden = !has;
    if (this.menuOpen) this.positionMenu();
    this.helpEl.classList.toggle('has-sugg', has);
    if (!has && this.suggOpen) this.closeSuggestions();
    else if (this.suggOpen) this.renderSuggestions();
  }

  private toggleSuggestions(opener?: HTMLElement | null) {
    if (this.suggOpen) this.closeSuggestions();
    else this.openSuggestions(opener);
  }

  private openSuggestions(opener?: HTMLElement | null) {
    if (this.suggOpen || !suggestionStore.size) return;
    this.suggOpener = opener?.closest?.('button') ?? (this.shadowRoot!.activeElement as HTMLElement | null) ?? this.surface;
    this.showExportMenu(false);
    this.suggEl.hidden = false;
    this.suggBtn.setAttribute('aria-expanded', 'true');
    this.renderSuggestions();
    this.suggEl.querySelector<HTMLElement>('.sgchars button[aria-pressed=true], .sgwords button')?.focus();
  }

  private closeSuggestions() {
    if (!this.suggOpen) return;
    const hadFocus = this.suggEl.contains(this.shadowRoot!.activeElement);
    this.suggEl.hidden = true;
    this.suggBtn.setAttribute('aria-expanded', 'false');
    const o = this.suggOpener;
    this.suggOpener = null;
    if (!hadFocus) return; // focus was already elsewhere (the board, say): leave it there
    const back: HTMLElement | SVGElement = o && o.isConnected && !(o as HTMLButtonElement).disabled && !(o as HTMLElement).hidden ? o : this.surface;
    back.focus();
  }

  /** Letters: characters (rebuilt when the set changes) and the selected character's variants. Then the words. */
  private renderSuggestions() {
    const { letters, words } = splitSuggestions(suggestionStore.list);
    this.suggEl.querySelector<HTMLElement>('[data-sec=letters]')!.hidden = !letters.length;
    this.renderWords(words);
    const groups = groupByChar(letters);
    if (!this.suggChar || !groups.has(this.suggChar)) this.suggChar = groups.keys().next().value ?? null;
    const chars = this.suggEl.querySelector<HTMLElement>('.sgchars')!;
    const had = chars.contains(this.shadowRoot!.activeElement) ? (this.shadowRoot!.activeElement as HTMLElement).dataset.char : undefined;
    const sig = [...groups].map(([ch, v]) => `${ch}${v.length}`).join('|');
    if (chars.dataset.sig !== sig) {
      chars.dataset.sig = sig;
      chars.replaceChildren(
        ...[...groups].map(([ch, v]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'b';
          b.dataset.char = ch;
          b.textContent = ch;
          b.setAttribute('aria-label', `${ch}, ${v.length === 1 ? '1 way' : `${v.length} ways`} to build it`);
          return b;
        }),
      );
    }
    for (const b of chars.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.char === this.suggChar));
    if (had) chars.querySelector<HTMLElement>(`[data-char="${CSS.escape(had)}"]`)?.focus();
    this.renderVariants(groups.get(this.suggChar ?? '') ?? []);
  }

  private renderVariants(list: readonly Suggestion[]) {
    const head = this.suggEl.querySelector<HTMLElement>('.sgh')!;
    const box = this.suggEl.querySelector<HTMLElement>('.sgvars')!;
    head.replaceChildren('Ways to build ');
    if (this.suggChar) {
      const ch = document.createElement('span');
      ch.className = 'ch';
      ch.textContent = this.suggChar;
      head.append(ch);
    }
    box.replaceChildren(
      ...list.map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'b';
        b.dataset.file = s.filename;
        b.setAttribute('aria-label', `Place ${s.char}, variant ${s.variant}, on the board`);
        const img = document.createElement('img');
        img.alt = '';
        img.src = this.thumbnail(s);
        const n = document.createElement('span');
        n.className = 'vn';
        n.textContent = String(s.variant);
        b.append(img, n);
        return b;
      }),
    );
  }

  /** Word compositions: one thumbnail button per variant (only shown when at least one exists). */
  private renderWords(words: readonly WordSuggestion[]) {
    const sec = this.suggEl.querySelector<HTMLElement>('[data-sec=words]')!;
    const box = sec.querySelector<HTMLElement>('.sgwords')!;
    sec.hidden = !words.length;
    const list = [...groupByWord(words).values()].flat();
    const sig = list.map((w) => w.filename).join('|');
    if (box.dataset.sig === sig) return; // unchanged: keep the buttons (and focus)
    const had = box.contains(this.shadowRoot!.activeElement) ? (this.shadowRoot!.activeElement as HTMLElement).dataset.file : undefined;
    box.dataset.sig = sig;
    box.replaceChildren(
      ...list.map((w) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'b';
        b.dataset.file = w.filename;
        b.setAttribute('aria-label', `Place the word ${w.text}, variant ${w.variant}, on the board`);
        const img = document.createElement('img');
        img.alt = '';
        img.src = this.thumbnail(w);
        const n = document.createElement('span');
        n.className = 'vn';
        n.textContent = `${w.text} \u00b7 ${w.variant}`;
        b.append(img, n);
        return b;
      }),
    );
    if (had) box.querySelector<HTMLElement>(`[data-file="${CSS.escape(had)}"]`)?.focus();
  }

  /** A suggestion rendered by the export renderer (same shapes and shadows, no texture), as an image URL. */
  private thumbnail(s: AnySuggestion): string {
    let url = this.thumbs.get(s);
    if (!url) {
      url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderCompositionSvg(s.pieces, (id) => SHAPE_BY_ID.get(id)).svg)}`;
      this.thumbs.set(s, url);
    }
    return url;
  }

  private onSuggestionsClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('[data-sugg=close]')) {
      this.closeSuggestions();
      return;
    }
    const ch = t.closest<HTMLElement>('button[data-char]')?.dataset.char;
    if (ch) {
      this.suggChar = ch;
      this.renderSuggestions();
      return;
    }
    const file = t.closest<HTMLElement>('button[data-file]')?.dataset.file;
    const s = file ? suggestionStore.list.find((x) => x.filename === file) : undefined;
    if (s) this.placeSuggestion(s);
  }

  /** Add a letter's or a word's pieces on top of whatever is on the board, centred in the current view: ONE undo step. */
  private placeSuggestion(s: AnySuggestion) {
    const r = this.boardEl.getBoundingClientRect();
    const c = this.toBoard(r.left + r.width / 2, r.top + r.height / 2);
    const items = centreOn(s.pieces, (id) => SHAPE_BY_ID.get(id), c).map((p) => ({ ...p, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
    this.selectedId = null;
    const added = this.composition.addPieces(items);
    const total = this.composition.pieces.length;
    this.say(isWord(s) ? announceWord(s.text, s.variant, added.length, total) : announceSuggestion(s.char, s.variant, added.length, total));
    // On a phone the sheet would hide what was just placed: close it and hand focus back.
    if (getComputedStyle(this.suggEl).getPropertyValue('--sheet').trim() === '1') this.closeSuggestions();
  }

  // ---- the "play" intro ----------------------------------------------------------------

  /** First visit only: no saved composition, no share link, `no-intro` unset, and the word play exists (as a word composition, or as the letters p, l, a, y). */
  private maybeIntro(hadSaved: boolean, authoring: boolean) {
    const want = introWanted({ hasSavedComposition: hadSaved, hasShareLink: encodedFromHash(location.hash) !== null, disabled: this.hasAttribute('no-intro'), skip: authoring });
    if (!want) return;
    const pieces = introPieces(suggestionStore.list, (id) => SHAPE_BY_ID.get(id));
    if (!pieces) return;
    // The word is a normal composition and the starting state: not in undo history, auto-saved as usual.
    this.applyLoaded(pieces, false);
    this.scheduleSave();
    this.say(announceIntro(this.composition.pieces.length));
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return; // the pieces simply appear
    if (this.boardEl.clientWidth) this.startIntroAnimation();
    else this.introQueued = true;
  }

  /** Slide every piece in from the tray, staggered, in transforms only. Any pointer or key input finishes it at once. */
  private startIntroAnimation() {
    this.introQueued = false;
    this.render();
    const pieces = this.composition.pieces;
    const sched = introSchedule(pieces.length);
    const board = this.boardEl.getBoundingClientRect();
    const bottom = this.toBoard(0, board.bottom).y;
    this.introAnims = [];
    pieces.forEach((p, i) => {
      const g = this.els.get(p.id)?.g;
      const s = SHAPE_BY_ID.get(p.shapeId);
      if (!g || !s || typeof g.animate !== 'function') return;
      const tray = this.trayEl.querySelector(`[data-shape="${p.shapeId}"]`)?.getBoundingClientRect();
      const from = tray && tray.width ? this.toBoard(tray.left + tray.width / 2, tray.top + tray.height / 2) : this.toBoard(board.left + board.width / 2, board.bottom + 80);
      const y0 = Math.max(from.y, bottom + Math.hypot(s.bbox.w, s.bbox.h) / 2 + 6); // start fully below the board's edge
      this.introAnims.push(
        g.animate(
          [{ transform: `translate(${n3(from.x)}px, ${n3(y0)}px)` }, { transform: `translate(${n3(p.x)}px, ${n3(p.y)}px)` }],
          { duration: sched.duration, delay: sched.delays[i], easing: INTRO_EASE, fill: 'backwards' },
        ),
      );
    });
    if (!this.introAnims.length) return;
    for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(t, this.onIntroInput, { capture: true, passive: true });
    const mine = this.introAnims;
    void Promise.all(mine.map((a) => a.finished)).then(() => this.endIntro(mine), () => this.endIntro(mine));
  }

  /** Complete the intro instantly (no-op when it is not running). */
  private finishIntro() {
    this.introQueued = false;
    const anims = this.introAnims;
    if (!anims.length) return;
    for (const a of anims) {
      try {
        a.finish();
      } catch {
        a.cancel();
      }
    }
    this.endIntro(anims);
  }

  private endIntro(anims: Animation[]) {
    if (this.introAnims !== anims) return;
    this.introAnims = [];
    for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.removeEventListener(t, this.onIntroInput, { capture: true });
  }

  // ---- rendering ----------------------------------------------------------

  /** Selection box and rotate handle, drawn in board space but sized in screen pixels (counter-scaled by zoom). */
  private renderOverlay() {
    this.overlayZoom = this.view.zoom;
    this.overlay.replaceChildren();
    const sel = this.selectedId ? this.composition.getPiece(this.selectedId) : undefined;
    if (!sel) return;
    const s = SHAPE_BY_ID.get(sel.shapeId)!;
    const k = this.k * this.view.zoom; // CSS px per board unit: pad, gap and handle stay screen-sized at every zoom
    const pad = SELECT_PAD / k;
    const ub = s.uprightBox; // the shape's bounds in its upright frame, centroid at the origin
    const bx = ub.x - pad, by = ub.y - pad, bw = ub.w + 2 * pad, bh = ub.h + 2 * pad;
    const cx = bx + bw / 2; // the handle sits at the box's upright top centre
    const hy = by - HANDLE_GAP / k;
    const g = svgEl('g', {
      transform: `translate(${n3(sel.x)} ${n3(sel.y)}) rotate(${n3(fromUpright(s.uprightOffsetDeg, sel.rotation))})`,
      'pointer-events': 'none',
    });
    // Two-tone strokes (white under black dashes) read on black pieces, white pieces and the grey board.
    const line = (attrs: Record<string, string>) => {
      const base = { ...attrs, fill: 'none', 'vector-effect': 'non-scaling-stroke' };
      return [
        svgEl(attrs.r ? 'circle' : attrs.width ? 'rect' : 'line', { ...base, stroke: '#fff', 'stroke-width': '3.5' } as Record<string, string>),
        svgEl(attrs.r ? 'circle' : attrs.width ? 'rect' : 'line', { ...base, stroke: '#000', 'stroke-width': '1.5', ...(attrs.r ? {} : { 'stroke-dasharray': '5 4' }) } as Record<string, string>),
      ];
    };
    g.append(
      ...line({ x: n3(bx), y: n3(by), width: n3(bw), height: n3(bh) }),
      ...line({ x1: n3(cx), y1: n3(by), x2: n3(cx), y2: n3(hy + 9 / k) }),
    );
    const h = svgEl('g', { 'data-handle': '', style: 'cursor: grab', 'pointer-events': 'all' });
    h.append(
      svgEl('circle', { cx: n3(cx), cy: n3(hy), r: n3(HANDLE_HIT / 2 / k), fill: 'transparent' }),
      svgEl('circle', { cx: n3(cx), cy: n3(hy), r: n3(9 / k), fill: '#fff', stroke: '#000', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }),
      svgEl('circle', { cx: n3(cx), cy: n3(hy), r: n3(3 / k), fill: '#000' }),
    );
    g.append(h);
    this.overlay.appendChild(g);
  }

  /** The piece being dragged, rotated or twisted is lifted: bigger, softer shadow and a small shift up-left. */
  private syncLift() {
    const m = this.moving;
    const id = this.rotating?.id ?? this.twist?.id ?? (m && m.moved ? m.id : null);
    if (id === this.liftedId) return;
    const prev = this.liftedId ? this.els.get(this.liftedId)?.g : undefined;
    const next = id ? this.els.get(id)?.g : undefined;
    for (const g of [prev, next]) g?.classList.add('anim');
    prev?.classList.remove('lifted');
    next?.classList.add('lifted');
    this.liftedId = id;
    clearTimeout(this.liftTimer);
    this.liftTimer = window.setTimeout(() => {
      for (const g of this.piecesLayer.querySelectorAll('.anim')) g.classList.remove('anim');
    }, LIFT_MS + 60);
  }

  private renderHistoryUi() {
    if (!this.historyEl) return;
    const q = (n: string) => this.historyEl.querySelector<HTMLButtonElement>(`[data-history=${n}]`)!;
    q('undo').disabled = !this.history.canUndo;
    q('redo').disabled = !this.history.canRedo;
    const empty = this.composition.pieces.length === 0;
    q('clear').disabled = empty;
    if (empty && this.confirming()) this.showConfirm(false);
  }

  private render() {
    const pieces = this.composition.pieces;
    if (this.selectedId && !this.composition.getPiece(this.selectedId)) this.selectedId = null;

    const live = new Set(pieces.map((p) => p.id));
    for (const [id, el] of this.els) {
      if (!live.has(id)) {
        el.g.remove();
        this.els.delete(id);
      }
    }
    // Reconcile in stacking order (first = bottom). Elements are kept stable so pointer capture survives.
    // Each piece is [shadow, shape]: its shadow falls on the pieces below it, never on itself or anything above.
    let expected: ChildNode | null = this.piecesLayer.firstChild;
    for (const p of pieces) {
      const s = SHAPE_BY_ID.get(p.shapeId)!;
      let el = this.els.get(p.id);
      if (!el) {
        const g = svgEl('g', { 'data-piece-id': p.id, 'data-shape': p.shapeId });
        g.innerHTML = `<g class="sh">${shadowLayersMarkup(geometryTemplate(s))}</g><g class="bd"><g data-rot>${geometryHtml(s)}</g></g>`;
        el = { g, rots: [...g.querySelectorAll<SVGGElement>('[data-rot]')] };
        this.els.set(p.id, el);
      }
      if (el.last !== p) {
        // Pieces are immutable snapshots: an unchanged piece keeps its object, so it costs nothing here.
        if (!el.last || el.last.x !== p.x || el.last.y !== p.y) el.g.setAttribute('transform', `translate(${n3(p.x)} ${n3(p.y)})`);
        if (!el.last || el.last.rotation !== p.rotation) {
          const rot = rotationTransform(p, s);
          for (const r of el.rots) r.setAttribute('transform', rot);
        }
        el.last = p;
      }
      if (el.g !== expected) this.piecesLayer.insertBefore(el.g, expected);
      else expected = el.g.nextSibling;
    }
    this.syncLift();

    this.renderOverlay();
    this.renderHistoryUi();
    this.renderShareUi();
    const sel = this.selectedId ? this.composition.getPiece(this.selectedId) : undefined;
    // Action bar.
    this.actions.hidden = !sel;
    if (sel) {
      const i = this.composition.indexOf(sel.id);
      (this.actions.querySelector('[data-action=snap]') as HTMLButtonElement).setAttribute('aria-pressed', String(this.snap));
      (this.actions.querySelector('[data-action=forward]') as HTMLButtonElement).disabled = i === pieces.length - 1;
      (this.actions.querySelector('[data-action=backward]') as HTMLButtonElement).disabled = i === 0;
    }
  }
}

if (!customElements.get('fridge-face')) customElements.define('fridge-face', FridgeFace);

function sameSnapshot(a: readonly Piece[], b: readonly Piece[]): boolean {
  return a === b || (a.length === b.length && a.every((p, i) => {
    const q = b[i];
    return p === q || (p.id === q.id && p.shapeId === q.shapeId && p.x === q.x && p.y === q.y && p.rotation === q.rotation);
  }));
}
