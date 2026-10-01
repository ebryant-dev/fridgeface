import { SHAPES, type Shape } from './shapes';

const PAD = 4; // source units of padding around each tray shape's bounding box

const STYLES = `
:host {
  --k: 0.3; /* tray scale: CSS px per source unit, shared by all five shapes */
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  contain: layout paint;
}
.root { display: flex; flex-direction: column; width: 100%; height: 100%; }
.board { flex: 1 1 auto; min-height: 0; background: #bdbdbd; }
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
  cursor: pointer;
  line-height: 0;
  border-radius: 6px;
  width: calc(var(--w) * var(--k) * 1px);
  height: calc(var(--h) * var(--k) * 1px);
}
.tray button:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
.tray svg { display: block; width: 100%; height: 100%; overflow: visible; }
@media (max-width: 600px) { :host { --k: 0.17; } .tray { gap: 10px 14px; padding-inline: 10px; } }
`;

function shapeSvg(s: Shape): string {
  const { x, y, w, h } = s.bbox;
  const g =
    s.geometry.kind === 'polygon'
      ? `<polygon points="${s.geometry.points}" fill="${s.fill}"/>`
      : `<path d="${s.geometry.d}" fill="${s.fill}"/>`;
  return `<svg viewBox="${x - PAD} ${y - PAD} ${w + 2 * PAD} ${h + 2 * PAD}" aria-hidden="true" focusable="false">${g}</svg>`;
}

export class FridgeFace extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    const wrap = document.createElement('div');
    wrap.className = 'root';
    wrap.innerHTML = '<div class="board" part="board"></div><div class="tray" part="tray" role="group" aria-label="Shapes"></div>';
    const tray = wrap.querySelector('.tray')!;
    for (const s of SHAPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.shape = s.id;
      b.setAttribute('aria-label', s.name);
      b.style.setProperty('--w', String(s.bbox.w + 2 * PAD));
      b.style.setProperty('--h', String(s.bbox.h + 2 * PAD));
      b.innerHTML = shapeSvg(s);
      tray.appendChild(b);
    }
    root.append(style, wrap);
  }
}

if (!customElements.get('fridge-face')) customElements.define('fridge-face', FridgeFace);
