import { SHAPES, type Shape } from './shapes';
import { Composition, type Piece } from './composition';
import { DEFAULT_CAMERA, cFrameZoom, fitTo, panBy, phoneComfortZoom, rotatedBounds, screenToBoard, zoomAt, type Camera } from './camera';
import { History } from './history';
import { deserialize, serialize, serializeToString, type SerializedComposition, type DeserializeResult } from './serialize';
import { buildShareUrl, decode, encode, encodedFromHash } from './share';
import { exportFilename, pngSize, renderCompositionSvg } from './export';
import { centreOn, groupByChar, groupByWord, isWord, splitSuggestions, type AnySuggestion, type Suggestion, type WordSuggestion } from './suggestions';
import { suggestionStore } from './suggestion-store';
import { introPieces, introSchedule, introWanted } from './intro';
import { fromUpright, normalise } from './rotation';
import { fridgeTexture, type FridgeTexture } from './texture';
import { LIFT_MS, shadowCss, shadowLayersMarkup, shadowUnit } from './shadow';
import { FONT_STACK, registerFont } from './font';
import { CONTROL_SECTIONS, controlSections, isPhysicalKey, type ControlRow } from './controls';
import { icon } from './icons';
import { BLOCK_ORDER, blockState } from './block';
import { columnTrayScale, layoutState } from './layout';
import {
  GUIDE_COPY, GUIDE_IDLE, GUIDE_LETTER, GUIDE_NEXT_MS, GUIDE_WORD, activeOutlines, adoptTheirs, anchorWord, answerAsk, askGuide, besideSpot, chooseWord, coverage,
  findWordC, placeWordC, type WordC,
  currentBatch, endGuide, frameBeside, freeRect, guideClearPlan, guideClickIn, guideProgress, guideRunning, guideWanted, moveLetter, nextAction,
  observeGuide, placeCallout, readGuideOff, recordBuilt, rectsOverlap, startGuide, writeGuideOff, type CalloutSide, type GuideState,
  type GuideWorld, type Rect,
} from './guide';
import { outlinesAt, settleRotation, type Outline } from './outline';
import { localitySpan } from './batches';
import {
  announceAdded, announceDeleted, announceHistory, announceLoaded, announceMoved, announceRestacked, announceRotated,
  announceSelected, announceZoom, announceSuggestion, announceWord, announceIntro,
  announceSelectionCount, announceGroupMoved, announceGroupRotated, announceGroupDeleted,
} from './announce';
import {
  boundsOf, boxFromCorners, bringForwardOverlapping, convexIntersect, piecesInBox, placeOutline, rotateAbout, rotateRigid, selectAll, selectionFrame,
  sendBackwardOverlapping, toggleInSelection, translateAll, type Box, type Pt,
} from './selection';

const PAD = 4; // source units of padding around each tray shape's bounding box
const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 6; // px of pointer travel before a tray press becomes a drag
const HANDLE_GAP = 36; // CSS px between the selection box's upright top and the rotate handle's centre
const HANDLE_HIT = 44; // CSS px, touch target diameter
const HANDLE_CLEAR = 8; // CSS px the guide's callout keeps clear around every rotate handle's hit box
const SELECT_PAD = 6; // CSS px between a shape and its selection box
const PAN_THRESHOLD = 4; // px of travel before a press on empty board becomes a pan (touch) or a selection box (mouse)
const LONG_PRESS_MS = 400; // touch: a press held this long (and still) is a long-press
const LONG_PRESS_TOL = 8; // touch: px a finger may drift during a long-press; a piece only starts to drag beyond it
const RING_MS = 450; // the long-press ring's brief showing after a long-press on a piece
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
const hullOf = (id: string): readonly Pt[] | undefined => SHAPE_BY_ID.get(id)?.hull;
const COMPACT_TK = 0.17; // the compact tray scale (CSS --tk under data-compact)
const TRAY_COLUMN_GAP = 8; // CSS px, minimum space between shapes in the landscape tray column
const TRAY_COLUMN_MIN_W = 76; // CSS px, minimum width of the landscape tray column's content (touch targets; the standalone page's credit sits under it)
/** Landscape tray column: the widest shape's width and all five shapes' heights, in source units (with the per-shape padding). */
const TRAY_COLUMN_W = Math.max(...SHAPES.map((s) => s.bbox.w + 2 * PAD));
const TRAY_COLUMN_H = SHAPES.reduce((n, s) => n + s.bbox.h + 2 * PAD, 0);
const STEM_LENGTH = SHAPE_BY_ID.get('positive-stem')!.uprightBox.h;
/** A black oval's upright width, board units: phones' comfortable zoom fits four of them across the board's shorter side. */
const OVAL_WIDTH = SHAPE_BY_ID.get('positive-round')!.uprightBox.w;
/** A shape's size for the guide's click-in tolerance: the longer side of its upright bounds, board units. */
const sizeOf = (id: string): number => {
  const u = SHAPE_BY_ID.get(id)?.uprightBox;
  return u ? Math.max(u.w, u.h) : 0;
};
/** The guide's outlines: blueprint blue, in screen px (counter-scaled with zoom). Solid for positive shapes, dotted for negative ones (same weight). */
const OUTLINE_COLOR = '#378ADD';
const OUTLINE_PX = 2.75;
const OUTLINE_DASH = [6, 5];
/** Keep my pieces: the smallest outline target (a shape's shorter side) should be at least this many CSS px when framed. */
const GUIDE_MIN_TARGET = 28;
/** CSS px of air kept around what the guide frames. */
const GUIDE_FRAME_PAD = 32;
/** Keep my pieces: open board between their work and the outlines, as a fraction of a positive stem's length. */
const GUIDE_BESIDE_MARGIN = 0.5;
/** A piece clicking into its outline settles there over this long, ms (no motion with reduced motion). */
const SETTLE_MS = 170;
/** Phones, the c and the word's batches: CSS px of air kept around what is framed. */
const SECTION_FRAME_PAD = 8;
/** Phones, the word's batches: the thinnest current target (a shape's shorter side) should be at least this many CSS px. */
const SECTION_MIN_TARGET = 24;
/**
 * Phones in landscape (a board only ~340 px tall): a tall batch keeps room above it for its rotate handle down to targets
 * this many CSS px across (a stem framed edge to edge would leave the handle under the docks, nowhere to turn it).
 */
const SECTION_MIN_TARGET_SHORT = 20;
/**
 * A batch that cannot fit the callout and the button block clear of its outlines at those targets (v1.4.2: [10,11,16] of
 * "create", about two letters tall) takes the largest lower target that does, in steps of SECTION_TARGET_STEP, down to
 * SECTION_TARGET_DROP below them (18 CSS px in portrait, 14 in landscape).
 */
const SECTION_TARGET_STEP = 2;
const SECTION_TARGET_DROP = 6;
/** Phones: a framed batch (or the finished word) never zooms past this multiple of the comfortable scale. */
const SECTION_MAX_COMFORT = 4;
/** The view glides to the next batch over this long, ms (instantly with reduced motion). */
const SECTION_GLIDE_MS = 450;
/** The word's batches (v1.4.2): a batch's outlines together fit a square two average letters of the word wide (`localitySpan`; v1.4.0 had a fixed 1.6 positive stems). */
const BATCH_SPAN_LETTERS = 2;
/** Phones, the word's batches: board context kept around a framed batch (where the targets allow), as a fraction of a positive stem's length. */
const BATCH_CONTEXT_STEMS = 0.1;
/** Desktop, the word's batches: CSS px of air a batch keeps from the visible board's edges before the view moves. */
const BATCH_DESKTOP_PAD = 48;
/** Phones, framing: the zoom cap, and the fraction of the zoom that fits the room to use (default 1). */
interface SectionContext { maxZoom: number; /** CSS px kept free above what is framed (room for a rotate handle on the board), and the zoom it may not push below. */ vpad?: number; minZoom?: number; /** Fraction of the zoom that fits the room to use (default 1): spare room for the callout to step aside into. */ slack?: number }
/** Phones, the guide's c: it uses this share of the zoom that just fits the room, so the callout can step aside (a rotate handle pushes it) without covering the c. */
const C_FIT_SLACK = 0.9;
const SETTLE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

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
.board { position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; background: rgb(205 204 201); } /* under the (lighter) board texture */
.board svg.surface { display: block; width: 100%; height: 100%; touch-action: none; outline: none; user-select: none; -webkit-user-select: none; }
.board svg.surface:focus-visible { outline: 3px solid var(--ink); outline-offset: -6px; }
.board svg.surface [data-piece-id] { cursor: grab; }
.board.space svg.surface, .board.space svg.surface [data-piece-id] { cursor: grab; }
.board.panning svg.surface, .board.panning svg.surface [data-piece-id] { cursor: grabbing; }
/* Touch long-press feedback: a ring around the finger (larger than a fingertip, so it shows), drawn in black and white. */
.lp {
  position: absolute; z-index: 4; width: 88px; height: 88px; margin: -44px 0 0 -44px; box-sizing: border-box; border-radius: 50%;
  border: 3px solid var(--ink); box-shadow: 0 0 0 2px var(--paper), inset 0 0 0 2px var(--paper); pointer-events: none;
  animation: ff-lp-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes ff-lp-in { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
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
/* The bottom button block (v1.5.0; src/block.ts): X, Undo, Redo, Back, Forward, always visible, icons on every layout
   (each with a tooltip and a screen-reader label). Desktop: bottom-left in the dock's row. Phones: centred along the
   board's foot, just above the tray. The inline clear-confirm takes its place while it is open. */
.block { flex-wrap: nowrap; box-sizing: border-box; }
.block .main, .block .confirm { display: contents; }
.block [hidden] { display: none; }
.block .msg { padding: 0 8px; white-space: nowrap; }
.block button.b.i { padding: 0; width: 44px; }
.block button.b.i .ic { display: block; }
.block button.b.i .tx { display: none; }

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
.root[data-compact] { --k: 0.17; --tk: ${COMPACT_TK}; }
/* --ff-bottom-reserve: optional extra room under the tray shapes that a host can set (the standalone page puts its credit line there on phones). */
[data-compact] .tray { gap: 10px 14px; padding: 12px calc(10px + var(--sar)) calc(10px + var(--sab) + var(--ff-bottom-reserve, 0px)) calc(10px + var(--sal)); }
[data-compact] .tray .grp { display: contents; }
[data-compact] .tray .shapes { display: contents; }
[data-compact] .tray .bracket { display: none; }
[data-compact] .tray button { position: relative; }
[data-compact] .tray button::after { content: ""; position: absolute; inset: -6px -9px; } /* thin stems get a larger touch target */
[data-compact] button.b.i { padding: 0; width: 44px; }
[data-compact] button.b.i .ic { display: block; }
[data-compact] button.b.i .tx { display: none; }
[data-compact] .panel { gap: 3px; padding: 3px; }
/* Phones: the view group (zoom, fit, menu) sits at the TOP of the board, and the button block at the BOTTOM, just above the
   tray. The dock spans the board (it lets every press through), its rows packed at the top; the block is pinned to its foot.
   The notice and the share fallback field wrap onto a row below the view group (order). */
[data-compact] .dock { left: calc(8px + var(--sal)); right: calc(8px + var(--sar)); top: calc(8px + var(--sat)); bottom: 8px; align-items: flex-start; align-content: flex-start; gap: 6px; }
[data-compact] .dock > .notice, [data-compact] .dock > .linkbox { order: 2; }
[data-compact] .dock > .block { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); max-width: 100%; }
/* The letters sheet covers the bottom of the board: the block hides while it is open (the selection stays). */
.root[data-compact][data-sugg] .dock > .block, .root[data-compact][data-sugg] .dock > .notice { visibility: hidden; } /* (the notice is also spoken by the live region) */
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
/* Short (landscape) screens: two columns, so the menu stays short enough to clear the button block below it. */
.root[data-short] .menu:not([hidden]) { display: grid; grid-template-columns: 1fr 1fr; width: min(520px, calc(100% - 16px)); }
.root[data-short] .menu .sub { grid-column: 1 / -1; order: 5; padding-left: 0; }
/* Bottom sheet: full width, over the dock, no taller than most of the board. */
[data-compact] .sugg { --sheet: 1; left: 0; right: 0; bottom: 0; width: auto; max-height: 64%; border-width: 2px 0 0; box-shadow: none; }
/* Short: a thinner tray band. */
[data-short] .tray { padding-top: 8px; padding-bottom: calc(6px + var(--sab) + var(--ff-bottom-reserve, 0px)); }
/* Landscape compact (short AND wider than tall: phones in landscape; data-landscape, see src/layout.ts): the tray docks
   VERTICALLY along the LEFT edge, the five shapes stacked top to bottom in tray order, and the board takes the rest, to its
   right. Every control lives inside the board, so nothing can overlap the tray. The tray takes the left (notch-side) inset
   and the top/bottom insets; the board's controls keep only the right and bottom ones. --tk is set from JS so all five
   shapes fit the height (syncTrayScale); each shape's button spans the column's full width, a comfortable touch target. */
.root[data-landscape] { flex-direction: row; }
[data-landscape] .tray {
  order: -1; flex-direction: column; flex-wrap: nowrap; align-items: center; justify-content: space-evenly; gap: ${TRAY_COLUMN_GAP}px;
  padding: calc(8px + var(--sat)) 10px calc(8px + var(--sab) + var(--ff-bottom-reserve, 0px)) calc(10px + var(--sal));
  box-shadow: inset -2px 0 0 rgb(0 0 0 / 0.12);
}
[data-landscape] .tray button { width: max(calc(var(--tray-col) * var(--tk) * 1px), ${TRAY_COLUMN_MIN_W}px); }
[data-landscape] .tray button::after { inset: -${TRAY_COLUMN_GAP / 2}px -10px; }
[data-landscape] .dock { left: 8px; bottom: calc(8px + var(--sab)); }
[data-landscape] .sugg { padding-bottom: var(--sab); }
.root[data-landscape] .menu:not([hidden]) { width: min(520px, calc(100% - 16px - var(--sar))); }

/* ---- controls dialog ---- */
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
.helpbody h3 { margin: 22px 0 4px; padding-bottom: 6px; border-bottom: 2px solid var(--ink); font: 700 14px/1.2 var(--font); letter-spacing: 0.12em; text-transform: uppercase; }
.helpbody section:first-of-type h3 { margin-top: 12px; }
.helpbody h3:focus { outline: none; }
.helpbody h4 { margin: 16px 0 6px; font: 700 12px/1.2 var(--font); letter-spacing: 0.12em; text-transform: uppercase; }
.helpbody [hidden] { display: none !important; }
.helpbody .ctlfoot { margin-top: 20px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.helpbody ul { margin: 0; padding: 0; list-style: none; columns: 2 340px; column-gap: 28px; }
.helpbody li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 5px 0; break-inside: avoid; border-bottom: 1px solid #d0d0d0; font: 500 13px/1.3 var(--font); letter-spacing: 0.08em; text-transform: uppercase; }
.helpbody li > span:first-child { flex: 1 1 0; min-width: 0; }
.helpbody .keys { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 4px; flex: 0 1 auto; max-width: 62%; }
.helpbody kbd { font: 700 12px/1 var(--font); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 6px; border: 1.5px solid var(--ink); background: #f2f2f2; min-width: 12px; text-align: center; box-sizing: content-box; }
.helpbody .combo { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.helpbody .or { font-size: 11px; align-self: center; color: #4a4a4a; }

/* ---- the guide: one small callout on the real UI, flat black and white, Jost caps (see src/guide.ts) ---- */
.guide {
  position: absolute; z-index: 7; left: 0; top: 0; box-sizing: border-box; width: max-content; max-width: min(340px, calc(100% - 32px));
  padding: 12px 12px 12px 14px; background: var(--paper); color: var(--ink); border: 2px solid var(--ink);
  box-shadow: 4px 6px 0 rgb(0 0 0 / 0.25); pointer-events: auto; touch-action: manipulation;
}
.guide[hidden], .guide [hidden] { display: none !important; }
.gtext { margin: 0; font: 700 14px/1.35 var(--font); letter-spacing: 0.08em; text-transform: uppercase; }
.gtext .gt2, .gtext .gt3 { display: block; margin-top: 4px; }
.gtext .gt2.gprog { font-weight: 500; letter-spacing: 0.12em; }
.grow { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
.grow.gctl button.b { font-size: 11px; padding: 0 10px; }
.guide button.b.pri { background: var(--ink); color: var(--paper); }
.guide button.b.pri:hover { background: #333; }
/* The pointer: a flat black triangle (white edge, so it reads on black pieces too) just outside the callout, tip toward the target. */
.gpt { position: absolute; width: 22px; height: 13px; pointer-events: none; line-height: 0; }
.gpt svg { display: block; animation: ff-guide-nudge 1.2s ease-in-out infinite; }
@keyframes ff-guide-nudge { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
.guide[data-side=above] .gpt { left: calc(var(--ga) - 13px); top: calc(100% + 6px); }
.guide[data-side=below] .gpt { left: calc(var(--ga) - 13px); top: -19px; transform: rotate(180deg); }
.guide[data-side=right] .gpt { left: -23.5px; top: calc(var(--ga) - 8.5px); transform: rotate(90deg); }
.guide[data-side=left] .gpt { left: calc(100% + 1.5px); top: calc(var(--ga) - 8.5px); transform: rotate(-90deg); }
.guide[data-side=centre] .gpt { display: none; }
.guide[data-noarrow] .gpt { visibility: hidden; }
/* The row of small controls: hit areas (::after) carry the 44px touch target, not visual bulk. */
.grow.gctl button.b { position: relative; }
.grow.gctl button.b::after { content: ""; position: absolute; inset: -4px -2px; }
/* Phones (compact): a smaller callout, so it covers as little of the board as it can. Width is set from JS (45% of the board in landscape). */
[data-compact] .guide { padding: 8px 10px 8px 10px; box-shadow: 3px 4px 0 rgb(0 0 0 / 0.25); }
[data-compact] .gtext { font-size: 12px; line-height: 1.3; letter-spacing: 0.06em; }
[data-compact] .grow { margin-top: 6px; gap: 4px; }
[data-compact] .grow.gctl { flex-wrap: nowrap; gap: 12px; margin-top: 4px; }
[data-compact] .grow.gctl button.b { min-width: 0; min-height: 28px; padding: 0 6px; font-size: 10px; letter-spacing: 0.08em; border-width: 1.5px; white-space: nowrap; }
[data-compact] .grow.gctl button.b::after { inset: -8px -6px; }
/* The narrowest callout (v1.5.0, a last resort on phones in portrait): the small controls tighten to fit its width. */
[data-compact] .guide[data-narrow] .grow.gctl { gap: 8px; }
[data-compact] .guide[data-narrow] .grow.gctl button.b { padding: 0 5px; font-size: 9.5px; letter-spacing: 0.02em; }
[data-compact] .gpick button.b { position: relative; min-height: 34px; font-size: 11px; padding: 0 10px; }
[data-compact] .gpick button.b::after { content: ""; position: absolute; inset: -5px -2px; }

/* ---- motion: none at all when the visitor asks for less ---- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;

/** A real key press has been seen in this page session (shared by every element on the page). */
let keyboardSeen = false;

function controlsHtml(): string {
  const combo = (c: readonly string[]) => `<span class="combo">${c.map((k) => `<kbd>${k}</kbd>`).join('<span class="or" aria-hidden="true">+</span>')}</span>`;
  const list = (rows: readonly ControlRow[]) =>
    `<ul>` + rows.map((it) => `<li${it.when ? ` class="${it.when}"` : ''}><span>${it.text}</span><span class="keys">${it.keys.map(combo).join('<span class="or">or</span>')}</span></li>`).join('') + `</ul>`;
  const sections = CONTROL_SECTIONS.map(
    (sec) =>
      `<section class="ctl" data-controls="${sec.id}" aria-labelledby="ff-ctl-${sec.id}"><h3 id="ff-ctl-${sec.id}" tabindex="-1">${sec.title}</h3>` +
      sec.groups.map((g) => (g.title ? `<h4>${g.title}</h4>` : '') + list(g.rows)).join('') +
      `</section>`,
  ).join('');
  return sections + `<div class="ctlfoot"><span class="ctlall">${btn('data-help="showall"', 'Show all controls')}</span><span class="ctlguide">${btn('data-help="guide"', GUIDE_COPY.replay)}</span></div>`;
}

/** The bottom block's buttons (src/block.ts): icon, tooltip and label (kept in step with the state by `renderBlock`). */
const BLOCK_BUTTONS: Record<string, { icon: string; label: string; keys: string }> = {
  x: { icon: 'clear', label: 'Clear board', keys: 'Delete' },
  undo: { icon: 'undo', label: 'Undo', keys: 'Control+Z' },
  redo: { icon: 'redo', label: 'Redo', keys: 'Control+Shift+Z' },
  backward: { icon: 'backward', label: 'Send backward', keys: '[' },
  forward: { icon: 'forward', label: 'Bring forward', keys: ']' },
};

function blockBtn(id: string): string {
  const b = BLOCK_BUTTONS[id];
  return btn(`data-block="${id}" aria-label="${b.label}" title="${b.label}" aria-keyshortcuts="${b.keys}" disabled`, b.label, b.icon);
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
  private outlinesEl!: SVGGElement;
  /** The bottom button block (X, Undo, Redo, Back, Forward; src/block.ts). */
  private blockEl!: HTMLElement;
  private boardEl!: HTMLElement;
  private trayEl!: HTMLElement;
  private rootEl!: HTMLElement;
  private liveEl!: HTMLElement;
  private helpEl!: HTMLElement;
  private insetProbe!: HTMLElement;
  private helpOpener: HTMLElement | SVGElement | null = null;
  private helpShowAll = false;
  private coarseMq: MediaQueryList | null = null;
  private fineMq: MediaQueryList | null = null;
  private readonly onControlsEnvChange = () => this.syncControls();
  private readonly onPhysicalKey = (e: KeyboardEvent) => {
    if (keyboardSeen || !isPhysicalKey(e)) return;
    keyboardSeen = true;
    this.syncControls();
  };
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
  private liftedIds = new Set<string>();
  private liftTimer = 0;
  private viewReady = false;
  private pxZoom = NaN;
  private kCache = 0;
  private vpCache: { width: number; height: number } | null = null;
  /** The selection: ids of the pieces chosen to act on together (temporary: never saved, never in history). */
  private selection: string[] = [];
  /** The selection box's frame angle: it turns with a selection rotated as one unit; back to 0 whenever the selection changes. */
  private groupAngle = 0;
  private outlines = new WeakMap<Piece, Pt[]>();
  private stackCache: { pieces: readonly Piece[]; key: string; fwd: boolean; back: boolean } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  /** A selection turning as one unit (handle drag): `starts` are the pieces when it began, turned about the fixed `centre`. */
  private rotating: { pointerId: number; ids: string[]; starts: Piece[]; centre: Pt; grab: number; startAngle: number } | null = null;
  private twist: { ids: string[]; starts: Piece[]; centre: Pt; lastAngle: number; accum: number; startMid: Pt; startAngle: number } | null = null;
  /**
   * A press on a piece. `ids` move together (the selection, or the pressed piece alone). Touch presses are `pending` until the
   * finger travels LONG_PRESS_TOL (then they drag) or holds LONG_PRESS_MS (then they toggle the piece in the selection).
   * `onTap`: what a release without a drag does.
   */
  private moving: {
    pointerId: number; anchor: string; ids: string[]; starts: Piece[]; startPt: Pt; startClient: Pt; moved: boolean; pending: boolean;
    onTap: 'none' | 'select' | 'remove';
  } | null = null;
  /** A selection box (mouse: a drag on the empty board; touch: a long-press on it, then a drag). */
  private boxSel: { pointerId: number; startClient: Pt; startBoard: Pt; active: boolean; additive: boolean; base: string[]; touch: boolean; box?: Box } | null = null;
  private longPress: { pointerId: number; x: number; y: number; timer: number } | null = null;
  private ringEl: HTMLElement | null = null;
  private ringTimer = 0;
  private lastPointerType = '';
  private trayDrag: { pointerId: number; shape: Shape; startX: number; startY: number; active: boolean; preview?: HTMLElement } | null = null;
  private suppressClick = false;

  // History and persistence.
  private history = new History<readonly Piece[]>([], { equals: sameSnapshot });
  private applying = false; // true while undo/redo/load rewrite the composition
  private restoring = false; // true while the saved composition is read back on load
  private coalesceKey: string | null = null;
  private saveTimer = 0;
  private pendingFit = false;
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
  private readonly onWindowResize = () => {
    this.syncInsets();
    this.scheduleGuide();
  };
  private readonly onIntroInput = () => this.finishIntro();

  // The onboarding guide (src/guide.ts): one callout at a time, attached to the real UI.
  /** Test hook: how long a step waits before it offers Next, ms. */
  static guideNextMs = GUIDE_NEXT_MS;
  static readonly observedAttributes = ['no-guide'];
  private guideEl!: HTMLElement;
  private guide: GuideState = GUIDE_IDLE;
  private guideNext = false; // the Next button is offered
  private guideNextTimer = 0;
  private guideFrame = 0;
  private guideLoading = false; // a load is replacing the board: judged once, after it
  private guideFocusOnShow = false; // a replay from Controls moves focus into the callout once it shows
  private guideQueued = false; // the guide waits for the board to be laid out (its outlines are centred in it)
  /**
   * The word phase: frame the current batch once the callout can be measured (phones: close up, clear of the callout;
   * desktop: only if it is not already in view, never closer than the comfortable zoom), or the finished word at step 7,
   * gliding there unless 'instant'. false: nothing pending.
   */
  private wordFitPending: false | 'instant' | 'smooth' = false;
  /** Phones, steps 1 to 4: the c is framed once the callout can be measured (see `fitC`). */
  private cFitPending = false;
  private viewGlide = 0; // the view gliding to a batch (requestAnimationFrame id), 0 when still
  private gliding = false; // the glide itself is moving the view (any other view change cancels it)
  private outlineZoom = NaN;
  private keySnapTimer = 0; // `,` `.` turns click in when the keys pause
  private authoring = false;

  connectedCallback() {
    window.addEventListener('keyup', this.onWindowKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('hashchange', this.onHashChange);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('orientationchange', this.onWindowResize);
    window.addEventListener('keydown', this.onPhysicalKey, { capture: true, passive: true });
    if (typeof matchMedia === 'function') {
      this.coarseMq = matchMedia('(any-pointer: coarse)');
      this.fineMq = matchMedia('(any-pointer: fine)');
      this.coarseMq.addEventListener?.('change', this.onControlsEnvChange);
      this.fineMq.addEventListener?.('change', this.onControlsEnvChange);
    }
    this.syncControls();
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
          <g data-camera aria-hidden="true" transform="matrix(1 0 0 1 0 0)"><rect data-texture fill="url(#ff-tex)" x="0" y="0" width="0" height="0"/><g data-pieces></g><g data-outlines pointer-events="none"></g><g data-overlay></g></g>
        </svg>
        <div class="dock">
          <div class="notice" aria-hidden="true"><span class="msg" hidden></span></div>
          <div class="linkbox panel" role="group" aria-label="Share link" hidden>
            <input type="text" readonly aria-label="Share link (copy it from here)" />
            ${btn('data-share="close" aria-label="Close share link"', 'Close', 'close')}
          </div>
          <div class="block panel" role="group" aria-label="Edit">
            <span class="main">${BLOCK_ORDER.map((id) => blockBtn(id)).join('')}</span>
            <span class="confirm" role="alertdialog" aria-label="Confirm clearing the board" hidden>
              <span class="msg">Clear everything?</span>
              ${btn('data-block="clear-yes" aria-label="Confirm clear board"', 'Clear')}
              ${btn('data-block="clear-no" aria-label="Cancel clear board"', 'Cancel')}
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
            ${btn('data-view="help" aria-label="Controls" aria-haspopup="dialog" aria-keyshortcuts="?"', '?', 'help')}
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
          ${menuItem('help', 'Controls', 'help', 'aria-haspopup="dialog" aria-keyshortcuts="?"')}
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
      </div>
      <div class="guide" role="group" aria-label="Guide" data-step="0" hidden>
        <span class="gpt" aria-hidden="true"><svg viewBox="0 0 22 13" width="22" height="13" focusable="false"><path d="M1.5 1 L11 12 L20.5 1 Z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></span>
        <p class="gtext"><span class="gt1"></span><span class="gt2" hidden></span><span class="gt3" hidden></span></p>
        <div class="grow gpick" data-pick="0" hidden>
          <button type="button" class="b" data-guide="clean"><span class="tx">${GUIDE_COPY.clearStart}</span></button>
          <button type="button" class="b pri" data-guide="mine"><span class="tx">${GUIDE_COPY.keepMine}</span></button>
        </div>
        <div class="grow gpick" data-pick="5" hidden>
          <button type="button" class="b pri" data-guide="word"><span class="tx">${GUIDE_COPY.guideMe}</span></button>
          <button type="button" class="b" data-guide="clear"><span class="tx">${GUIDE_COPY.clearFree}</span></button>
        </div>
        <div class="grow gpick" data-pick="7" hidden>
          <button type="button" class="b" data-guide="fresh"><span class="tx">${GUIDE_COPY.startFresh}</span></button>
          <button type="button" class="b pri" data-guide="keep"><span class="tx">${GUIDE_COPY.keepIt}</span></button>
        </div>
        <div class="grow gctl">
          <button type="button" class="b" data-guide="skip"><span class="tx">${GUIDE_COPY.skip}</span></button>
          <button type="button" class="b" data-guide="off"><span class="tx">${GUIDE_COPY.dontShow}</span></button>
          <button type="button" class="b pri" data-guide="next" hidden><span class="tx">${GUIDE_COPY.next}</span></button>
        </div>
      </div>`;
    wrap.insertAdjacentHTML('afterbegin', '<div class="probe" aria-hidden="true"></div>');
    const outer = document.createElement('div'); // siblings of .root: never made inert, so the live region keeps working
    outer.innerHTML = `
      <div class="sr" id="ff-desc">Press 1 to 5 to add a piece. N and P choose a piece; Control or Command A selects every piece. Arrow keys move the selection, comma and period rotate it, the bracket keys restack it, Delete removes it. Press question mark for the controls.</div>
      <div class="sr" id="ff-live" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="help" hidden>
        <div class="helpbox" role="dialog" aria-modal="true" aria-labelledby="ff-help-title">
          <div class="helphead"><h2 id="ff-help-title">Controls</h2>${btn('data-help="close" aria-label="Close controls"', 'Close', 'close')}</div>
          <div class="helpbody" tabindex="0" role="region" aria-label="Controls list">${controlsHtml()}</div>
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
    this.outlinesEl = wrap.querySelector('[data-outlines]')!;
    this.blockEl = wrap.querySelector('.block')!;
    this.shareEl = wrap.querySelector('.share')!;
    this.noticeEl = wrap.querySelector('.notice .msg')!;
    this.linkboxEl = wrap.querySelector('.linkbox')!;
    this.suggEl = wrap.querySelector('.sugg')!;
    this.suggBtn = wrap.querySelector('[data-view=suggest]')!;
    this.dockEl = wrap.querySelector('.dock')!;
    this.menuEl = wrap.querySelector('.menu')!;
    this.menuBtn = wrap.querySelector('[data-view=menu]')!;
    this.guideEl = wrap.querySelector('.guide')!;
    wrap.style.setProperty('--tray-col', String(TRAY_COLUMN_W));
    this.trayEl.style.setProperty('--tex', `url("${tex.trayHref}")`); // the tray keeps its own (darker, unchanged) tone

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
    // A touch long-press must never open a context menu (Android) or a callout (iOS: -webkit-touch-callout on the host).
    this.surface.addEventListener('contextmenu', (e) => {
      if (this.lastPointerType === 'touch' || this.longPress || this.boxSel) e.preventDefault();
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
      else if (t.closest('[data-help=showall]')) this.showAllControls();
      else if (t.closest('[data-help=guide]')) {
        this.closeHelp();
        this.replayGuide();
      }
    });
    this.guideEl.addEventListener('click', (e) => this.onGuideClick(e));
    // The callout follows whatever opens, closes or appears around it (menus, sheets, the dialog, notices, the button block).
    new MutationObserver((ms) => {
      if (ms.some((m) => !this.guideEl.contains(m.target))) this.scheduleGuide();
    }).observe(root, { subtree: true, attributes: true, attributeFilter: ['hidden', 'data-sugg'] });

    this.blockEl.addEventListener('click', (e) => this.onBlockClick(e));
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
        // The word: frame the current batch again in the new board.
        if (this.guide.phase === 'word') this.wordFitPending = 'instant';
        if (this.guide.phase === 'c' && this.isCompact && this.guide.step >= 1 && this.guide.step <= 4) this.cFitPending = true;
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
      if (this.guideQueued && this.boardEl.clientWidth && !this.introAnims.length) this.autoStartGuide(); // ...or when the guide wanted to start
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
    this.authoring = authoring;
    this.syncGuideButton();
    this.maybeIntro(hadSaved, authoring);
    if (!this.introAnims.length && !this.introQueued) this.autoStartGuide(); // no intro playing: the guide starts now
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
            this.selection = [];
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
    window.removeEventListener('keydown', this.onPhysicalKey, { capture: true });
    this.coarseMq?.removeEventListener?.('change', this.onControlsEnvChange);
    this.fineMq?.removeEventListener?.('change', this.onControlsEnvChange);
    this.coarseMq = this.fineMq = null;
    this.unsubSuggestions?.();
    this.unsubSuggestions = null;
    this.closeMenu(false);
    this.finishIntro();
    this.flushSave();
    clearTimeout(this.guideNextTimer);
    clearTimeout(this.keySnapTimer);
    this.stopGlide();
  }

  attributeChangedCallback(name: string) {
    if (name !== 'no-guide' || !this.shadowRoot) return;
    this.syncGuideButton();
    if (this.hasAttribute('no-guide')) this.setGuide(endGuide());
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
    this.selection = [];
    this.coalesceKey = null;
    this.applying = !undoable;
    this.restoring = !undoable;
    this.guideLoading = true;
    try {
      this.composition.replace(pieces);
    } finally {
      this.applying = false;
      this.restoring = false;
      this.guideLoading = false;
    }
    if (!undoable) this.history.reset(this.composition.pieces);
    else this.say(announceLoaded(this.composition.pieces.length));
    this.render();
    if (this.boardEl.clientWidth) this.fitToComposition();
    else this.pendingFit = true;
    this.guideAfterLoad();
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
    if (!this.applying && !this.inGesture && !this.guideLoading) this.guideObserve(); // a drag or turn is judged once, when it ends
    if (!this.restoring) this.scheduleSave(); // restoring what is already saved needs no write-back
    this.scheduleShareUrl();
    this.render();
  }

  private get inGesture(): boolean {
    return !!(this.moving || this.rotating || this.twist);
  }

  /** A drag / handle drag / twist is one step: record once, when the gesture ends. Returns whether it changed anything. */
  private commitGesture(): boolean {
    if (this.inGesture) return false;
    const changed = this.history.record(this.composition.pieces);
    if (changed) this.render();
    return changed;
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
    this.groupAngle = 0; // the selection box starts square again
    try {
      this.composition.restore(snap); // render() drops selected pieces that no longer exist
    } finally {
      this.applying = false;
    }
    this.guideObserve(); // the guide follows the board: an undone click-in shows its outline again
    this.guideRelocate(); // their pieces back under an untouched c (undoing Clear and start): its outlines move beside them
  }

  private clearBoard() {
    this.composition.clear();
  }

  /** The inline clear-confirm in the block (X with nothing selected): it takes the buttons' place while it is open. */
  private showConfirm(on: boolean) {
    this.blockEl.querySelector<HTMLElement>('.main')!.hidden = on;
    this.blockEl.querySelector<HTMLElement>('.confirm')!.hidden = !on;
    if (on) this.say('Clear everything? Choose Clear to confirm or Cancel. Escape cancels.');
    const target = this.blockEl.querySelector<HTMLButtonElement>(`[data-block=${on ? 'clear-no' : 'x'}]`)!;
    if (target.disabled) this.surface.focus();
    else target.focus();
  }

  private confirming(): boolean {
    return !this.blockEl.querySelector<HTMLElement>('.confirm')!.hidden;
  }

  /**
   * The block: X deletes the selection (one undo step) or, with nothing selected, asks to clear the board (Clear clears it
   * as one undo step, Cancel does nothing); Undo, Redo; Back and Forward restack the selection (overlap-aware).
   */
  private onBlockClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button');
    const act = b?.dataset.block;
    if (!b || !act || b.disabled) return;
    if (act === 'undo') this.undo();
    else if (act === 'redo') this.redo();
    else if (act === 'x') {
      if (this.selection.length) this.runAction('delete');
      else if (this.composition.pieces.length) this.showConfirm(true);
    } else if (act === 'backward' || act === 'forward') {
      if (this.selection.length) this.runAction(act);
    } else if (act === 'clear-no') this.showConfirm(false);
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

  /** Anchor the menu to its button (the view group is at the top on phones): right edges aligned, opening DOWNWARD, always inside the board and clear of the button block. */
  private positionMenu() {
    const m = this.menuEl;
    const board = this.boardEl.getBoundingClientRect(); // the menu is positioned inside the board (right of the tray in landscape)
    const b = this.menuBtn.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const px = (v: string) => parseFloat(v) || 0;
    const cs = getComputedStyle(this.rootEl);
    let bottom = board.bottom - edge;
    if (getComputedStyle(this.blockEl).display !== 'none' && getComputedStyle(this.blockEl).visibility !== 'hidden') bottom = Math.min(bottom, this.blockEl.getBoundingClientRect().top - gap); // never over the button block
    m.style.maxHeight = '';
    m.style.top = '0px';
    m.style.left = '0px';
    const mw = m.offsetWidth;
    const mh = m.scrollHeight;
    const top = b.bottom + gap;
    const h = Math.min(mh, Math.max(0, bottom - top));
    m.style.maxHeight = `${h}px`;
    const minLeft = edge + (this.isLandscape ? 0 : px(cs.getPropertyValue('--sal'))); // in landscape the tray takes the left inset
    const maxLeft = board.width - mw - edge - px(cs.getPropertyValue('--sar'));
    m.style.left = `${Math.round(Math.max(minLeft, Math.min(b.right - board.left - mw, maxLeft)))}px`;
    m.style.top = `${Math.round(top - board.top)}px`;
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
    this.pxZoom = NaN; // k may have changed: refresh the shadows' scale
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

  /**
   * Compact layout: the view group sits over the top of the board, so the part of the board that is actually visible starts
   * below it. Returns that offset in screen (viewBox) units; 0 on desktop, where the docks are at the bottom and the board is whole.
   */
  private topInset(): number {
    if (!this.isCompact) return 0;
    const board = this.boardEl.getBoundingClientRect();
    let bottom = 0;
    for (const p of this.dockEl.querySelectorAll<HTMLElement>(':scope > .view')) bottom = Math.max(bottom, p.getBoundingClientRect().bottom);
    return bottom > board.top ? (bottom - board.top + 8) / this.k : 0;
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
    if (this.viewGlide && !this.gliding) this.stopGlide(); // the visitor (or a resize) moved the view: the glide gives way
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
   * change only, the shadows' scale `--px` (board-space, clamped: shadow.ts) and the selection overlay are updated too.
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
      this.cameraEl.style.setProperty('--px', `${shadowUnit(this.k * zoom)}px`);
    }
    if (zoom !== this.overlayZoom) this.renderOverlay();
    if (zoom !== this.outlineZoom) this.renderOutlines(); // the outlines' dots stay the same size on screen
    for (const fn of this.viewListeners) fn();
    this.scheduleGuide(); // pan and zoom move what the callout points at
  }

  /**
   * The comfortable zoom: the default view, the reference Frame all caps against. Desktop: a positive stem is COMFORT_STEM of
   * the board's shorter side. Phones (compact): four black ovals fit across the VISIBLE board's shorter side (v1.2.5).
   */
  comfortZoom(): number {
    if (!this.isCompact) return this.legacyComfortZoom();
    const v = this.visibleView();
    return phoneComfortZoom({ width: v.w, height: v.h }, OVAL_WIDTH);
  }

  /**
   * The comfortable zoom before v1.2.5 (a positive stem is COMFORT_STEM of the board's shorter side, whole board). Kept for
   * ONE use: Keep my pieces' framing caps (`frameBeside`), so that tested framing is exactly as it was on phones; desktop's
   * comfortable zoom is this same value.
   */
  private legacyComfortZoom(): number {
    const vp = this.viewport();
    const side = Math.min(vp.width, vp.height);
    return side > 0 ? (COMFORT_STEM * side) / STEM_LENGTH : DEFAULT_CAMERA.zoom;
  }

  /** The default view: comfortable scale, board origin at the top-left. */
  private defaultView(): Camera {
    return { x: 0, y: 0, zoom: this.comfortZoom() };
  }

  /**
   * Phones: the view that frames the guide's c (oval and wedge, `outlines`' tight bounds) centred in the visible board, the
   * black oval's width 45% of its shorter side (`cFrameZoom`). Other layouts keep the view's own zoom, centring only.
   */
  private cView(outlines: readonly Outline[]): Camera | null {
    const b = this.tightBounds(outlines);
    if (!b) return null;
    const v = this.visibleView();
    if (this.isCompact) this.cFitPending = true; // refined once the callout is placed (fitC)
    const z = this.isCompact ? cFrameZoom({ width: v.w, height: v.h }, OVAL_WIDTH, b, GUIDE_FRAME_PAD / this.k) : this.view.zoom;
    return { x: v.x + v.w / 2 - (b.x + b.w / 2) * z, y: v.y + v.h / 2 - (b.y + b.h / 2) * z, zoom: z };
  }

  /** A view with the board origin (x = 0, the baseline y = 0) comfortably in sight, left of centre and below the middle. */
  private originView(): Camera {
    const vp = this.viewport();
    const t = Math.min(this.topInset(), vp.height / 2);
    return { x: vp.width * 0.3, y: t + (vp.height - t) * 0.62, zoom: this.comfortZoom() };
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

  /** One piece: its name and angle from upright. Several: a count and the turn the selection has made as a unit. */
  private rotatedText(ids: readonly string[]): string | null {
    if (ids.length === 1) return this.rotationText(ids[0]);
    const n = ids.filter((id) => this.composition.getPiece(id)).length;
    return n ? announceGroupRotated(n, normalise(this.groupAngle)) : null;
  }

  private movedText(ids: readonly string[]): string | null {
    if (ids.length === 1) {
      const p = this.composition.getPiece(ids[0]);
      return p ? announceMoved(this.nameOf(p)) : null;
    }
    const n = ids.filter((id) => this.composition.getPiece(id)).length;
    return n ? announceGroupMoved(n) : null;
  }

  // ---- layout state ------------------------------------------------------------------

  /**
   * data-compact (narrow OR short) and data-short (short) on the shadow root's top elements, from the host's own size.
   * Replaces @container queries, under which a real iPhone showed the desktop layout (cause unconfirmed).
   */
  private syncLayout() {
    if (!this.rootEl) return;
    const { compact, short, landscape } = layoutState(this.clientWidth, this.clientHeight); // the host's own (untransformed) box
    for (const el of [this.rootEl, this.helpEl]) {
      el.toggleAttribute('data-compact', compact);
      el.toggleAttribute('data-short', short);
      el.toggleAttribute('data-landscape', landscape);
    }
    this.syncTrayScale();
    if (this.menuEl) {
      if (!compact) this.closeMenu(false);
      else if (this.menuOpen) this.positionMenu();
    }
    this.syncGuideLayout();
    this.scheduleGuide();
  }

  private get isLandscape(): boolean {
    return !!this.rootEl && this.rootEl.hasAttribute('data-landscape');
  }

  /** Landscape compact: the tray scale that fits all five shapes, stacked, into the element's height (inside the tray's padding). */
  private syncTrayScale() {
    if (!this.rootEl || !this.trayEl) return;
    if (!this.isLandscape) {
      this.rootEl.style.removeProperty('--tk');
      return;
    }
    const cs = getComputedStyle(this.trayEl);
    const avail = this.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    const tk = columnTrayScale(avail, TRAY_COLUMN_H, (SHAPES.length - 1) * TRAY_COLUMN_GAP, COMPACT_TK);
    this.rootEl.style.setProperty('--tk', String(Math.floor(tk * 10000) / 10000));
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
    this.syncTrayScale(); // the insets pad the landscape tray column
  }

  // ---- controls dialog -------------------------------------------------------

  private get helpOpen(): boolean {
    return !!this.helpEl && !this.helpEl.hidden;
  }

  private openHelp(opener?: HTMLElement | null) {
    if (this.helpOpen) return;
    this.helpOpener = opener?.closest?.('button') ?? (this.shadowRoot!.activeElement as HTMLElement | null) ?? this.surface;
    this.showExportMenu(false);
    this.helpShowAll = false;
    this.syncControls();
    this.helpEl.hidden = false;
    this.rootEl.inert = true; // contains focus and hides the rest from assistive tech while the dialog is open
    this.helpEl.querySelector<HTMLElement>('[data-help=close]')!.focus();
  }

  private closeHelp() {
    if (!this.helpOpen) return;
    this.helpEl.hidden = true;
    this.helpShowAll = false;
    this.syncControls();
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
      const items = [...this.helpEl.querySelectorAll<HTMLElement>('button, [tabindex="0"]')].filter((el) => !el.closest('[hidden]'));
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

  /** Which input methods the device has (the Controls panel's rule, also used by the guide's turning hint). */
  private inputSections() {
    const has = typeof matchMedia === 'function';
    return controlSections({
      hasMatchMedia: has,
      anyCoarse: has && matchMedia('(any-pointer: coarse)').matches,
      anyFine: has && matchMedia('(any-pointer: fine)').matches,
      maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
      keyboardSeen,
    });
  }

  /** Show the sections this device has (see `controlSections`), plus all of them after "Show all controls". */
  private syncControls() {
    if (!this.helpEl) return;
    const sec = this.inputSections();
    const shown: Record<string, boolean> = { touch: sec.touch, pointer: sec.pointer, keyboard: sec.keyboard };
    for (const el of this.helpEl.querySelectorAll<HTMLElement>('[data-controls]')) el.hidden = !(this.helpShowAll || shown[el.dataset.controls!]);
    if (guideRunning(this.guide)) this.renderGuideContent(); // the turning hint's touch line follows the device
    const all = this.helpEl.querySelector<HTMLElement>('.ctlall')!;
    const hide = this.helpShowAll || sec.allShown;
    const hadFocus = this.shadowRoot!.activeElement && all.contains(this.shadowRoot!.activeElement);
    all.hidden = hide;
    if (hide && hadFocus) this.helpEl.querySelector<HTMLElement>('[data-help=close]')!.focus();
  }

  private showAllControls() {
    this.helpShowAll = true;
    const before = new Set([...this.helpEl.querySelectorAll<HTMLElement>('[data-controls]')].filter((e) => e.hidden));
    this.syncControls();
    const first = [...before][0]?.querySelector<HTMLElement>('h3');
    (first ?? this.helpEl.querySelector<HTMLElement>('[data-help=close]'))!.focus();
    this.say('All controls shown.');
  }

  /** Frame every piece (rotated bounds) with a margin; with no pieces, reset to the default view. */
  fitToComposition() {
    const b = rotatedBounds(this.composition.pieces, (id) => SHAPE_BY_ID.get(id));
    if (!b) {
      this.setView(this.defaultView());
      return;
    }
    // Fit into the visible board (below the top docks on phones), not the whole board.
    const vp = this.viewport();
    const t = Math.min(this.topInset(), vp.height / 2);
    const c = fitTo(b, { width: vp.width, height: vp.height - t }, FIT_MARGIN / this.k, FIT_MAX_COMFORT * this.comfortZoom());
    this.setView({ ...c, y: c.y + t });
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

  private addAt(shape: Shape, x: number, y: number): Piece {
    const p = this.composition.addPiece(shape.id, x, y);
    this.select(p.id);
    this.say(announceAdded(shape.name, this.composition.pieces.length));
    return p;
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
      prev.style.setProperty('--px', `${shadowUnit(this.k * this.view.zoom)}px`); // as the piece will land
      this.shadowRoot!.appendChild(prev);
      d.preview = prev;
      this.scheduleGuide();
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
    this.scheduleGuide();
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 100);
    if (commit && this.overBoard(e.clientX, e.clientY)) {
      const p = this.toBoard(e.clientX, e.clientY);
      const added = this.addAt(d.shape, p.x, p.y);
      this.guideSnap([added.id]); // dropped from the tray close to its outline: it clicks in (guide only)
    }
  }

  private onTrayClick(e: MouseEvent) {
    // detail === 0 means keyboard-initiated (Enter/Space); drags must not also add.
    if (this.suppressClick && e.detail !== 0) return;
    const shape = this.shapeOf(e.target);
    if (shape) this.addNearCentre(shape);
  }

  // ---- selecting and moving ----------------------------------------------

  /** Replace the selection (ids that no longer exist are dropped). The box starts square again whenever its members change. */
  private setSelection(ids: readonly string[]) {
    const live = ids.filter((id, i) => ids.indexOf(id) === i && !!this.composition.getPiece(id));
    const same = live.length === this.selection.length && live.every((id) => this.selection.includes(id));
    if (!same) this.groupAngle = 0;
    this.selection = live;
    this.render();
  }

  private select(id: string | null) {
    this.setSelection(id ? [id] : []);
  }

  private isSelected(id: string): boolean {
    return this.selection.includes(id);
  }

  /** The selected pieces, in stacking order. */
  private selectedPieces(): Piece[] {
    const s = new Set(this.selection);
    return this.composition.pieces.filter((p) => s.has(p.id));
  }

  private get selKey(): string {
    return [...this.selection].sort().join(',');
  }

  /** A piece's convex outline on the board (cached per immutable piece snapshot). */
  private outlineOf(p: Piece): Pt[] {
    let o = this.outlines.get(p);
    if (!o) {
      o = placeOutline(SHAPE_BY_ID.get(p.shapeId)?.hull ?? [], p);
      this.outlines.set(p, o);
    }
    return o;
  }

  /** Real-geometry overlap between two pieces of the current composition, by id. */
  private overlapFn(): (a: string, b: string) => boolean {
    const by = new Map(this.composition.pieces.map((p) => [p.id, p]));
    return (a, b) => {
      const pa = by.get(a), pb = by.get(b);
      return !!pa && !!pb && convexIntersect(this.outlineOf(pa), this.outlineOf(pb));
    };
  }

  private selFrame(pieces: readonly Piece[]) {
    return selectionFrame(pieces, hullOf, this.groupAngle);
  }

  /** What a selection turns about: one piece about its own centroid (as always); several about the centre of their box. */
  private pivot(pieces: readonly Piece[]): Pt {
    if (pieces.length === 1) return { x: pieces[0].x, y: pieces[0].y };
    return this.selFrame(pieces)?.centre ?? { x: 0, y: 0 };
  }

  /** Whether bring forward / send backward would move anything (overlap-aware), cached per composition and selection. */
  private stackState(): { fwd: boolean; back: boolean } {
    const pieces = this.composition.pieces;
    const key = this.selKey;
    const c = this.stackCache;
    if (c && c.key === key && (c.pieces === pieces || this.inGesture)) return c; // during a drag it is recomputed at the end
    const order = pieces.map((p) => p.id);
    const set = new Set(this.selection);
    const ov = this.overlapFn();
    const next = { pieces, key, fwd: !!bringForwardOverlapping(order, set, ov), back: !!sendBackwardOverlapping(order, set, ov) };
    this.stackCache = next;
    return next;
  }

  private selectAllPieces() {
    const all = selectAll(this.composition.pieces);
    if (!all.length) {
      this.say('No pieces on the board.');
      return;
    }
    this.setSelection(all);
    this.say(announceSelectionCount(all.length));
  }

  /** N / P: select ONE piece, stepping through the stacking order (bottom to top, wrapping). */
  private cycleSelection(dir: 1 | -1) {
    const pieces = this.composition.pieces;
    if (!pieces.length) {
      this.say('No pieces on the board.');
      return;
    }
    const idx = this.selection.map((id) => this.composition.indexOf(id)).filter((i) => i >= 0);
    const cur = idx.length ? (dir === 1 ? Math.max(...idx) : Math.min(...idx)) : -1;
    const i = cur < 0 ? (dir === 1 ? 0 : pieces.length - 1) : (cur + dir + pieces.length) % pieces.length;
    const p = pieces[i];
    this.select(p.id);
    this.revealPiece(p);
    this.say(announceSelected(this.nameOf(p), i, pieces.length, fromUpright(this.offsetOf(p), p.rotation)));
  }

  // ---- touch long-press ---------------------------------------------------

  private startLongPress(e: PointerEvent, fire: () => void) {
    this.cancelLongPress();
    const lp = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer: 0 };
    lp.timer = window.setTimeout(() => {
      if (this.longPress !== lp) return;
      this.longPress = null;
      fire();
    }, LONG_PRESS_MS);
    this.longPress = lp;
  }

  private cancelLongPress() {
    if (!this.longPress) return;
    clearTimeout(this.longPress.timer);
    this.longPress = null;
  }

  /** The long-press ring at a client point: held while a box is armed, or shown briefly. */
  private showRing(clientX: number, clientY: number, hold: boolean) {
    this.hideRing();
    const r = document.createElement('div');
    r.className = 'lp';
    r.setAttribute('aria-hidden', 'true');
    const b = this.boardEl.getBoundingClientRect();
    r.style.left = `${clientX - b.left}px`;
    r.style.top = `${clientY - b.top}px`;
    this.boardEl.append(r);
    this.ringEl = r;
    if (!hold) this.ringTimer = window.setTimeout(() => this.hideRing(), RING_MS);
  }

  private hideRing() {
    clearTimeout(this.ringTimer);
    this.ringEl?.remove();
    this.ringEl = null;
  }

  /** A long-press on the empty board: the pan stops (and is undone), and the next drag draws a selection box from there. */
  private armBox(pointerId: number) {
    const pa = this.pan;
    if (!pa || pa.pointerId !== pointerId || this.touches.size > 1) return;
    if (pa.active) this.setView(pa.startView);
    this.pan = null;
    this.boardEl.classList.remove('panning');
    this.boxSel = {
      pointerId, startClient: { x: pa.startX, y: pa.startY }, startBoard: screenToBoard(pa.startView, this.clientToScreen(pa.startX, pa.startY)),
      active: false, additive: false, base: [...this.selection], touch: true,
    };
    this.showRing(pa.startX, pa.startY, true);
  }

  /** A long-press on a piece (held still): add it to the selection, or remove it. The press then does nothing more. */
  private longPressPiece(id: string) {
    const m = this.moving;
    if (!m || m.anchor !== id || !m.pending) return;
    this.moving = null;
    const next = toggleInSelection(this.selection, id);
    this.setSelection(next);
    this.say(announceSelectionCount(this.selection.length));
    this.showRing(m.startClient.x, m.startClient.y, false);
  }

  private cancelBox() {
    const b = this.boxSel;
    if (!b) return;
    this.boxSel = null;
    this.hideRing();
    this.setSelection(b.base);
  }

  // ---- pointer gestures on the board ------------------------------------------

  private onBoardDown(e: PointerEvent) {
    this.lastPointerType = e.pointerType;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const touch = e.pointerType === 'touch';
    if (touch) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        this.cancelLongPress();
        if (this.touches.size === 2 && !this.twist && !this.pinch) {
          if (this.boxSel) this.cancelBox();
          const m = this.moving;
          // Twist turns the selection only if the first finger landed on a piece (or the handle); otherwise two fingers pinch/pan.
          if (m || this.rotating) {
            if (m && !this.isSelected(m.anchor)) this.select(m.anchor);
            this.startTwist(e);
          } else this.startPinch();
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
    const sel = this.selectedPieces();
    if (handle && sel.length) {
      const centre = this.pivot(sel);
      const pt = this.toBoard(e.clientX, e.clientY);
      this.rotating = { pointerId: e.pointerId, ids: sel.map((p) => p.id), starts: sel, centre, grab: this.angleAt(centre, pt), startAngle: this.groupAngle };
      this.surface.setPointerCapture(e.pointerId);
      this.syncLift();
      e.preventDefault();
      return;
    }
    const id = (e.target as Element).closest?.('[data-piece-id]')?.getAttribute('data-piece-id') ?? null;
    if (!id) {
      if (touch) {
        // One finger pans (a tap deselects, on release); held still, it arms a selection box instead.
        this.startPan(e, false);
        this.startLongPress(e, () => this.armBox(e.pointerId));
      } else {
        // Mouse and pen: a drag draws a selection box (Shift adds to the selection); a plain click deselects, on release.
        this.boxSel = {
          pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startBoard: this.toBoard(e.clientX, e.clientY),
          active: false, additive: e.shiftKey, base: [...this.selection], touch: false,
        };
        this.surface.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (!this.composition.getPiece(id)) return;
    let onTap: 'none' | 'select' | 'remove' = 'none';
    let pending = false;
    if (touch) {
      // Nothing changes until the finger drags (then it drags, as always) or holds (then it toggles the piece). A tap selects it alone.
      pending = true;
      onTap = 'select';
      this.startLongPress(e, () => this.longPressPiece(id));
    } else if (e.shiftKey) {
      if (this.isSelected(id)) onTap = 'remove';
      else {
        this.setSelection([...this.selection, id]);
        this.say(announceSelectionCount(this.selection.length));
      }
    } else if (this.isSelected(id) && this.selection.length > 1) {
      onTap = 'select'; // a click without a drag collapses the selection to this piece, on release
    } else {
      this.select(id); // selecting never changes stacking order
    }
    const ids = this.isSelected(id) ? [...this.selection] : [id];
    const starts = ids.map((i) => this.composition.getPiece(i)!).filter(Boolean);
    this.moving = {
      pointerId: e.pointerId, anchor: id, ids, starts, startPt: this.toBoard(e.clientX, e.clientY), startClient: { x: e.clientX, y: e.clientY },
      moved: false, pending, onTap,
    };
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

  private angleAt(c: Pt, pt: Pt): number {
    return (Math.atan2(pt.y - c.y, pt.x - c.x) * 180) / Math.PI;
  }

  private offsetOf(p: Piece): number {
    return SHAPE_BY_ID.get(p.shapeId)!.uprightOffsetDeg;
  }

  private startTwist(e: PointerEvent) {
    const sel = this.selectedPieces();
    const [a, b] = [...this.touches.values()];
    if (!sel.length || !a || !b) return;
    this.moving = null;
    this.rotating = null;
    this.surface.setPointerCapture(e.pointerId);
    this.twist = {
      ids: sel.map((p) => p.id),
      starts: sel,
      centre: this.pivot(sel), // held fixed for the whole gesture
      lastAngle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      accum: 0,
      startMid: this.toBoard((a.x + b.x) / 2, (a.y + b.y) / 2),
      startAngle: this.groupAngle,
    };
    this.syncLift();
  }

  private onBoardMove(e: PointerEvent) {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const lp = this.longPress;
    if (lp && lp.pointerId === e.pointerId && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_TOL) this.cancelLongPress();
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
    const bs = this.boxSel;
    if (bs && bs.pointerId === e.pointerId) {
      if (!bs.active) {
        if (Math.hypot(e.clientX - bs.startClient.x, e.clientY - bs.startClient.y) < PAN_THRESHOLD) return;
        bs.active = true;
        this.hideRing();
      }
      bs.box = boxFromCorners(bs.startBoard, this.toBoard(e.clientX, e.clientY));
      const hits = piecesInBox(this.composition.pieces, hullOf, bs.box);
      this.setSelection(bs.additive ? [...bs.base, ...hits.filter((h) => !bs.base.includes(h))] : hits);
      return;
    }
    const t = this.twist;
    if (t) {
      const [a, b] = [...this.touches.values()];
      if (!a || !b) return;
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      t.accum += normalise(ang - t.lastAngle);
      t.lastAngle = ang;
      const mid = this.toBoard((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.groupAngle = t.startAngle + t.accum;
      // Free rotation (a magnet turns freely by hand), as one rigid unit about the fixed centre, then carried with the fingers.
      this.composition.setPlacements(translateAll(rotateRigid(t.starts, t.centre, t.accum), mid.x - t.startMid.x, mid.y - t.startMid.y));
      return;
    }
    const r = this.rotating;
    if (r && r.pointerId === e.pointerId) {
      const delta = this.angleAt(r.centre, this.toBoard(e.clientX, e.clientY)) - r.grab;
      this.groupAngle = r.startAngle + delta;
      this.composition.setPlacements(rotateRigid(r.starts, r.centre, delta));
      return;
    }
    const m = this.moving;
    if (!m || m.pointerId !== e.pointerId) return;
    if (m.pending) {
      if (Math.hypot(e.clientX - m.startClient.x, e.clientY - m.startClient.y) <= LONG_PRESS_TOL) return;
      m.pending = false; // it is a drag, exactly as before: the piece (or the selection it belongs to) follows the finger
      this.cancelLongPress();
      if (!this.isSelected(m.anchor)) this.select(m.anchor);
    }
    const pt = this.toBoard(e.clientX, e.clientY);
    if (!m.moved && pt.x === m.startPt.x && pt.y === m.startPt.y) return;
    m.moved = true;
    const dx = pt.x - m.startPt.x, dy = pt.y - m.startPt.y;
    this.composition.setPlacements(m.starts.map((p) => ({ id: p.id, x: p.x + dx, y: p.y + dy })));
    this.syncLift();
  }

  private onBoardUp(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    if (this.longPress && this.longPress.pointerId === e.pointerId) this.cancelLongPress();
    if (this.pinch && this.touches.size < 2) this.pinch = null; // the remaining finger does nothing
    if (this.pan && this.pan.pointerId === e.pointerId) {
      if (!this.pan.active && e.type === 'pointerup') this.select(null);
      this.pan = null;
      this.boardEl.classList.remove('panning');
    }
    const bs = this.boxSel;
    if (bs && bs.pointerId === e.pointerId) {
      this.boxSel = null;
      this.hideRing();
      if (bs.active) {
        this.render(); // the box itself goes
        this.say(announceSelectionCount(this.selection.length));
      } else if (!bs.touch && !bs.additive && e.type === 'pointerup') {
        this.select(null); // a plain click on the empty board deselects
      }
      // A touch box that was armed but never dragged is cancelled quietly: the selection stays as it was.
    }
    const wasGesture = this.inGesture;
    // One summary per gesture, never per pixel.
    let said: (() => string | null) | null = null;
    let released: string[] = []; // the pieces a drag, turn or twist just let go of (the guide may click them in)
    if (this.twist && this.touches.size < 2) {
      const ids = this.twist.ids;
      this.twist = null; // ends cleanly; the remaining finger does nothing
      said = () => this.rotatedText(ids);
      released = ids;
    }
    const m = this.moving;
    if (m && m.pointerId === e.pointerId) {
      this.moving = null;
      if (m.moved) {
        said = () => this.movedText(m.ids);
        released = m.ids;
      }
      else if (e.type === 'pointerup') {
        if (m.onTap === 'remove') {
          this.setSelection(this.selection.filter((id) => id !== m.anchor));
          this.say(announceSelectionCount(this.selection.length));
        } else if (m.onTap === 'select') this.select(m.anchor);
      }
    }
    if (this.rotating && this.rotating.pointerId === e.pointerId) {
      const ids = this.rotating.ids;
      this.rotating = null;
      said = () => this.rotatedText(ids);
      released = ids;
    }
    this.syncLift();
    const changed = this.commitGesture();
    if (wasGesture && !this.inGesture) {
      this.render(); // the button block's restack state is refreshed once, at the end
      if (changed) this.guideSnap(released); // guide only: close to its outline, it clicks in, in the same undo step
      this.guideObserve(); // a whole drag, turn or twist is judged once, at the end
    }
    const t = said?.();
    if (t) this.say(t);
  }

  // ---- keyboard and actions -----------------------------------------------

  /** Delete, bring forward or send backward the whole selection: each is ONE change (one undo step). */
  private runAction(act: string) {
    const sel = this.selectedPieces();
    if (!sel.length) return;
    if (act === 'delete') {
      const n = this.composition.deletePieces(sel.map((p) => p.id));
      if (n) this.say(n === 1 ? announceDeleted(this.composition.pieces.length) : announceGroupDeleted(n));
    } else if (act === 'forward' || act === 'backward') {
      const order = this.composition.pieces.map((p) => p.id);
      const set = new Set(sel.map((p) => p.id));
      const ov = this.overlapFn();
      const next = act === 'forward' ? bringForwardOverlapping(order, set, ov) : sendBackwardOverlapping(order, set, ov);
      const moved = !!next && this.composition.reorder(next);
      this.say(announceRestacked(act, moved, this.composition.indexOf(sel[0].id), this.composition.pieces.length, sel.length));
    }
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
      if (k === 'a' && !e.shiftKey) { this.selectAllPieces(); e.preventDefault(); return; }
    }
    // Escape closes the innermost thing first: export menu, clear confirm, share field, letters, then the guide, then the selection.
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
      } else if (guideRunning(this.guide)) {
        this.skipGuide(); // menus, sheets and dialogs first, then the guide, then the selection
        e.preventDefault();
      } else if (this.selection.length) {
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
    // Arrow keys: move the selection, or pan the board (Alt always pans). Shift = bigger steps.
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as string] as [number, number] | undefined;
    const sel = this.selectedPieces();
    const ids = sel.map((p) => p.id);
    const key = this.selKey;
    if (arrow && !e.metaKey && !e.ctrlKey) {
      if (e.altKey || !sel.length) {
        this.panKey(arrow[0], arrow[1], e.shiftKey);
        e.preventDefault();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      this.coalesced(`nudge:${key}`, () => this.composition.setPlacements(sel.map((p) => ({ id: p.id, x: p.x + arrow[0] * step, y: p.y + arrow[1] * step }))));
      this.sayLater(`move:${key}`, () => this.movedText(ids));
      e.preventDefault();
      return;
    }
    if (['PageUp', 'PageDown', 'Home', 'End'].includes(e.key) && plain && origin === (this.surface as unknown)) {
      e.preventDefault(); // the focused board never scrolls the page behind it
      return;
    }
    if (!sel.length || e.metaKey || e.ctrlKey || e.altKey) return;
    // , and . rotate 1 degree (free rotation, no steps; Shift + them does nothing). Several pieces turn as one unit.
    const rot = e.shiftKey ? 0 : e.code === 'Period' || e.key === '.' ? 1 : e.code === 'Comma' || e.key === ',' ? -1 : 0;
    if (rot) {
      const centre = this.pivot(sel);
      this.coalesced(`rot1:${key}`, () => {
        this.groupAngle += rot;
        this.composition.setPlacements(rotateRigid(sel, centre, rot));
      });
      this.sayLater(`rot:${key}`, () => this.rotatedText(ids));
      // Guide only: when the keys pause, a piece turned close to its outline's angle clicks in (same undo step as the turn).
      const after = this.composition.pieces;
      clearTimeout(this.keySnapTimer);
      this.keySnapTimer = window.setTimeout(() => {
        if (this.composition.pieces === after && this.history.present === after && !this.inGesture) this.guideSnap(ids);
      }, ANNOUNCE_SETTLE_MS);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Delete':
      case 'Backspace': this.runAction('delete'); break;
      case ']': this.runAction('forward'); break;
      case '[': this.runAction('backward'); break;
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
    if (guideRunning(this.guide)) this.renderGuideContent(); // the Letters mention follows the store
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
    this.rootEl.setAttribute('data-sugg', '');
    if (this.isCompact && !this.linkboxEl.hidden) this.hideLinkBox(); // the sheet covers the share fallback field's row on phones
    this.suggBtn.setAttribute('aria-expanded', 'true');
    this.renderSuggestions();
    this.suggEl.querySelector<HTMLElement>('.sgchars button[aria-pressed=true], .sgwords button')?.focus();
  }

  private closeSuggestions() {
    if (!this.suggOpen) return;
    const hadFocus = this.suggEl.contains(this.shadowRoot!.activeElement);
    this.suggEl.hidden = true;
    this.rootEl.removeAttribute('data-sugg');
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
    const t = Math.min(this.topInset(), r.height / this.k / 2) * this.k; // phones: the docks cover the top; centre in the visible part
    const c = this.toBoard(r.left + r.width / 2, r.top + t + (r.height - t) / 2);
    const items = centreOn(s.pieces, (id) => SHAPE_BY_ID.get(id), c).map((p) => ({ ...p, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
    this.selection = [];
    const added = this.composition.addPieces(items);
    const total = this.composition.pieces.length;
    this.say(isWord(s) ? announceWord(s.text, s.variant, added.length, total) : announceSuggestion(s.char, s.variant, added.length, total));
    // On a phone the sheet would hide what was just placed: close it and hand focus back.
    if (getComputedStyle(this.suggEl).getPropertyValue('--sheet').trim() === '1') this.closeSuggestions();
  }

  // ---- the "play" intro ----------------------------------------------------------------

  /** Opt-in (`intro` attribute), first visit only: no saved composition, no share link, `no-intro` unset, and the word play exists (as a word composition, or as the letters p, l, a, y). */
  private maybeIntro(hadSaved: boolean, authoring: boolean) {
    const want = introWanted({
      enabled: this.hasAttribute('intro'), // set aside in v1.2.0: off unless the host opts in
      hasSavedComposition: hadSaved, hasShareLink: encodedFromHash(location.hash) !== null, disabled: this.hasAttribute('no-intro'), skip: authoring,
    });
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
    const left = this.toBoard(board.left, 0).x;
    this.introAnims = [];
    pieces.forEach((p, i) => {
      const g = this.els.get(p.id)?.g;
      const s = SHAPE_BY_ID.get(p.shapeId);
      if (!g || !s || typeof g.animate !== 'function') return;
      const tray = this.trayEl.querySelector(`[data-shape="${p.shapeId}"]`)?.getBoundingClientRect();
      const from = tray && tray.width ? this.toBoard(tray.left + tray.width / 2, tray.top + tray.height / 2) : this.toBoard(board.left + board.width / 2, board.bottom + 80);
      const half = Math.hypot(s.bbox.w, s.bbox.h) / 2 + 6;
      // Start fully outside the board, on the tray's side: below it, or (landscape, tray on the left) left of it.
      const x0 = this.isLandscape ? Math.min(from.x, left - half) : from.x;
      const y0 = this.isLandscape ? from.y : Math.max(from.y, bottom + half);
      this.introAnims.push(
        g.animate(
          [{ transform: `translate(${n3(x0)}px, ${n3(y0)}px)` }, { transform: `translate(${n3(p.x)}px, ${n3(p.y)}px)` }],
          { duration: sched.duration, delay: sched.delays[i], easing: INTRO_EASE, fill: 'backwards' },
        ),
      );
    });
    if (!this.introAnims.length) {
      this.autoStartGuide();
      return;
    }
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
    this.autoStartGuide(); // the guide follows the intro
  }

  // ---- rendering ----------------------------------------------------------

  /**
   * The selection overlay, drawn in board space but sized in screen pixels (counter-scaled by zoom). One piece: its box and
   * rotate handle, turned with it. Several: a thin outline per piece, ONE box around them all (turned with the selection when
   * it is rotated as a unit) and ONE rotate handle. Plus the selection box being dragged out, if any.
   */
  private renderOverlay() {
    this.overlayZoom = this.view.zoom;
    this.overlay.replaceChildren();
    const k = this.k * this.view.zoom; // CSS px per board unit: pad, gap and handle stay screen-sized at every zoom
    const sel = this.selectedPieces();
    // Two-tone strokes (white under black dashes) read on black pieces, white pieces and the grey board.
    const line = (attrs: Record<string, string>) => {
      const base = { ...attrs, fill: 'none', 'vector-effect': 'non-scaling-stroke' };
      const tag = attrs.r ? 'circle' : attrs.width ? 'rect' : 'line';
      return [
        svgEl(tag, { ...base, stroke: '#fff', 'stroke-width': '3.5' } as Record<string, string>),
        svgEl(tag, { ...base, stroke: '#000', 'stroke-width': '1.5', ...(attrs.r ? {} : { 'stroke-dasharray': '5 4' }) } as Record<string, string>),
      ];
    };
    /**
     * A box (in a frame given by `toBoardPt`) with the rotate handle above its top centre, or below its bottom centre when the
     * top spot is off the board or under a control (the button block, a dock) and the bottom one is clear.
     */
    const blocked = this.handleBlocker();
    const boxWithHandle = (g: SVGGElement, bx: number, by: number, bw: number, bh: number, toBoardPt: (p: Pt) => Pt) => {
      const cx = bx + bw / 2;
      let hy = by - HANDLE_GAP / k;
      let edge = by, toward = 9 / k;
      if (blocked(toBoardPt({ x: cx, y: hy }))) {
        const below = by + bh + HANDLE_GAP / k;
        if (!blocked(toBoardPt({ x: cx, y: below }))) {
          hy = below;
          edge = by + bh;
          toward = -9 / k;
        }
      }
      g.append(
        ...line({ x: n3(bx), y: n3(by), width: n3(bw), height: n3(bh) }),
        ...line({ x1: n3(cx), y1: n3(edge), x2: n3(cx), y2: n3(hy + toward) }),
      );
      const h = svgEl('g', { 'data-handle': '', style: 'cursor: grab', 'pointer-events': 'all' });
      h.append(
        svgEl('circle', { cx: n3(cx), cy: n3(hy), r: n3(HANDLE_HIT / 2 / k), fill: 'transparent' }),
        svgEl('circle', { cx: n3(cx), cy: n3(hy), r: n3(9 / k), fill: '#fff', stroke: '#000', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }),
        svgEl('circle', { cx: n3(cx), cy: n3(hy), r: n3(3 / k), fill: '#000' }),
      );
      g.append(h);
    };
    const pad = SELECT_PAD / k;
    if (sel.length === 1) {
      const p = sel[0];
      const s = SHAPE_BY_ID.get(p.shapeId)!;
      const ub = s.uprightBox; // the shape's bounds in its upright frame, centroid at the origin
      const g = svgEl('g', {
        'data-selection-box': '',
        transform: `translate(${n3(p.x)} ${n3(p.y)}) rotate(${n3(fromUpright(s.uprightOffsetDeg, p.rotation))})`,
        'pointer-events': 'none',
      });
      const ang = fromUpright(s.uprightOffsetDeg, p.rotation);
      boxWithHandle(g, ub.x - pad, ub.y - pad, ub.w + 2 * pad, ub.h + 2 * pad, (q) => {
        const r = rotateAbout(q, { x: 0, y: 0 }, ang);
        return { x: r.x + p.x, y: r.y + p.y };
      });
      this.overlay.appendChild(g);
    } else if (sel.length > 1) {
      for (const p of sel) {
        const s = SHAPE_BY_ID.get(p.shapeId)!;
        const g = svgEl('g', { 'data-sel-outline': p.id, transform: `translate(${n3(p.x)} ${n3(p.y)}) ${rotationTransform(p, s)}`, 'pointer-events': 'none' });
        const stroke = (c: string, w: string) => geometryTemplate(s).replace('{a}', `fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round" vector-effect="non-scaling-stroke"`);
        g.innerHTML = stroke('#fff', '3') + stroke('#000', '1');
        this.overlay.appendChild(g);
      }
      const f = this.selFrame(sel);
      if (f) {
        const g = svgEl('g', { 'data-selection-box': '', 'data-group': '', transform: `rotate(${n3(this.groupAngle)})`, 'pointer-events': 'none' });
        boxWithHandle(g, f.box.x - pad, f.box.y - pad, f.box.w + 2 * pad, f.box.h + 2 * pad, (q) => rotateAbout(q, { x: 0, y: 0 }, this.groupAngle));
        this.overlay.appendChild(g);
      }
    }
    const bs = this.boxSel;
    if (bs?.active && bs.box) {
      const b = bs.box;
      const g = svgEl('g', { 'data-marquee': '', 'pointer-events': 'none' });
      g.append(svgEl('rect', { x: n3(b.x), y: n3(b.y), width: n3(b.w), height: n3(b.h), fill: 'rgb(0 0 0 / 0.06)' }));
      g.append(...line({ x: n3(b.x), y: n3(b.y), width: n3(b.w), height: n3(b.h) }));
      this.overlay.appendChild(g);
    }
  }

  /** Is a board point a bad spot for the rotate handle: off the visible board, or under a control (the block, a dock, menu, sheet)? */
  private handleBlocker(): (p: Pt) => boolean {
    const board = this.boardEl.getBoundingClientRect();
    if (!board.width) return () => false;
    const r = HANDLE_HIT / 2;
    const rects: DOMRect[] = [];
    const shown = (e: HTMLElement | null) => !!e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    for (const e of [...this.dockEl.querySelectorAll<HTMLElement>(':scope > .panel'), this.menuEl, this.suggEl]) if (shown(e)) rects.push(e.getBoundingClientRect());
    const k = this.k, v = this.view;
    return (p) => {
      const x = board.left + (p.x * v.zoom + v.x) * k, y = board.top + (p.y * v.zoom + v.y) * k;
      if (x - r < board.left || x + r > board.right || y - r < board.top || y + r > board.bottom) return true;
      return rects.some((q) => x + r > q.left && x - r < q.right && y + r > q.top && y - r < q.bottom);
    };
  }

  /** The pieces being dragged, rotated or twisted are lifted: bigger, softer shadow and a small shift up-left. */
  private syncLift() {
    const m = this.moving;
    const next = new Set(this.rotating?.ids ?? this.twist?.ids ?? (m && m.moved ? m.ids : []));
    if (next.size === this.liftedIds.size && [...next].every((id) => this.liftedIds.has(id))) return;
    for (const id of new Set([...this.liftedIds, ...next])) this.els.get(id)?.g.classList.add('anim');
    for (const id of this.liftedIds) if (!next.has(id)) this.els.get(id)?.g.classList.remove('lifted');
    for (const id of next) this.els.get(id)?.g.classList.add('lifted');
    this.liftedIds = next;
    this.scheduleGuide(); // the callout steps aside while a piece is in the hand
    clearTimeout(this.liftTimer);
    this.liftTimer = window.setTimeout(() => {
      for (const g of this.piecesLayer.querySelectorAll('.anim')) g.classList.remove('anim');
    }, LIFT_MS + 60);
  }

  /** The block's buttons: labels, tooltips and on/off from the selection, the board and the history (src/block.ts). */
  private renderBlock() {
    if (!this.blockEl) return;
    const n = this.selection.length;
    const st = n ? this.stackState() : { fwd: false, back: false };
    const pieces = this.composition.pieces.length;
    const state = blockState({ selected: n, pieces, canUndo: this.history.canUndo, canRedo: this.history.canRedo, fwd: st.fwd, back: st.back });
    for (const id of BLOCK_ORDER) {
      const b = this.blockEl.querySelector<HTMLButtonElement>(`[data-block=${id}]`)!;
      const { label, disabled } = state.buttons[id];
      if (b.disabled !== disabled) b.disabled = disabled;
      if (b.getAttribute('aria-label') !== label) {
        b.setAttribute('aria-label', label);
        b.title = label;
        b.querySelector('.tx')!.textContent = label;
      }
      if (id === 'x' && b.dataset.mode !== state.x) b.dataset.mode = state.x; // 'delete' or 'clear'
    }
    if (!pieces && this.confirming()) this.showConfirm(false);
  }

  private render() {
    const pieces = this.composition.pieces;
    const live = new Set(pieces.map((p) => p.id));
    if (this.selection.some((id) => !live.has(id))) {
      this.selection = this.selection.filter((id) => live.has(id)); // deleted (or undone) pieces leave the selection
      this.groupAngle = 0;
    }
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
    // The block acts on the whole selection (X deletes it, Back / Forward are off when nothing below / above overlaps it),
    // or, with nothing selected, X clears the board.
    this.renderBlock();
    this.renderShareUi();
    this.scheduleGuide();
  }

  // ---- the guide ----------------------------------------------------------------------------

  private guideWorld(): GuideWorld {
    // Real geometry: the pieces' convex outlines (cached per piece snapshot), as the block's restacking uses.
    return { pieces: this.composition.pieces, sizeOf, overlaps: (a, b) => convexIntersect(this.outlineOf(a as Piece), this.outlineOf(b as Piece)) };
  }

  private guideConditions() {
    return { disabled: this.hasAttribute('no-guide'), authoring: this.authoring, off: readGuideOff(() => localStorage) };
  }

  /** The guide builds Edward's c (`lower-c-1`): without it there is nothing to guide. */
  private guideLetter() {
    return suggestionStore.get(GUIDE_LETTER.char, GUIDE_LETTER.variant);
  }

  /** Step 5 offers the word (`word-create-1`) only when it exists. */
  private guideWordSuggestion() {
    return suggestionStore.get(GUIDE_WORD.text, GUIDE_WORD.variant);
  }

  /** "Show guide" in the Controls panel exists only where the guide can run. */
  private syncGuideButton() {
    const el = this.helpEl?.querySelector<HTMLElement>('.ctlguide');
    if (el) el.hidden = !guideWanted({ ...this.guideConditions(), off: false }, true) || !this.guideLetter();
  }

  /** The middle of the visible board, in board units (phones: below the docks that cover its top). */
  private visibleCentre(): Pt {
    const r = this.boardEl.getBoundingClientRect();
    const t = Math.min(this.topInset(), r.height / this.k / 2) * this.k;
    return this.toBoard(r.left + r.width / 2, r.top + t + (r.height - t) / 2);
  }

  /**
   * The c the guide builds (v1.2.3): the one INSIDE `word-create-1` (`findWordC`), so it stays in place as the start of
   * "create" at Guide me. Null without the word (or without a c in it): the guide then builds `lower-c-1` as before.
   */
  private guideWordC(): { pieces: readonly Outline[]; c: WordC } | null {
    const w = this.guideWordSuggestion();
    if (!w) return null;
    const c = findWordC(w.pieces, (id) => SHAPE_BY_ID.get(id));
    return c ? { pieces: w.pieces, c } : null;
  }

  /**
   * The c's outlines on a blank board. From the word: placed so the WHOLE word, aligned to the c, is centred in the visible
   * board (the c at its left), then the view pans to centre the c (steps 1 to 4 frame the c, as before; Guide me reframes
   * to the word). Without the word: `lower-c-1` centred in the visible board.
   */
  private letterOutlines(): Outline[] {
    const shape = (id: string) => SHAPE_BY_ID.get(id);
    const wc = this.guideWordC();
    if (wc) {
      const { c } = placeWordC(wc.pieces, wc.c, shape, this.visibleCentre());
      const view = this.cView(c);
      if (view) this.setView(view);
      return c;
    }
    const l = this.guideLetter();
    const out = l ? outlinesAt(l.pieces, shape, this.visibleCentre()) : [];
    if (this.isCompact) {
      const view = this.cView(out); // phones: the c's close-up (no word: its outlines are already centred)
      if (view) this.setView(view);
    }
    return out;
  }

  /**
   * Keep my pieces (and an untouched c relocated beside their pieces): the c's outlines in EMPTY board beside their work.
   * From the word: the spot is chosen for the WHOLE word's bounds (`besideSpot`), so the word's outlines will never overlap
   * their pieces, and the c is the word's c there; the view frames their work and the c. Otherwise `lower-c-1` as before.
   */
  private cBeside(): Outline[] {
    const wc = this.guideWordC();
    if (!wc) return this.outlinesBeside(this.guideLetter()!.pieces);
    const shape = (id: string) => SHAPE_BY_ID.get(id);
    const work = rotatedBounds(this.composition.pieces, shape);
    const { c } = placeWordC(wc.pieces, wc.c, shape, work ? this.besideCentre(wc.pieces, work) : this.visibleCentre());
    if (work) {
      const f = frameBeside(work, rotatedBounds(c, shape)!, this.visibleView(), GUIDE_FRAME_PAD / this.k, this.targetZoom(c), FIT_MAX_COMFORT * this.legacyComfortZoom());
      this.setView({ x: f.x, y: f.y, zoom: f.zoom });
    }
    return c;
  }

  /** Every visit, after the intro if one plays (or at once), unless no-guide, author mode or "Don't show again". */
  private autoStartGuide() {
    if (!this.isConnected || !this.guideEl || guideRunning(this.guide) || !guideWanted(this.guideConditions())) return;
    if (!this.boardEl.clientWidth) {
      this.guideQueued = true; // the outlines are centred in the board: wait for it to be laid out
      return;
    }
    this.guideQueued = false;
    this.setGuide(this.firstGuideState());
  }

  /** "Show guide": from the start (step 0 when the board has pieces, else step 1), even when "Don't show again" is set (which stays set). */
  private replayGuide() {
    if (!guideWanted(this.guideConditions(), true) || !this.guideLetter()) return;
    this.finishIntro();
    this.setGuide(GUIDE_IDLE);
    this.guideFocusOnShow = true;
    this.setGuide(this.firstGuideState());
  }

  /** Step 0 when the board already has pieces (and there is a c to build); otherwise step 1 on the blank board. */
  private firstGuideState(): GuideState {
    if (this.composition.pieces.length && this.guideLetter()) return askGuide();
    return startGuide(this.letterOutlines(), this.guideWorld());
  }

  /** The zoom at which the smallest outline target is GUIDE_MIN_TARGET CSS px across (its shape's shorter upright side). */
  private targetZoom(outlines: readonly Outline[]): number {
    const min = Math.min(...outlines.map((o) => {
      const u = SHAPE_BY_ID.get(o.shapeId)?.uprightBox;
      return u ? Math.min(u.w, u.h) : Infinity;
    }));
    return Number.isFinite(min) && min > 0 ? GUIDE_MIN_TARGET / this.k / min : 0;
  }

  /** The visible board in screen units (phones: below the docks), less `inset` client px on every side. */
  private visibleView(): Rect {
    const vp = this.viewport();
    const t = Math.min(this.topInset(), vp.height / 2);
    return { x: 0, y: t, w: vp.width, h: vp.height - t };
  }

  /**
   * Keep my pieces: a suggestion's outlines in EMPTY board beside everything on the board (right, then below, left, above:
   * `besideSpot`), and the view framed on both (`frameBeside`). `view` is the part of the board to frame them in (screen
   * units); default the visible board. With nothing on the board, centred in view as usual.
   */
  private outlinesBeside(pieces: readonly Outline[], view: Rect = this.visibleView()): Outline[] {
    const work = rotatedBounds(this.composition.pieces, (id) => SHAPE_BY_ID.get(id));
    const shape = (id: string) => SHAPE_BY_ID.get(id);
    if (!work) return outlinesAt(pieces, shape, this.visibleCentre());
    const outlines = outlinesAt(pieces, shape, this.besideCentre(pieces, work, view));
    const c = frameBeside(work, rotatedBounds(outlines, shape)!, view, GUIDE_FRAME_PAD / this.k, this.targetZoom(outlines), FIT_MAX_COMFORT * this.legacyComfortZoom());
    this.setView({ x: c.x, y: c.y, zoom: c.zoom });
    return outlines;
  }

  /**
   * The centre of the EMPTY board spot beside `work` (right, then below, left, above: `besideSpot`) for a suggestion's
   * bounds, clear of every piece of `avoidPieces` (default: the whole board). Board units.
   */
  private besideCentre(pieces: readonly Outline[], work: Rect, view: Rect = this.visibleView(), avoidPieces: readonly Outline[] = this.composition.pieces): Pt {
    const shape = (id: string) => SHAPE_BY_ID.get(id);
    const own = rotatedBounds(pieces, shape)!;
    const pad = GUIDE_FRAME_PAD / this.k;
    const minZoom = this.targetZoom(outlinesAt(pieces, shape, { x: 0, y: 0 }));
    const avoid = avoidPieces.map((p) => rotatedBounds([p], shape)!).filter(Boolean);
    const spot = besideSpot(work, { w: own.w, h: own.h }, { margin: GUIDE_BESIDE_MARGIN * STEM_LENGTH, view, pad, minZoom, avoid });
    return { x: spot.rect.x + spot.rect.w / 2, y: spot.rect.y + spot.rect.h / 2 };
  }

  /** Step 0's answer: Clear and start (one undoable clear, then step 1 on the blank board) or Keep my pieces. */
  private guideAnswer(answer: 'clear' | 'keep') {
    if (this.guide.phase !== 'ask') return;
    const theirs = this.composition.pieces.map((p) => p.id);
    this.selection = [];
    if (answer === 'clear') {
      this.guideLoading = true; // judged once, below
      let had = false;
      try {
        had = this.composition.clear(); // ONE undoable step
      } finally {
        this.guideLoading = false;
      }
      this.render();
      this.setGuide(answerAsk(this.guide, 'clear', this.letterOutlines(), this.guideWorld(), theirs));
      if (had) this.say('Board cleared. Undo brings it back.');
    } else {
      const outlines = this.cBeside();
      this.setGuide(answerAsk(this.guide, 'keep', outlines, this.guideWorld(), theirs));
    }
  }

  /**
   * Their pieces came back (an undo of Clear and start) or the board changed under an untouched c: if the c's outlines now
   * sit on pieces, they move to empty board beside them (framed), so the guide stays usable and never builds on their work.
   */
  private guideRelocate() {
    const s = this.guide;
    if (s.phase !== 'c' || s.filled.some(Boolean) || !this.composition.pieces.length || !this.boardEl.clientWidth) return;
    const shape = (id: string) => SHAPE_BY_ID.get(id);
    // From the word (v1.2.3): the WHOLE word that will be anchored on this c must stay clear of their pieces, not just the c.
    const wc = this.guideWordC();
    const word = wc ? anchorWord(wc.pieces, wc.c, s.letter, shape) : null;
    const ob = rotatedBounds(word ?? s.outlines, shape);
    const m = 0.25 * STEM_LENGTH;
    if (!ob || !this.composition.pieces.some((p) => {
      const b = rotatedBounds([p], shape);
      return b && rectsOverlap({ x: ob.x - m, y: ob.y - m, w: ob.w + 2 * m, h: ob.h + 2 * m }, b);
    })) return;
    this.setGuide(moveLetter(s, this.cBeside(), this.guideWorld()));
  }

  private skipGuide() {
    this.setGuide(endGuide());
    this.say('Guide closed.');
  }

  /**
   * After a load the view moved to frame it. An untouched c (nothing built yet) starts over: step 0 when the board now has
   * pieces (a share link arriving, a load), else centred in the new view. Otherwise the guide follows the board.
   */
  private guideAfterLoad() {
    const s = this.guide;
    if (s.phase === 'c' && !s.filled.some(Boolean) && !s.built.length && this.boardEl.clientWidth) this.setGuide(this.firstGuideState());
    else this.guideObserve();
  }

  private setGuide(next: GuideState) {
    const prev = this.guide;
    if (next === prev) return;
    this.guide = next;
    // The word: a new current batch (or the finished word) is framed, gliding there.
    if (next.phase === 'word' && !this.wordFitPending
      && (currentBatch(next) !== currentBatch(prev) || next.batches !== prev.batches || next.step !== prev.step)) this.wordFitPending = 'smooth';
    this.renderOutlines();
    if (next.step === prev.step && next.phase === prev.phase && (next.phase !== 'c' || next.letter === prev.letter || next.step === 5)) {
      // (Step 5 with a new letter: the finished c moved as one and its outlines followed it; nothing new to say.)
      // The same step: its outlines, its turning hint, its stacking prompt or its progress moved.
      const p = guideProgress(next), q = guideProgress(prev);
      const prompt = this.promptKey(next), was = this.promptKey(prev);
      if (!!next.turn !== !!prev.turn || p.done !== q.done || prompt !== was) {
        this.renderGuideContent();
        if (next.turn && !prev.turn) this.say(this.turnText());
        else if (next.step === 6 && p.done !== q.done) this.say(`${GUIDE_COPY.progress(p.done, p.total)}.`);
        if (prompt && prompt !== was && !next.turn) this.say(this.stackText(next));
        // Step 6 is long: Next is offered only after the stuck delay without progress (a new piece done, a new prompt).
        if (next.step === 6 && (p.done !== q.done || prompt !== was)) this.armNext();
      }
      this.guideAutoSelect();
      this.scheduleGuide();
      return;
    }
    clearTimeout(this.guideNextTimer);
    this.guideNext = false;
    const hadFocus = this.guideEl.contains(this.shadowRoot!.activeElement);
    if (!guideRunning(next)) {
      this.guideFocusOnShow = false;
      this.wordFitPending = false;
      this.stopGlide();
      this.guideEl.hidden = true;
      this.guideEl.dataset.step = '0';
      if (hadFocus) this.surface.focus();
      return;
    }
    this.armNext();
    this.renderGuideContent();
    this.say(this.guideSpeech());
    this.guideAutoSelect();
    if (hadFocus) this.guideFocusOnShow = true; // a keyboard user who pressed a guide button stays in the callout
    this.scheduleGuide();
  }

  /** (Re)start the stuck delay: Next shows only once it passes with nothing achieved (steps with something to do). */
  private armNext() {
    clearTimeout(this.guideNextTimer);
    const was = this.guideNext;
    this.guideNext = false;
    if (was) this.renderGuideContent();
    const s = this.guide;
    if (!this.guideHasControls(s.step) || s.phase === 'ask' || !guideRunning(s)) return;
    const step = s.step;
    this.guideNextTimer = window.setTimeout(() => {
      if (this.guide.step !== step || this.guide.phase === 'ask') return;
      this.guideNext = true;
      this.renderGuideContent();
      this.scheduleGuide();
    }, FridgeFace.guideNextMs);
  }

  /** Step 0 and the steps with something to do carry Skip and Don't show again (and Next when stuck); steps 5 and 7 have their own buttons. */
  private guideHasControls(step: number): boolean {
    return step === 0 || step === 1 || step === 2 || step === 3 || step === 4 || step === 6;
  }

  /** The stacking prompt showing (step 3, or step 6 when no turning hint takes its place), as a key: '' when none. */
  private promptKey(s: GuideState): string {
    if (!s.stack || !(s.step === 3 || (s.step === 6 && !s.turn))) return '';
    return `${s.step}:${s.stack.id}:${s.stack.dir}`;
  }

  private stackText(s: GuideState): string {
    if (s.step === 3) return GUIDE_COPY.step3;
    return s.stack?.dir === 'forward' ? GUIDE_COPY.stackForward : GUIDE_COPY.stackBack;
  }

  /** The prompt the auto-selection last served ('' none): a new prompt selects its piece once, never fighting the visitor. */
  private guideSelectedFor = '';

  /**
   * A new stacking prompt selects the piece it is about, so the block's Back / Forward (Send backward / Bring forward) act on it.
   * Not while the visitor is in the middle of something else (a gesture, a sheet, menu or dialog): it waits until that ends.
   */
  private guideAutoSelect() {
    const s = this.guide;
    const key = this.promptKey(s);
    if (!key) {
      this.guideSelectedFor = '';
      return;
    }
    if (key === this.guideSelectedFor) return;
    const busy = this.inGesture || !!this.trayDrag?.active || !!this.boxSel?.active || this.helpOpen || this.suggOpen || this.menuOpen;
    if (busy) return; // tried again when the board is next judged (the gesture's end)
    this.guideSelectedFor = key;
    const id = s.stack!.id;
    if (!(this.selection.length === 1 && this.selection[0] === id) && this.composition.getPiece(id)) this.select(id);
  }

  /** The board changed (outside a gesture): the guide re-reads which outlines are filled. */
  private guideObserve() {
    if (!guideRunning(this.guide)) return;
    this.guideAutoSelect(); // a prompt that waited for a gesture to end
    if (this.guide.phase === 'ask') {
      // The visitor emptied the board themselves (or undid back to blank): nothing left to ask about.
      if (!this.composition.pieces.length && this.boardEl.clientWidth) this.setGuide(startGuide(this.letterOutlines(), this.guideWorld()));
      return;
    }
    this.setGuide(observeGuide(this.guide, this.guideWorld()));
  }

  /**
   * Guide only: released pieces close to an active outline of their shape click exactly into it, with a short settle:
   * position and angle only, the stacking order is never touched (v1.3.0). Folded into the undo step that just recorded the release (a drag, a
   * turn, a twist, a drop from the tray, a pause in `,` `.` turning). With the guide not running this does nothing at all.
   */
  private guideSnap(ids: readonly string[]) {
    if (!this.guide.step || !ids.length) return;
    const r = guideClickIn(this.guide, this.guideWorld(), ids);
    if (!r) return;
    const before = new Map(this.composition.pieces.map((p) => [p.id, p]));
    this.applying = true;
    try {
      this.composition.setPlacements(r.placements.map(({ id, x, y, rotation }) => ({ id, x, y, rotation })));
    } finally {
      this.applying = false;
    }
    this.history.amend(this.composition.pieces); // the same undo step as the release that caused it
    this.render();
    this.settle(r.placements, before);
    this.say(r.placements.length === 1 ? 'Clicked into place.' : `${r.placements.length} pieces clicked into place.`);
    this.setGuide(recordBuilt(this.guide, r.placements.map((p) => p.id))); // guide-built (never one of theirs)
    this.guideObserve();
  }

  /** The click: each piece glides from where it was let go to its outline (transforms only; none with reduced motion). */
  private settle(placements: readonly { id: string; x: number; y: number; rotation: number }[], before: ReadonlyMap<string, Piece>) {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const opts: KeyframeAnimationOptions = { duration: SETTLE_MS, easing: SETTLE_EASE };
    for (const pl of placements) {
      const old = before.get(pl.id), el = this.els.get(pl.id), s = old ? SHAPE_BY_ID.get(old.shapeId) : undefined;
      if (!old || !el || !s || typeof el.g.animate !== 'function') continue;
      if (old.x !== pl.x || old.y !== pl.y) {
        el.g.animate([{ transform: `translate(${n3(old.x)}px, ${n3(old.y)}px)` }, { transform: `translate(${n3(pl.x)}px, ${n3(pl.y)}px)` }], opts);
      }
      if (old.rotation !== pl.rotation) {
        const to = old.rotation + normalise(pl.rotation - old.rotation); // the short way round
        const back = `translate(${n3(-s.centroid.x)}px, ${n3(-s.centroid.y)}px)`;
        for (const r of el.rots) r.animate([{ transform: `rotate(${n3(old.rotation)}deg) ${back}` }, { transform: `rotate(${n3(to)}deg) ${back}` }], opts);
      }
    }
  }

  /**
   * Step 5's Guide me (v1.2.3): NOTHING is cleared. The word's outlines go in the same board frame as the built c
   * (`anchorWord`), so the c's three pieces sit exactly on their outlines: they count as filled ("3 of 32") and their
   * outlines never show. The board does not change, so there is no undo step here (an undo undoes the c's last piece, and
   * the guide follows, staying on the word). Fallback (the c is not the word's c, or the word anchored on it would overlap
   * other pieces, e.g. the c was moved next to them): the c's pieces become the visitor's own and the word goes in fresh,
   * in empty board beside everything on it.
   */
  private guideChooseWord() {
    const w = this.guideWordSuggestion();
    const s0 = this.guide;
    if (!w || s0.step !== 5) return;
    const shape = (id: string) => SHAPE_BY_ID.get(id);
    const cIds = s0.filled.filter((id): id is string => !!id);
    const others = this.composition.pieces.filter((p) => !cIds.includes(p.id));
    const wc = findWordC(w.pieces, shape);
    let outlines = wc ? anchorWord(w.pieces, wc, s0.letter, shape, others.map((p) => rotatedBounds([p], shape)!)) : null;
    let s = s0;
    if (!outlines) {
      s = adoptTheirs(s0, cIds);
      const work = rotatedBounds(this.composition.pieces, shape)!;
      outlines = outlinesAt(w.pieces, shape, this.besideCentre(w.pieces, work));
    }
    this.wordFitPending = 'smooth';
    this.select(null);
    this.setGuide(chooseWord(s, outlines, this.guideWorld(), { boxOf: (o) => this.tightBounds([o])!, span: localitySpan(outlines.map((o) => this.tightBounds([o])!), GUIDE_WORD.text.length, BATCH_SPAN_LETTERS) }));
  }

  /** Apply a clear plan as ONE undoable step: the whole board, or only the guide-built pieces. Whether anything went. */
  private guideClear(plan: ReturnType<typeof guideClearPlan>): boolean {
    return plan.all ? this.composition.clear() : plan.ids.length > 0 && this.composition.deletePieces(plan.ids) > 0;
  }

  /**
   * Next (when stuck) does the current thing for the visitor, as one undoable step: restack the prompted piece (the order
   * its presses would give), else fill the next outline (the piece that needs turning, else a new one, landing on top).
   */
  private guideNextFill() {
    const s = this.guide;
    const act = nextAction(s);
    if (!act) return;
    if (act.kind === 'stack') {
      this.select(act.prompt.id);
      if (this.composition.reorder(act.prompt.order)) this.say(act.prompt.dir === 'back' ? 'Sent back for you.' : 'Brought forward for you.');
      this.guideObserve();
      return;
    }
    const o = s.outlines[act.outline];
    const turning = s.turn ? this.composition.getPiece(s.turn) : undefined;
    if (turning && turning.shapeId === o.shapeId) {
      this.composition.setPlacements([{ id: turning.id, x: o.x, y: o.y, rotation: settleRotation(o, turning.rotation) }]); // the short way (symmetry)
    } else {
      const [p] = this.composition.addPieces([o]);
      this.select(p.id);
    }
    this.say('Placed for you.');
    this.setGuide(recordBuilt(this.guide, [turning && turning.shapeId === o.shapeId ? turning.id : this.selection[0]].filter(Boolean)));
    this.guideObserve();
  }

  private guideTouch(): boolean {
    return this.inputSections().touch;
  }

  private turnText(): string {
    return this.guideTouch() ? GUIDE_COPY.step4bTouch : GUIDE_COPY.step4b;
  }

  /**
   * The callout's lines for the current step: the main text, a second line (step 5's question, step 6's progress) and step
   * 6's third line: the turning hint, or else the stacking prompt.
   */
  private guideLines(): [string, string, string] {
    const s = this.guide;
    if (s.phase === 'ask') return [GUIDE_COPY.step0, '', ''];
    switch (s.step) {
      case 1: return [GUIDE_COPY.step1, '', ''];
      case 2: return [GUIDE_COPY.step2, '', ''];
      case 3: return [GUIDE_COPY.step3, '', ''];
      case 4: return [s.turn ? this.turnText() : GUIDE_COPY.step4a, '', ''];
      case 5: return [GUIDE_COPY.step5, this.guideWordSuggestion() ? GUIDE_COPY.step5Ask : '', ''];
      case 6: {
        const p = guideProgress(s);
        return [GUIDE_COPY.step6, GUIDE_COPY.progress(p.done, p.total), s.turn ? this.turnText() : this.promptKey(s) ? this.stackText(s) : ''];
      }
      case 7: return [GUIDE_COPY.step7, '', ''];
      default: return ['', '', ''];
    }
  }

  private guideSpeech(): string {
    return this.guideLines().filter(Boolean).map((l) => (/[.?!]$/.test(l) ? l : `${l}.`)).join(' ');
  }

  /** The callout's words and buttons for the current step. */
  private renderGuideContent() {
    const g = this.guideEl;
    if (!g) return;
    const s = this.guide.step;
    const ask = this.guide.phase === 'ask';
    g.dataset.step = String(s);
    g.toggleAttribute('data-ask', ask);
    g.toggleAttribute('data-turn', !!this.guide.turn);
    const lines = this.guideLines();
    ['.gt1', '.gt2', '.gt3'].forEach((sel, i) => {
      const el = g.querySelector<HTMLElement>(sel)!;
      if (el.textContent !== lines[i]) el.textContent = lines[i];
      if (i) el.hidden = !lines[i];
    });
    g.querySelector<HTMLElement>('.gt2')!.classList.toggle('gprog', s === 6);
    g.toggleAttribute('data-stack', !!this.promptKey(this.guide));
    const hasWord = !!this.guideWordSuggestion();
    const active = this.shadowRoot!.activeElement;
    const pick5 = g.querySelector<HTMLElement>('[data-pick="5"]')!, pick7 = g.querySelector<HTMLElement>('[data-pick="7"]')!;
    const word = g.querySelector<HTMLElement>('[data-guide=word]')!, clear = g.querySelector<HTMLElement>('[data-guide=clear]')!;
    const ctl = g.querySelector<HTMLElement>('.gctl')!, next = g.querySelector<HTMLElement>('[data-guide=next]')!;
    g.querySelector<HTMLElement>('[data-pick="0"]')!.hidden = !ask;
    pick5.hidden = s !== 5;
    word.hidden = !hasWord;
    clear.classList.toggle('pri', !hasWord); // alone, it is the main button
    pick7.hidden = s !== 7;
    ctl.hidden = !guideRunning(this.guide) || !this.guideHasControls(s);
    next.hidden = !(this.guideNext && !ctl.hidden);
    // A focused button that just went away hands focus to the first button still showing.
    if (active && g.contains(active) && (active as HTMLElement).closest('[hidden]')) g.querySelector<HTMLElement>('.grow:not([hidden]) button:not([hidden])')?.focus();
  }

  private onGuideClick(e: MouseEvent) {
    const act = (e.target as HTMLElement).closest<HTMLElement>('button[data-guide]')?.dataset.guide;
    if (!act) return;
    if (act === 'next') {
      this.guideNextFill();
      this.scheduleGuide();
    } else if (act === 'skip') this.skipGuide();
    else if (act === 'off') {
      writeGuideOff(() => localStorage); // if storage fails, it still ends for this visit
      this.setGuide(endGuide());
      this.say('Guide turned off. Show it again from Controls.');
    } else if (act === 'clean') this.guideAnswer('clear');
    else if (act === 'mine') this.guideAnswer('keep');
    else if (act === 'word') this.guideChooseWord();
    else if (act === 'keep') {
      this.setGuide(endGuide());
      this.say('Guide closed.');
    } else if (act === 'clear' || act === 'fresh') {
      // ONE undoable step: the whole board on a blank start; ONLY the guide-built pieces once the visitor kept theirs.
      const plan = guideClearPlan(this.guide, this.composition.pieces);
      this.setGuide(endGuide()); // first: the guide is over, the clear is the visitor's
      this.selection = [];
      const had = this.guideClear(plan);
      this.say(had ? (plan.all ? 'Board cleared. Undo brings it back.' : 'The guide\'s pieces are cleared; yours are kept. Undo brings them back.') : 'Guide closed.');
    }
  }

  /**
   * The active outlines, drawn above the pieces in blueprint blue, in screen px: a SOLID line for a positive (black) shape, a
   * DOTTED one for a negative (white) shape, the same weight. Never takes pointer events.
   */
  private renderOutlines() {
    const layer = this.outlinesEl;
    if (!layer) return;
    this.outlineZoom = this.view.zoom;
    const s = this.guide;
    const active = s.step ? activeOutlines(s) : [];
    layer.replaceChildren();
    if (!active.length) return;
    const k = this.k * this.view.zoom; // CSS px per board unit
    const draw = (i: number) => {
      const o = s.outlines[i];
      const sh = SHAPE_BY_ID.get(o.shapeId);
      if (!sh) return;
      const solid = sh.polarity === 'positive';
      const w = n3(OUTLINE_PX / k);
      const dash = OUTLINE_DASH.map((d) => n3(d / k)).join(' ');
      const g = svgEl('g', {
        'data-outline': String(i), 'data-shape': o.shapeId, 'data-line': solid ? 'solid' : 'dotted',
        transform: `translate(${n3(o.x)} ${n3(o.y)}) rotate(${n3(o.rotation)}) translate(${n3(-sh.centroid.x)} ${n3(-sh.centroid.y)})`,
      });
      const look = `fill="${OUTLINE_COLOR}" fill-opacity="0.1" stroke="${OUTLINE_COLOR}"`;
      g.innerHTML = geometryTemplate(sh).replace(
        '{a}',
        `${look} stroke-width="${w}"${solid ? '' : ` stroke-dasharray="${dash}"`} stroke-linecap="round" stroke-linejoin="round"`,
      );
      layer.append(g);
    };
    for (const i of active) draw(i);
  }

  /** A board point in client px (through the camera state, not the DOM, which lags by a frame). */
  private boardToClient(p: Pt): Pt {
    const b = this.boardEl.getBoundingClientRect();
    const k = this.k, v = this.view;
    return { x: b.left + (p.x * v.zoom + v.x) * k, y: b.top + (p.y * v.zoom + v.y) * k };
  }

  /** An outline's bounds on screen, client px (from the shape's real outline). */
  private outlineRect(o: Outline): Rect {
    const b = boundsOf(placeOutline(SHAPE_BY_ID.get(o.shapeId)?.hull ?? [], o).map((q) => this.boardToClient(q)));
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  private scheduleGuide() {
    if (!this.guideEl || this.guideFrame || !guideRunning(this.guide)) return;
    this.guideFrame = requestAnimationFrame(() => {
      this.guideFrame = 0;
      this.syncGuide();
    });
  }

  /** The visible board, minus a margin (and the safe-area insets that overlap it), clipped to the window: the callout stays inside it. */
  private guideBounds(): Rect {
    const b = this.boardEl.getBoundingClientRect();
    const cs = this.rootEl.style;
    const px = (v: string) => parseFloat(cs.getPropertyValue(v)) || 0;
    const m = 8;
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const left = Math.max(b.left + m + (this.isLandscape ? 0 : px('--sal')), m);
    const top = Math.max(b.top + m + px('--sat'), m);
    const right = Math.min(b.right - m - px('--sar'), vw - m);
    const bottom = Math.min(b.bottom - m - (this.isLandscape ? px('--sab') : 0), vh - m);
    return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  }

  /** The controls the callout must not cover: the dock panels (the button block among them) and the notice. */
  private guideObstacles(): Rect[] {
    const out: Rect[] = [];
    const shown = (e: HTMLElement) => !e.hidden && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    for (const e of [...this.dockEl.querySelectorAll<HTMLElement>(':scope > .panel'), this.noticeEl]) if (shown(e)) out.push(toRect(e.getBoundingClientRect()));
    return out.filter((r) => r.w > 0 && r.h > 0);
  }

  private get trayPrefer(): Exclude<CalloutSide, 'centre'>[] {
    return this.isLandscape ? ['right', 'above', 'below'] : ['above', 'right', 'left', 'below'];
  }

  /**
   * What the current step points at and which sides to try. Steps 1, 2 and 4 (4a): the tray shape to drag. 4b and step 6's
   * hint: the rotate handle of the piece that needs turning (or the piece). Step 3 and step 6's stacking prompt: the block's
   * Back (Send backward) or Forward (Bring forward) (the piece itself while the block's buttons are not showing). Step 6: the tray. Steps 5 and 7:
   * the board (centred).
   */
  private guideTargets(bounds: Rect): GuideTarget[] {
    const s = this.guide;
    const visible = (r: Rect) => r.w > 0 && r.x + r.w / 2 >= bounds.x && r.x + r.w / 2 <= bounds.x + bounds.w && r.y + r.h / 2 >= bounds.y && r.y + r.h / 2 <= bounds.y + bounds.h;
    const board: GuideTarget = { target: null, avoid: [], prefer: [], kind: 'board' };
    if (s.turn && (s.step === 4 || s.step === 6)) {
      const out: GuideTarget[] = [];
      if (this.selection.length === 1 && this.selection[0] === s.turn) {
        const hit = this.overlay.querySelector<SVGElement>('[data-handle] circle');
        const t = hit ? toRect(hit.getBoundingClientRect()) : null;
        if (t && visible(t)) out.push({ target: t, avoid: [], prefer: ['above', 'right', 'left', 'below'], kind: 'handle' });
      }
      const g = this.els.get(s.turn)?.g.querySelector('.bd');
      const r = g ? toRect(g.getBoundingClientRect()) : null;
      if (r && visible(r)) out.push({ target: r, avoid: [], prefer: ['above', 'below', 'right', 'left'], kind: 'piece', piece: s.turn });
      if (out.length) return [...out, board];
    }
    if (this.promptKey(s)) {
      const out: GuideTarget[] = [];
      const action = s.stack!.dir === 'back' ? 'backward' : 'forward';
      const g = this.els.get(s.stack!.id)?.g.querySelector('.bd');
      const pr = g ? toRect(g.getBoundingClientRect()) : null;
      const btn = this.blockEl.querySelector<HTMLElement>(`[data-block=${action}]`);
      const r = btn && !btn.closest('[hidden]') && getComputedStyle(this.blockEl).visibility !== 'hidden' ? toRect(btn.getBoundingClientRect()) : null;
      // The block's Back or Forward: above it (the block sits along the board's foot), else beside it; the piece kept in sight.
      if (r && visible(r)) out.push({ target: r, avoid: pr ? [pr] : [], prefer: ['above', 'below', 'right', 'left'], kind: 'action', action });
      if (pr && visible(pr)) out.push({ target: pr, avoid: [], prefer: ['above', 'below', 'right', 'left'], kind: 'piece', piece: s.stack!.id });
      if (out.length) return [...out, board];
    }
    const tray = toRect(this.trayEl.getBoundingClientRect());
    if (s.step === 1 || s.step === 2 || s.step === 4) {
      const o = s.outlines[activeOutlines(s)[0] ?? -1];
      const btn = o ? this.trayEl.querySelector(`button[data-shape="${o.shapeId}"]`) : null;
      const r = btn ? toRect(btn.getBoundingClientRect()) : null;
      // That shape's slice of the tray: its column across the tray's full height (its row, in the landscape column).
      const slice = r && r.w > 0 ? (this.isLandscape ? { x: tray.x, y: r.y, w: tray.w, h: r.h } : { x: r.x, y: tray.y, w: r.w, h: tray.h }) : tray;
      return [{ target: slice, avoid: [], prefer: this.trayPrefer, kind: 'tray', shape: o?.shapeId }];
    }
    if (s.step === 6) return [{ target: tray, avoid: [], prefer: this.trayPrefer, kind: 'tray' }];
    return [board];
  }

  // ---- the word, one batch at a time ---------------------------------------------------------------------------

  /**
   * The layout switched between compact and desktop (a phone rotated, a window resized): the batches are the same on every
   * layout (nothing on the board or in the guide changes); only the framing does, so the current batch is framed again,
   * and the outlines are redrawn (the same batch outlines on every layout).
   */
  private syncGuideLayout() {
    const s = this.guide;
    if (s.phase !== 'word' || !this.boardEl?.clientWidth) return;
    const compact = this.isCompact;
    if (compact === this.lastCompact) return;
    this.lastCompact = compact;
    this.wordFitPending = 'instant';
    this.renderOutlines();
  }

  private lastCompact: boolean | null = null;

  /** Every rotate handle showing (one piece's, or a selection's), as its 44 px hit box plus HANDLE_CLEAR, client px. */
  private handleRects(): Rect[] {
    const out: Rect[] = [];
    for (const h of this.overlay.querySelectorAll<SVGGElement>('[data-handle]')) {
      const r = h.querySelector('circle')?.getBoundingClientRect(); // the hit circle (its box is wider once turned: use its centre)
      if (!r || !r.width) continue;
      const half = HANDLE_HIT / 2 + HANDLE_CLEAR;
      out.push({ x: r.left + r.width / 2 - half, y: r.top + r.height / 2 - half, w: 2 * half, h: 2 * half });
    }
    return out;
  }

  /** Phones: where the button block sits along the board's foot (client px), even while the letters sheet hides it; null on desktop. */
  private blockRect(): Rect | null {
    if (!this.isCompact) return null;
    const r = toRect(this.blockEl.getBoundingClientRect());
    return r.w > 0 && r.h > 0 ? r : null;
  }

  /** The tight bounds (board units) of outlines, from their shapes' real outlines (rotated bounding boxes overstate them). */
  private tightBounds(list: readonly Outline[]): Rect | null {
    const pts = list.flatMap((o) => placeOutline(SHAPE_BY_ID.get(o.shapeId)?.hull ?? [], o));
    if (!pts.length) return null;
    const b = boundsOf(pts);
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  /**
   * Phones: frame `b` (board units) as large as it can show in the visible board, clear of the callout (placed by the tray,
   * at each width it may take, in its tallest form) and of the button block (always showing along the board's foot). The largest
   * free strip wins (`freeRect`); the callout later places itself clear of the outlines.
   */
  private frameClear(b: Rect, parts: readonly Rect[], widths: readonly number[], bounds: Rect, obstacles: readonly Rect[], smooth: boolean, need = 0, ctx: SectionContext | null = null, onlyIfFits = false): boolean {
    const g = this.guideEl;
    const bar = this.blockRect();
    const tray = toRect(this.trayEl.getBoundingClientRect());
    const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
    const t3 = g.querySelector<HTMLElement>('.gt3')!, was = [t3.textContent, t3.hidden] as const;
    if (this.guide.step === 6 || this.guide.phase === 'c') {
      t3.textContent = this.turnText(); // room for the turning hint, so it never has to cover the outlines later
      t3.hidden = false;
    }
    const sizes = widths.map((w) => {
      g.style.maxWidth = w ? `${w}px` : '';
      return { w: g.offsetWidth, h: g.offsetHeight };
    });
    t3.textContent = was[0];
    t3.hidden = was[1];
    const pad = SECTION_FRAME_PAD;
    const hardBase = bar ? [...obstacles, bar] : [...obstacles];
    // The docks (phones: along the top) block only where they are: the board between them is free (landscape).
    // Portrait (v1.5.0): the view group alone sits at the top right, but the strip it stands in is kept for the callout (it
    // steps up there beside the group when a rotate handle pushes it), so the whole strip counts as the dock, as when the
    // undo group stood at its left.
    const band = (r: Rect): Rect => (this.isLandscape ? r : { x: bounds.x, y: r.y, w: bounds.w, h: r.h });
    const docks = obstacles.filter((r) => !bar || !rectsOverlap(r, bar)).map((r) => grow(band(r), 6));
    // 1. The largest strip clear of the docks, the callout (placed by the tray) and the button block.
    let best: { rect: Rect; scale: number } | null = null;
    for (const size of sizes) {
      const p = placeCallout(size, tray, bounds, hardBase, this.trayPrefer);
      const blockers = [grow({ x: p.x, y: p.y, w: size.w, h: size.h }, 20), ...(bar ? [grow(bar, 6)] : [])];
      const f = freeRect({ w: b.w, h: b.h }, bounds, [...docks, ...blockers], pad);
      if (!best || f.scale > best.scale) best = f;
    }
    let reg = best!.rect;
    let fits = need <= best!.scale;
    if (need > best!.scale) {
      // 2. That leaves the thinnest targets too small: try larger scales, up to what they need (or the board between the
      //    docks allows), each at a few places in that room, and take the largest at which the callout still finds a spot
      //    by the tray clear of every outline and the button block (empty board beside the outlines, or over finished pieces).
      const room = freeRect({ w: b.w, h: b.h }, bounds, docks, pad);
      const top = Math.min(need, room.scale);
      const clear = (r: Rect, hard: readonly Rect[]) => !hard.some((q) => rectsOverlap(r, q));
      const STEPS = 12;
      search: for (let i = 0; i < STEPS && top > best!.scale; i++) {
        const scale = top - ((top - best!.scale) * i) / STEPS;
        const a = room.rect;
        const w = b.w * scale + 2 * pad, h = b.h * scale + 2 * pad;
        const along = (lo: number, room: number) => [0.5, 0, 1, 0.25, 0.75].map((f) => lo + Math.max(0, room) * f);
        const xs = along(a.x, a.w - w), ys = along(a.y, a.h - h).sort((p, q) => p - q);
        for (const y of ys) for (const x of xs) {
          const rects = parts.map((q) => ({ x: x + pad + (q.x - b.x) * scale, y: y + pad + (q.y - b.y) * scale, w: q.w * scale, h: q.h * scale }));
          if (bar && rects.some((r) => rectsOverlap(r, bar))) continue; // never under the button block
          const hard = [...hardBase, ...rects.map((r) => grow(r, 8))]; // a little air: the callout is placed again with the real outlines
          for (const size of sizes) {
            const p = placeCallout(size, tray, bounds, hard, this.trayPrefer);
            if (clear({ x: p.x, y: p.y, w: size.w, h: size.h }, hard)) {
              reg = { x, y, w, h };
              fits = true;
              break search;
            }
          }
        }
      }
    }
    if (onlyIfFits) {
      // The caller tries a lower target when this one leaves the callout no room: checked on the view it would really take
      // (the section's place in the room, the callout by the tray clear of every outline and the button block).
      const to = this.viewFor(b, reg, ctx);
      const board = this.boardEl.getBoundingClientRect();
      const k = this.k;
      const rects = parts.map((q) => ({ x: board.left + (to.x + q.x * to.zoom) * k, y: board.top + (to.y + q.y * to.zoom) * k, w: q.w * to.zoom * k, h: q.h * to.zoom * k }));
      // The rotate handle of what is selected stays where it is on the piece: carried to the new view with its piece.
      const v0 = this.view;
      const handles = this.handleRects().map((h) => {
        const bx = ((h.x + h.w / 2 - board.left) / k - v0.x) / v0.zoom, by = ((h.y + h.h / 2 - board.top) / k - v0.y) / v0.zoom;
        return { x: board.left + (to.x + bx * to.zoom) * k - h.w / 2, y: board.top + (to.y + by * to.zoom) * k - h.h / 2, w: h.w, h: h.h };
      });
      const hard = [...hardBase, ...rects.map((r) => grow(r, 8)), ...handles];
      fits = fits && sizes.some((size) => {
        const p = placeCallout(size, tray, bounds, hard, this.trayPrefer);
        return !hard.some((q) => rectsOverlap({ x: p.x, y: p.y, w: size.w, h: size.h }, q));
      });
      if (!fits) return false;
    }
    this.frameRect(b, reg, smooth, ctx);
    return true;
  }

  /** The current batch's outlines (all of them, filled or not, so the framing holds still while it is filled). */
  private batchOutlines(): Outline[] {
    const s = this.guide;
    const k = currentBatch(s);
    return k < 0 || !s.batches ? [] : s.batches[k].map((i) => s.outlines[i]);
  }

  /**
   * Phones, step 6: frame the CURRENT batch with a little board around it (BATCH_CONTEXT_STEMS), as large as the room
   * clear of the docks, the callout and the button block allows (`frameClear`), gliding there unless `smooth` is false. Never
   * closer than the c's close-up (`cFrameZoom`'s 45% oval), so a batch of one small piece still shows where it goes.
   */
  private fitBatch(widths: readonly number[], bounds: Rect, obstacles: readonly Rect[], smooth: boolean) {
    const list = this.batchOutlines();
    const tight = this.tightBounds(list);
    if (!tight) return;
    // The scale (CSS px per board unit) at which the thinnest current target is `target` px across.
    const thin = Math.min(...list.map((o) => {
      const u = SHAPE_BY_ID.get(o.shapeId)?.uprightBox;
      return u ? Math.min(u.w, u.h) : Infinity;
    }));
    const v = this.visibleView();
    const parts = list.map((o) => this.tightBounds([o])!);
    const maxZoom = cFrameZoom({ width: v.w, height: v.h }, OVAL_WIDTH, { w: 0, h: 0 }, 0);
    // The target to aim for: the global one, and for a batch that cannot fit it, the largest lower one (down to the floor) that does.
    const top = this.isLandscape ? SECTION_MIN_TARGET_SHORT : SECTION_MIN_TARGET;
    const lowest = top - SECTION_TARGET_DROP;
    for (let target = top; target >= lowest; target -= SECTION_TARGET_STEP) {
      // The context around it (room for the rotate handles, and a glimpse of the built pieces), given up where it would cost a
      // wide or tall batch its targets in the visible board.
      const need = Number.isFinite(thin) && thin > 0 ? target / thin : 0;
      const roomW = need ? (v.w * this.k - 2 * SECTION_FRAME_PAD) / need : Infinity, roomH = need ? (v.h * this.k - 2 * SECTION_FRAME_PAD) / need : Infinity;
      const m = Math.max(0, Math.min(BATCH_CONTEXT_STEMS * STEM_LENGTH, (roomW - tight.w) / 2, (roomH - tight.h) / 2));
      const b = { x: tight.x - m, y: tight.y - m, w: tight.w + 2 * m, h: tight.h + 2 * m };
      // As large as the free strip beside the callout allows (up to the cap); where that leaves the thinnest target under
      // `target`, larger, as far as the callout can still step aside clear of the outlines. Room above and below for a rotate
      // handle (a tall stem framed edge to edge would leave its handle nowhere to go).
      const ctx = { maxZoom, vpad: HANDLE_GAP + HANDLE_HIT / 2, minZoom: need / this.k };
      const last = target - SECTION_TARGET_STEP < lowest;
      if (this.frameClear(b, parts, widths, bounds, obstacles, smooth, need, ctx, !last)) return;
    }
  }

  /**
   * Desktop, step 6 (and the finished word at step 7): `b` (board units) in view with BATCH_DESKTOP_PAD of air, clear of the
   * docks and the tray. When it already is, the view does not move. Otherwise it slides just enough to bring it in, and
   * zooms out only if it cannot fit at the current zoom, never zooming in past the comfortable zoom (zoomed in further by
   * the visitor, it comes back to the comfortable zoom).
   */
  private fitDesktop(b: Rect, smooth: boolean) {
    const k = this.k;
    const top = this.topInset(); // board units of screen covered at the top (docks)
    const pad = BATCH_DESKTOP_PAD / k;
    const vp = this.viewport();
    const view = { x: 0, y: Math.min(top, vp.height / 2), w: vp.width, h: vp.height - Math.min(top, vp.height / 2) };
    // The callout's own room by the tray (its tallest form) is left free along the bottom edge on desktop.
    const cal = this.guideEl.offsetHeight ? (this.guideEl.offsetHeight + 24) / k : 0;
    const room = { x: view.x + pad, y: view.y + pad, w: view.w - 2 * pad, h: view.h - 2 * pad - cal };
    const cur = this.view;
    const zFit = Math.min(room.w / Math.max(1, b.w), room.h / Math.max(1, b.h));
    const zoom = Math.min(cur.zoom, this.comfortZoom(), zFit);
    let x = cur.x, y = cur.y;
    if (zoom !== cur.zoom) {
      // Zooming: keep the board point at the view's centre where it is, then slide.
      const c = screenToBoard(cur, { x: view.x + view.w / 2, y: view.y + view.h / 2 });
      x = view.x + view.w / 2 - c.x * zoom;
      y = view.y + view.h / 2 - c.y * zoom;
    }
    const slide = (lo: number, len: number, rlo: number, rlen: number, off: number) => {
      const a = lo * zoom + off, e = (lo + len) * zoom + off;
      if (e - a > rlen) return rlo + rlen / 2 - (lo + len / 2) * zoom; // larger than the room: centre it
      if (a < rlo) return off + (rlo - a);
      if (e > rlo + rlen) return off - (e - (rlo + rlen));
      return off;
    };
    x = slide(b.x, b.w, room.x, room.w, x);
    y = slide(b.y, b.h, room.y, room.h, y);
    if (Math.abs(x - cur.x) < 0.5 / k && Math.abs(y - cur.y) < 0.5 / k && zoom === cur.zoom) return; // already in view: still
    const to = { x, y, zoom };
    if (smooth) this.glideTo(to);
    else {
      this.stopGlide();
      this.setView(to);
    }
  }

  /**
   * Phones, steps 1 to 4: the c (oval and wedge, all its outlines) framed with the black oval 45% of the visible board's
   * shorter side, or less where the whole c does not then fit the room the docks, the callout (in its tallest form), the
   * button block and the tray leave (`frameClear`: the largest free strip wins, the c centred in it).
   */
  private fitC(widths: readonly number[], bounds: Rect, obstacles: readonly Rect[]) {
    const list = this.guide.outlines;
    const b = this.tightBounds(list);
    if (!b) return;
    const v = this.visibleView();
    const maxZoom = cFrameZoom({ width: v.w, height: v.h }, OVAL_WIDTH, { w: 0, h: 0 }, 0); // the 45% zoom, whatever the room
    this.frameClear(b, list.map((o) => this.tightBounds([o])!), widths, bounds, obstacles, false, 0, { maxZoom, slack: C_FIT_SLACK });
  }

  /** Step 7: the finished word, framed whole (phones: the callout centres itself clear of it where it can; desktop: `fitDesktop`). */
  private fitFinishedWord(bounds: Rect, smooth: boolean) {
    const b = this.tightBounds(this.guide.outlines);
    if (!b) return;
    if (!this.isCompact) return this.fitDesktop(b, smooth);
    const bw = this.boardEl.getBoundingClientRect().width;
    this.frameClear(b, [], [this.isLandscape ? Math.max(190, Math.round(bw * 0.3)) : Math.round(Math.min(300, bw - 32))], bounds, this.guideObstacles(), smooth);
  }

  /**
   * Frame board rect `b` centred in `reg` (client px) with SECTION_FRAME_PAD of air, as large as fits (a section is small,
   * so up to SECTION_MAX_COMFORT times the comfortable scale: Frame all's cap would keep its thinnest targets too small).
   */
  private frameRect(b: Rect, reg: Rect, smooth: boolean, ctx: SectionContext | null = null) {
    this.moveView(this.viewFor(b, reg, ctx), smooth);
  }

  /** The view `frameRect` would take (board units), without moving to it. */
  private viewFor(b: Rect, reg: Rect, ctx: SectionContext | null = null): Camera {
    const board = this.boardEl.getBoundingClientRect();
    const k = this.k;
    const m = SECTION_FRAME_PAD;
    const fitIn = (h: number) => Math.min(((reg.w - 2 * m) / k) / Math.max(1, b.w), ((h - 2 * m) / k) / Math.max(1, b.h));
    // Room for a rotate handle above (`vpad`), given up only as far as it would cost the targets their minimum (`minZoom`).
    const vfit = ctx?.vpad ? Math.min(fitIn(reg.h), Math.max(fitIn(reg.h - ctx.vpad), ctx.minZoom ?? 0)) : fitIn(reg.h);
    const zoom = Math.min((ctx?.slack ?? 1) * vfit, SECTION_MAX_COMFORT * this.comfortZoom(), ctx?.maxZoom ?? Infinity);
    const cx = (reg.x + reg.w / 2 - board.left) / k, cy = (reg.y + reg.h / 2 - board.top) / k;
    const to = { x: cx - (b.x + b.w / 2) * zoom, y: cy - (b.y + b.h / 2) * zoom, zoom };
    if (ctx) {
      // Vertically: where the view is zoomed out past what the room needs, the section sits at the top of it, leaving the
      // spare room below it for the callout to move into (a rotate handle can push the callout up from the tray).
      const spare = reg.h / k - 2 * m / k - b.h * zoom; // board's screen units left over in the room
      const top = Math.min(spare, Math.max(spare * 0.25, (ctx.vpad ?? 0) / k)); // the handle's room above it first, where it fits
      to.y = (reg.y - board.top) / k + m / k - b.y * zoom + top;
    }
    return to;
  }

  private moveView(to: Camera, smooth: boolean) {
    if (smooth) this.glideTo(to);
    else {
      this.stopGlide();
      this.setView(to);
    }
  }

  /** The view glides to `to` (zoom eased geometrically, the centre along a line); instantly with reduced motion. */
  private glideTo(to: Camera) {
    this.stopGlide();
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = { ...this.view };
    if (reduce || !(from.zoom > 0) || typeof requestAnimationFrame !== 'function') {
      this.setView(to);
      return;
    }
    const vp = this.viewport();
    const mid = { x: vp.width / 2, y: vp.height / 2 };
    const c0 = screenToBoard(from, mid), c1 = screenToBoard(to, mid);
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / SECTION_GLIDE_MS);
      const e = ease(t);
      const zoom = from.zoom * Math.pow(to.zoom / from.zoom, e);
      const c = { x: c0.x + (c1.x - c0.x) * e, y: c0.y + (c1.y - c0.y) * e };
      this.gliding = true;
      try {
        this.setView(t >= 1 ? to : { x: mid.x - c.x * zoom, y: mid.y - c.y * zoom, zoom });
      } finally {
        this.gliding = false;
      }
      if (t >= 1) {
        this.viewGlide = 0;
        this.scheduleGuide(); // the callout is placed again where the section now is
      } else this.viewGlide = requestAnimationFrame(step);
    };
    this.viewGlide = requestAnimationFrame(step);
  }

  private stopGlide() {
    if (!this.viewGlide) return;
    cancelAnimationFrame(this.viewGlide);
    this.viewGlide = 0;
    this.scheduleGuide();
  }

  /** Show, fill and place the callout, or hide it while a sheet, dialog or menu is open or a piece is in the hand. */
  private syncGuide() {
    const g = this.guideEl;
    const s = this.guide.step;
    const busy = !!(this.moving?.moved || this.rotating || this.twist || this.trayDrag?.active || this.boxSel?.active);
    const show = guideRunning(this.guide) && !this.helpOpen && !this.suggOpen && !this.menuOpen && !busy && !this.introAnims.length && this.boardEl.clientWidth > 0;
    if (!show) {
      if (!g.hidden) g.hidden = true;
      return;
    }
    // While the view glides to a section the callout stays where it is (placed again when the glide ends).
    if (this.viewGlide && !g.hidden && !this.wordFitPending) return;
    const bounds = this.guideBounds();
    const host = this.getBoundingClientRect();
    if (g.hidden) g.hidden = false;
    const prevPos = { left: g.style.left, top: g.style.top, maxWidth: g.style.maxWidth };
    g.style.left = '0px';
    g.style.top = '0px';
    const obstacles = this.guideObstacles();
    // Phones: a narrow callout (at most about 45% of the board in landscape). When a narrower one would cover less of the
    // pieces, it narrows (taller, but clear of them).
    const bw = this.boardEl.getBoundingClientRect().width;
    const widths = this.isLandscape ? [0.45, 0.37, 0.3].map((f) => Math.max(190, Math.round(bw * f))) : this.isCompact ? [Math.round(Math.min(300, bw - 32)), 240] : [0];
    if (this.wordFitPending && this.guide.phase === 'word' && s === 7) {
      // The finished word, framed whole (phones: clear of the docks, the tray and the button block).
      const how = this.wordFitPending;
      this.wordFitPending = false;
      this.fitFinishedWord(bounds, how === 'smooth');
    } else if (this.wordFitPending && s === 6) {
      // Once per batch: frame it (phones: beside the callout by the tray, never under it, nor under the button block).
      const how = this.wordFitPending;
      this.wordFitPending = false;
      if (this.isCompact) this.fitBatch(widths, bounds, obstacles, how === 'smooth');
      else {
        const b = this.tightBounds(this.batchOutlines());
        if (b) this.fitDesktop(b, how === 'smooth');
      }
      this.renderOutlines();
      if (this.viewGlide) {
        Object.assign(g.style, prevPos); // it stays where it was while the view glides; placed again once the glide ends
        return;
      }
    } else if (this.cFitPending && this.guide.phase === 'c' && s >= 1 && s <= 4 && this.isCompact) {
      this.cFitPending = false;
      this.fitC(widths, bounds, obstacles);
      this.renderOutlines();
    } else if (this.wordFitPending && this.guide.phase !== 'word') this.wordFitPending = false;
    if (this.cFitPending && this.guide.phase !== 'c') this.cFitPending = false;
    // The active outlines and the piece being turned toward one must stay in sight: the callout never covers them.
    const st = this.guide;
    const outlineRects = activeOutlines(st).map((i) => this.outlineRect(st.outlines[i]));
    const turnEl = st.turn ? this.els.get(st.turn)?.g.querySelector('.bd') : null;
    // ...and neither may any rotate handle (a single piece's or a selection's, in every step): the visitor needs it to turn
    // what they hold, and the 3b hint asks for it. Its whole 44 px hit box, plus a margin.
    const handles = this.handleRects();
    const hard = [...obstacles, ...outlineRects, ...(turnEl ? [toRect(turnEl.getBoundingClientRect())] : []), ...handles];
    // If no spot clears everything, these still win over the controls and the pieces (placeCallout's last resort).
    const must = [...handles, ...outlineRects];
    // Steps 5 and 7 (centred): keep the finished letter or word in sight where the board allows.
    const done = st.phase === 'ask' ? [...this.els.values()].map((e) => {
      const r = toRect(e.g.querySelector('.bd')!.getBoundingClientRect());
      return { x: r.x - 16, y: r.y - 16, w: r.w + 32, h: r.h + 32 }; // step 0: their pieces stay in sight where the board allows
    }) : st.step === 5 || st.step === 7 ? st.filled.flatMap((id) => {
      const e = id ? this.els.get(id)?.g.querySelector('.bd') : null;
      const r = e ? toRect(e.getBoundingClientRect()) : null;
      return r ? [{ x: r.x - 16, y: r.y - 16, w: r.w + 32, h: r.h + 32 }] : []; // with some air around it
    }) : [];
    // Prefer empty board: every piece's bounds, with a margin of breathing room (people press just beside pieces too),
    // so the callout covers as few as it can.
    const M = 24;
    const pieces = [...[...this.els.values()].map((e) => toRect(e.g.querySelector('.bd')!.getBoundingClientRect())), ...outlineRects]
      .map((r) => ({ x: r.x - M, y: r.y - M, w: r.w + 2 * M, h: r.h + 2 * M }));
    const options = this.guideTargets(bounds);
    let best: { w: number; pick: GuideTarget; p: ReturnType<typeof placeCallout>; n: number; a: number; rank: number } | null = null;
    // Phones in portrait (v1.5.0): one narrower form still, the last resort before covering a control (a rotate handle
    // pushed it out of its room; the strip beside the view group at the top fits it). Placement only: framing never plans for it.
    const NARROW = 180;
    const tryWidths = this.isCompact && !this.isLandscape ? [...widths, NARROW] : widths;
    for (const w of tryWidths) {
      if (w === NARROW && best && best.rank >= 6) break; // only when nothing wider stays clear of every control
      g.toggleAttribute('data-narrow', w === NARROW);
      g.style.maxWidth = w ? `${w}px` : '';
      const size = { w: g.offsetWidth, h: g.offsetHeight };
      let pick = options[options.length - 1];
      let p = placeCallout(size, pick.target, bounds, hard, pick.prefer, [...pick.avoid, ...done], pieces, undefined, must, pick.kind === 'action');
      for (const o of options) {
        // The block's Back / Forward sit side by side: the arrow must be level with the one it means (pointFirst).
        const q = placeCallout(size, o.target, bounds, hard, o.prefer, [...o.avoid, ...done], pieces, undefined, must, o.kind === 'action');
        if (q.side !== 'centre' || !o.target) {
          pick = o;
          p = q;
          break;
        }
      }
      const box = { x: p.x, y: p.y, w: size.w, h: size.h };
      const c = coverage(box, pieces);
      // First never over a handle or an active outline; then clear of every control too; then pointing at its target
      // (a centred last resort does not); then covering the fewest pieces.
      const rank = (must.some((q) => rectsOverlap(box, q)) ? 0 : 4) + (hard.some((q) => rectsOverlap(box, q)) ? 0 : 2) + (pick.target && p.side !== 'centre' ? 1 : 0);
      const better = !best || rank > best.rank || (rank === best.rank && (c.n < best.n || (c.n === best.n && c.a < best.a * 0.8)));
      if (better) best = { w, pick, p, n: c.n, a: c.a, rank };
      if (!c.n && best!.rank >= 6) break; // clear of every piece and obstacle: no need to narrow further
    }
    g.toggleAttribute('data-narrow', best!.w === NARROW);
    g.style.maxWidth = best!.w ? `${best!.w}px` : '';
    const { pick, p } = best!;
    g.dataset.side = p.side;
    // v1.5.0: on phones the button block stands between the callout and the tray. A pointer that would land on a control it
    // is not about (the tray shape behind the block) would seem to point at that control instead: it is hidden (kept in
    // layout, so its nudge still runs). The block's own Back / Forward are its target in step 3, so there it always shows.
    const cw = g.offsetWidth, ch = g.offsetHeight;
    const tip: Rect | null = p.side === 'above' ? { x: p.x + p.arrow - 13, y: p.y + ch + 6, w: 22, h: 13 }
      : p.side === 'below' ? { x: p.x + p.arrow - 13, y: p.y - 19, w: 22, h: 13 }
        : p.side === 'right' ? { x: p.x - 21, y: p.y + p.arrow - 11, w: 13, h: 22 }
          : p.side === 'left' ? { x: p.x + cw + 4, y: p.y + p.arrow - 11, w: 13, h: 22 } : null;
    g.toggleAttribute('data-noarrow', !!tip && pick.kind !== 'action' && obstacles.some((q) => rectsOverlap(tip, q)));
    g.dataset.target = pick.kind;
    if (pick.piece) g.dataset.piece = pick.piece;
    else delete g.dataset.piece;
    if (pick.shape) g.dataset.shape = pick.shape;
    else delete g.dataset.shape;
    if (pick.action) g.dataset.action = pick.action;
    else delete g.dataset.action;
    g.style.setProperty('--ga', `${Math.round(p.arrow)}px`);
    g.style.left = `${Math.round(p.x - host.left)}px`;
    g.style.top = `${Math.round(p.y - host.top)}px`;
    if (this.guideFocusOnShow) {
      this.guideFocusOnShow = false;
      g.querySelector<HTMLElement>('.grow:not([hidden]) button:not([hidden])')?.focus();
    }
  }
}

/** What the callout points at: a rect on screen (null: centred on the board), the sides to try, and what it is. */
interface GuideTarget {
  target: Rect | null;
  avoid: Rect[];
  prefer: Exclude<CalloutSide, 'centre'>[];
  kind: 'tray' | 'handle' | 'piece' | 'board' | 'action';
  piece?: string;
  shape?: string;
  /** kind 'action': which of the block's restack buttons it points at. */
  action?: 'backward' | 'forward';
}

function toRect(r: DOMRect): Rect {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

if (!customElements.get('fridge-face')) customElements.define('fridge-face', FridgeFace);

function sameSnapshot(a: readonly Piece[], b: readonly Piece[]): boolean {
  return a === b || (a.length === b.length && a.every((p, i) => {
    const q = b[i];
    return p === q || (p.id === q.id && p.shapeId === q.shapeId && p.x === q.x && p.y === q.y && p.rotation === q.rotation);
  }));
}
