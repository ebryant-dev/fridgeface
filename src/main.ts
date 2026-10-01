import { SHAPES, type Shape } from './shapes';
import { Composition, type Piece } from './composition';
import { fromUpright, normalise, rotationFor, snapNearest, snapTowardUpright, stepFromUpright } from './rotation';

const PAD = 4; // source units of padding around each tray shape's bounding box
const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 6; // px of pointer travel before a tray press becomes a drag
const HANDLE_GAP = 40; // CSS px between a piece's top edge and the rotate handle's centre
const HANDLE_HIT = 44; // CSS px, touch target diameter
const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

const STYLES = `
:host {
  --k: 0.3; /* scale: CSS px per source unit (= board unit), shared by tray and board */
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  contain: layout paint;
}
.root { display: flex; flex-direction: column; width: 100%; height: 100%; }
.board { position: relative; flex: 1 1 auto; min-height: 0; background: #bdbdbd; }
.board svg.surface { display: block; width: 100%; height: 100%; touch-action: none; outline: none; user-select: none; -webkit-user-select: none; }
.board svg.surface [data-piece-id] { cursor: grab; }
.actions {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  display: flex; flex-wrap: wrap; justify-content: center; max-width: calc(100% - 16px); box-sizing: border-box; gap: 6px; padding: 6px; background: #fff; border: 2px solid #000; border-radius: 10px;
}
.actions button[aria-pressed="true"] { background: #000; color: #fff; }
.actions[hidden] { display: none; }
.actions button {
  font: 600 14px/1 system-ui, sans-serif; min-width: 44px; min-height: 44px; padding: 0 12px;
  background: #fff; color: #000; border: 2px solid #000; border-radius: 6px; cursor: pointer;
}
.actions button:disabled { opacity: 0.35; cursor: default; }
.actions button:focus-visible { outline: 3px solid #0a84ff; outline-offset: 2px; }
.tray {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: center;
  gap: 12px 20px;
  padding: 14px 16px calc(14px + env(safe-area-inset-bottom, 0px));
  background: #8a8a8a;
  box-sizing: border-box;
}
.tray button {
  all: unset;
  box-sizing: content-box;
  cursor: grab;
  line-height: 0;
  border-radius: 6px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  width: calc(var(--w) * var(--k) * 1px);
  height: calc(var(--h) * var(--k) * 1px);
}
.tray button:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
.tray svg { display: block; width: 100%; height: 100%; overflow: visible; }
.preview { position: fixed; z-index: 10; pointer-events: none; line-height: 0; opacity: 0.85; }
.preview svg { display: block; width: 100%; height: 100%; overflow: visible; }
@media (max-width: 600px) { :host { --k: 0.17; } .tray { gap: 10px 14px; padding-inline: 10px; } }
`;

function geometryHtml(s: Shape): string {
  return s.geometry.kind === 'polygon'
    ? `<polygon points="${s.geometry.points}" fill="${s.fill}"/>`
    : `<path d="${s.geometry.d}" fill="${s.fill}"/>`;
}

function shapeSvg(s: Shape): string {
  const { x, y, w, h } = s.bbox;
  return `<svg viewBox="${x - PAD} ${y - PAD} ${w + 2 * PAD} ${h + 2 * PAD}" aria-hidden="true" focusable="false">${geometryHtml(s)}</svg>`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Puts the shape's centroid at the piece's (x, y), then rotates about that centroid. */
function pieceTransform(p: Piece, s: Shape): string {
  return `translate(${p.x - s.centroid.x} ${p.y - s.centroid.y}) rotate(${p.rotation} ${s.centroid.x} ${s.centroid.y})`;
}

export class FridgeFace extends HTMLElement {
  readonly composition = new Composition();

  private surface!: SVGSVGElement;
  private camera!: SVGGElement;
  private piecesLayer!: SVGGElement;
  private overlay!: SVGGElement;
  private actions!: HTMLElement;
  private boardEl!: HTMLElement;
  private trayEl!: HTMLElement;
  private els = new Map<string, SVGGElement>();
  private selectedId: string | null = null;
  private snap = false;
  private touches = new Map<number, { x: number; y: number }>();
  private rotating: { pointerId: number; id: string; grab: number; startRot: number } | null = null;
  private twist: { id: string; lastAngle: number; accum: number; startRot: number; startPos: { x: number; y: number }; startMid: { x: number; y: number } } | null = null;

  private moving: { pointerId: number; id: string; startPt: { x: number; y: number }; startX: number; startY: number } | null = null;
  private trayDrag: { pointerId: number; shape: Shape; startX: number; startY: number; active: boolean; preview?: HTMLElement } | null = null;
  private suppressClick = false;

  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    const wrap = document.createElement('div');
    wrap.className = 'root';
    wrap.innerHTML = `
      <div class="board" part="board">
        <svg class="surface" tabindex="0" role="application" aria-label="Board">
          <g data-camera transform="matrix(1 0 0 1 0 0)"><g data-pieces></g><g data-overlay></g></g>
        </svg>
        <div class="actions" role="toolbar" aria-label="Piece actions" hidden>
          <button type="button" data-action="delete" aria-label="Delete piece">Delete</button>
          <button type="button" data-action="rotate-left" aria-label="Rotate left 15°">&#8630; 15°</button>
          <button type="button" data-action="rotate-right" aria-label="Rotate right 15°">15° &#8631;</button>
          <button type="button" data-action="snap" aria-pressed="false">Snap 15°</button>
          <button type="button" data-action="forward" aria-label="Bring forward">Forward</button>
          <button type="button" data-action="backward" aria-label="Send backward">Back</button>
        </div>
      </div>
      <div class="tray" part="tray" role="group" aria-label="Shapes"></div>`;
    this.boardEl = wrap.querySelector('.board')!;
    this.trayEl = wrap.querySelector('.tray')!;
    this.surface = wrap.querySelector('svg.surface')!;
    this.camera = wrap.querySelector('[data-camera]')!;
    this.piecesLayer = wrap.querySelector('[data-pieces]')!;
    this.overlay = wrap.querySelector('[data-overlay]')!;
    this.actions = wrap.querySelector('.actions')!;

    for (const s of SHAPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.shape = s.id;
      b.setAttribute('aria-label', s.name);
      b.style.setProperty('--w', String(s.bbox.w + 2 * PAD));
      b.style.setProperty('--h', String(s.bbox.h + 2 * PAD));
      b.innerHTML = shapeSvg(s);
      this.trayEl.appendChild(b);
    }
    root.append(style, wrap);

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
    });
    this.addEventListener('keydown', (e) => this.onKey(e));

    this.composition.onChange(() => this.render());
    new ResizeObserver(() => { this.syncViewBox(); this.render(); }).observe(this.boardEl);
    this.syncViewBox();
    this.render();
  }

  // ---- geometry helpers -------------------------------------------------

  private get k(): number {
    return parseFloat(getComputedStyle(this).getPropertyValue('--k')) || 0.3;
  }

  /** Board units are `k` CSS px: size the viewBox to the board's pixel size divided by k. */
  private syncViewBox() {
    const r = this.boardEl.getBoundingClientRect();
    const k = this.k;
    if (!r.width || !r.height) return;
    this.surface.setAttribute('viewBox', `0 0 ${r.width / k} ${r.height / k}`);
  }

  /** Client (screen) point -> board units, through the camera transform. */
  private toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const m = this.camera.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  }

  private overBoard(clientX: number, clientY: number): boolean {
    const r = this.boardEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  // ---- adding pieces ----------------------------------------------------

  private addAt(shape: Shape, x: number, y: number) {
    const p = this.composition.addPiece(shape.id, x, y);
    this.select(p.id);
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
      prev.style.width = `${(s.bbox.w + 2 * PAD) * this.k}px`;
      prev.style.height = `${(s.bbox.h + 2 * PAD) * this.k}px`;
      prev.innerHTML = shapeSvg(s);
      this.shadowRoot!.appendChild(prev);
      d.preview = prev;
    }
    // Keep the shape's centroid under the pointer, matching where the piece will land.
    const s = d.shape;
    const k = this.k;
    d.preview!.style.left = `${e.clientX - (s.centroid.x - (s.bbox.x - PAD)) * k}px`;
    d.preview!.style.top = `${e.clientY - (s.centroid.y - (s.bbox.y - PAD)) * k}px`;
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

  private onBoardDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        if (this.touches.size === 2 && !this.twist && this.selectedId) this.startTwist(e);
        return; // extra fingers never select or move anything
      }
    }
    const handle = (e.target as Element).closest?.('[data-handle]');
    const sel = this.selectedId ? this.composition.getPiece(this.selectedId) : undefined;
    if (handle && sel) {
      const pt = this.toBoard(e.clientX, e.clientY);
      this.rotating = { pointerId: e.pointerId, id: sel.id, grab: this.angleTo(sel, pt), startRot: sel.rotation };
      this.surface.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const id = (e.target as Element).closest?.('[data-piece-id]')?.getAttribute('data-piece-id') ?? null;
    if (!id) {
      this.select(null);
      return;
    }
    const piece = this.composition.getPiece(id);
    if (!piece) return;
    this.select(id); // selecting never changes stacking order
    this.moving = { pointerId: e.pointerId, id, startPt: this.toBoard(e.clientX, e.clientY), startX: piece.x, startY: piece.y };
    this.surface.setPointerCapture(e.pointerId);
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
  }

  private onBoardMove(e: PointerEvent) {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    this.composition.movePiece(m.id, m.startX + (pt.x - m.startPt.x), m.startY + (pt.y - m.startPt.y));
  }

  private onBoardUp(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    if (this.twist && this.touches.size < 2) this.twist = null; // ends cleanly; the remaining finger does nothing
    if (this.moving && this.moving.pointerId === e.pointerId) this.moving = null;
    if (this.rotating && this.rotating.pointerId === e.pointerId) this.rotating = null;
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
    if (p) {
      const off = this.offsetOf(p);
      this.composition.setRotation(p.id, rotationFor(off, snapTowardUpright(fromUpright(off, p.rotation))));
    }
    this.render();
  }

  private runAction(act: string, id: string) {
    if (act === 'rotate-left') this.stepRotate(id, -1);
    else if (act === 'rotate-right') this.stepRotate(id, 1);
    else if (act === 'snap') this.setSnap(!this.snap);
    else if (act === 'delete') this.composition.deletePiece(id);
    else if (act === 'forward') this.composition.bringForward(id);
    else if (act === 'backward') this.composition.sendBackward(id);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (this.selectedId) {
        this.select(null);
        e.preventDefault();
      }
      return;
    }
    const id = this.selectedId;
    if (!id || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? 10 : 1;
    const piece = this.composition.getPiece(id);
    if (!piece) return;
    // Shift+, and Shift+. produce < and > on US layouts, so match on the physical key too.
    const rot = e.code === 'Period' || e.key === '.' || e.key === '>' ? 1 : e.code === 'Comma' || e.key === ',' || e.key === '<' ? -1 : 0;
    if (rot) {
      if (e.shiftKey) this.stepRotate(id, rot as 1 | -1);
      else this.composition.rotatePiece(id, rot);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Delete':
      case 'Backspace': this.runAction('delete', id); break;
      case ']': this.runAction('forward', id); break;
      case '[': this.runAction('backward', id); break;
      case 'ArrowLeft': this.composition.movePiece(id, piece.x - step, piece.y); break;
      case 'ArrowRight': this.composition.movePiece(id, piece.x + step, piece.y); break;
      case 'ArrowUp': this.composition.movePiece(id, piece.x, piece.y - step); break;
      case 'ArrowDown': this.composition.movePiece(id, piece.x, piece.y + step); break;
      default: return;
    }
    e.preventDefault();
  }

  // ---- rendering ----------------------------------------------------------

  private render() {
    const pieces = this.composition.pieces;
    if (this.selectedId && !this.composition.getPiece(this.selectedId)) this.selectedId = null;

    const live = new Set(pieces.map((p) => p.id));
    for (const [id, el] of this.els) {
      if (!live.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    // Reconcile in stacking order (first = bottom). Elements are kept stable so pointer capture survives.
    let expected: ChildNode | null = this.piecesLayer.firstChild;
    for (const p of pieces) {
      const s = SHAPE_BY_ID.get(p.shapeId)!;
      let el = this.els.get(p.id);
      if (!el) {
        el = svgEl('g', { 'data-piece-id': p.id, 'data-shape': p.shapeId });
        el.innerHTML = geometryHtml(s);
        this.els.set(p.id, el);
      }
      el.setAttribute('transform', pieceTransform(p, s));
      if (el !== expected) this.piecesLayer.insertBefore(el, expected);
      else expected = el.nextSibling;
    }

    // Selection indicator: a separate overlay above every piece.
    this.overlay.replaceChildren();
    const sel = this.selectedId ? this.composition.getPiece(this.selectedId) : undefined;
    if (sel) {
      const s = SHAPE_BY_ID.get(sel.shapeId)!;
      const k = this.k;
      const top = s.bbox.y - s.centroid.y; // top edge, in the piece's own frame (centroid at origin)
      const hy = top - HANDLE_GAP / k;
      const g = svgEl('g', { transform: `translate(${sel.x} ${sel.y}) rotate(${sel.rotation})` });
      g.append(
        svgEl('rect', {
          x: String(s.bbox.x - s.centroid.x),
          y: String(top),
          width: String(s.bbox.w),
          height: String(s.bbox.h),
          fill: 'none',
          stroke: '#0a84ff',
          'stroke-width': '2',
          'stroke-dasharray': '6 4',
          'vector-effect': 'non-scaling-stroke',
          'pointer-events': 'none',
        }),
        svgEl('line', {
          x1: '0', y1: String(top), x2: '0', y2: String(hy),
          stroke: '#0a84ff', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none',
        }),
      );
      const h = svgEl('g', { 'data-handle': '', style: 'cursor: grab' });
      h.append(
        svgEl('circle', { cx: '0', cy: String(hy), r: String(HANDLE_HIT / 2 / k), fill: 'transparent' }),
        svgEl('circle', { cx: '0', cy: String(hy), r: String(8 / k), fill: '#fff', stroke: '#0a84ff', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }),
      );
      g.append(h);
      this.overlay.appendChild(g);
    }

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
