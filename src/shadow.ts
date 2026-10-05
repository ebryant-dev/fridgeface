/**
 * Soft magnet shadows WITHOUT SVG filters (WebKit re-runs filters on the CPU every frame).
 *
 * A shadow is a few copies of the shape's geometry, offset down-right: one filled "core" plus
 * round-join strokes of increasing width and decreasing opacity. Their overlap gives a soft,
 * roughly linear falloff like the reference. Each stroke is pushed less than its own half-width, so
 * its inner half stays (almost entirely) under the shape and the core: no darker rim shows outside it.
 *
 * The numbers below are in "shadow px": the shadow's size on screen at the REFERENCE view, the default desktop zoom
 * (0.4 CSS px per board unit). The shadow is a BOARD-space property, like a real magnet's: SHADOW_BOARD_SCALE board units
 * per shadow px, so it grows and shrinks with the pieces as the view zooms, within a clamp (`shadowFactor`): never more than
 * SHADOW_MAX x the reference size on screen (no giant blur zoomed far in), never less than SHADOW_MIN x (zoomed far out a
 * faint ~1 px contact edge stays, so the white shapes still read on the fridge). On screen they are multiplied by `--px`
 * (`shadowUnit`: board units per shadow px, set when the zoom changes, never per frame). Exports use the reference scale.
 */
export interface ShadowSpec {
  dx: number;
  dy: number;
  /** Fill opacity of the offset core copy. */
  core: number;
  /**
   * [stroke width, stroke opacity] per soft layer. Each layer is also pushed further along the shadow
   * direction by SPREAD x half its width, like a penumbra growing with distance, so the soft edge falls
   * down-right instead of glowing evenly all round.
   */
  layers: readonly (readonly [number, number])[];
}

/** Fraction of a layer's half-width it is pushed along the shadow direction (< 1 keeps the no-rim rule). */
export const SPREAD = 0.7;

/** Resting magnet: short, soft, down-right. Profile fitted to the reference diagrams. */
export const REST_SHADOW: ShadowSpec = { dx: 1.2, dy: 1.8, core: 0.22, layers: [[5, 0.18], [10, 0.115], [16, 0.075], [22, 0.05]] };
/** Lifted (being dragged / rotated / twisted): further and softer. */
export const LIFT_SHADOW: ShadowSpec = { dx: 3.5, dy: 5.5, core: 0.15, layers: [[12, 0.13], [22, 0.09], [32, 0.06], [44, 0.04]] };
/**
 * Each soft layer is split in this many on screen (8 strokes + 1 core): 4 steps band visibly on
 * high-DPR screens. Exports split further (see subdivide).
 */
export const SCREEN_SPLIT = 2;
/** How far a lifted piece shifts up-left, shadow px (it scales with the shadow). */
export const LIFT_SHIFT = 1.5;
export const LIFT_MS = 140;

/** Board units per shadow px: the reference view is 1 / this = 0.4 CSS px per board unit (the default desktop zoom). Exports use it. */
export const SHADOW_BOARD_SCALE = 2.5;
/** The shadow's on-screen size, as a multiple of its reference size, is clamped to [SHADOW_MIN, SHADOW_MAX]. */
export const SHADOW_MIN = 0.45; // zoomed far out: the resting offset stays ~1 px (0.45 x 2.16 px), a faint contact edge
export const SHADOW_MAX = 1.5; // zoomed far in: at most the default-zoom shadow x 1.5

/**
 * How big the shadow is on screen at `pxPerUnit` CSS px per board unit (the board scale times the zoom), as a multiple of
 * its reference size: proportional to the pieces (1 at the reference view), clamped to [SHADOW_MIN, SHADOW_MAX].
 */
export function shadowFactor(pxPerUnit: number): number {
  if (!(pxPerUnit > 0)) return 1;
  return Math.min(SHADOW_MAX, Math.max(SHADOW_MIN, pxPerUnit * SHADOW_BOARD_SCALE));
}

/** The value of `--px` on the board: board units per shadow px at `pxPerUnit` CSS px per board unit. */
export function shadowUnit(pxPerUnit: number): number {
  return pxPerUnit > 0 ? shadowFactor(pxPerUnit) / pxPerUnit : SHADOW_BOARD_SCALE;
}

/**
 * The resting shadow's reach on screen at `pxPerUnit`, CSS px: its offset, and how far its soft edge reaches past the
 * shape along the shadow direction (offset plus the widest layer's half-width and push).
 */
export function shadowReach(pxPerUnit: number, s: ShadowSpec = REST_SHADOW): { offset: number; extent: number } {
  const m = shadowFactor(pxPerUnit);
  const w = Math.max(...s.layers.map(([lw]) => lw));
  const offset = Math.hypot(s.dx, s.dy);
  return { offset: offset * m, extent: (offset + (w / 2) * (1 + SPREAD)) * m };
}

const f = (n: number) => String(Math.round(n * 1000) / 1000);

/** Unit shadow direction (down-right, a little more down than right). */
function dir(s: ShadowSpec): [number, number] {
  const l = Math.hypot(s.dx, s.dy) || 1;
  return [s.dx / l, s.dy / l];
}

/** A layer's extra push along the shadow direction, shadow px. */
export function layerPush(s: ShadowSpec, width: number): [number, number] {
  const [ux, uy] = dir(s);
  return [ux * SPREAD * (width / 2), uy * SPREAD * (width / 2)];
}

/**
 * On-screen shadow layers for one geometry element. Each layer is a wrapper `<g class="lN">` (styled by
 * CSS, offset in screen directions) around a `<g data-rot>` that takes the piece's rotation. `geom` is
 * the geometry tag with an `{a}` placeholder for attributes, e.g. `<path d="..." {a}/>`; `rot` is the
 * initial rotation transform (empty for a shape at rest).
 */
export function shadowLayersMarkup(geom: string, rot = ''): string {
  const inner = `<g data-rot${rot ? ` transform="${rot}"` : ''}>${geom.replace('{a}', '')}</g>`;
  let out = '';
  for (let i = 0; i <= REST_SHADOW.layers.length * SCREEN_SPLIT; i++) out += `<g class="l${i}">${inner}</g>`;
  return out;
}

/** CSS for on-screen shadows: classes on `.sh` groups; `.lifted` switches spec; `.anim` adds a transition. */
export function shadowCss(): string {
  const rules: string[] = [];
  const rule = (sel: string, s: ShadowSpec) => {
    rules.push(`${sel} .sh { transform: translate(calc(${s.dx} * var(--px)), calc(${s.dy} * var(--px))); }`);
    rules.push(`${sel} .sh .l0 { fill-opacity: ${s.core}; }`);
    s.layers.forEach(([w, a], i) => {
      const [px, py] = layerPush(s, w);
      rules.push(
        `${sel} .sh .l${i + 1} { stroke-width: calc(${w} * var(--px)); stroke-opacity: ${a}; transform: translate(calc(${f(px)} * var(--px)), calc(${f(py)} * var(--px))); }`,
      );
    });
  };
  rules.push(`.sh { pointer-events: none; }`);
  rules.push(`.sh .l0 { fill: #000; stroke: none; }`);
  rules.push(`.sh > g:not(.l0) { fill: none; stroke: #000; stroke-linejoin: round; }`);
  rule('', subdivide(REST_SHADOW, SCREEN_SPLIT));
  rule('.lifted', subdivide(LIFT_SHADOW, SCREEN_SPLIT));
  rules.push(`.lifted .bd { transform: translate(calc(${-LIFT_SHIFT} * var(--px)), calc(${-LIFT_SHIFT} * var(--px))); }`);
  rules.push(
    `.anim .sh, .anim .bd, .anim .sh > g { transition: transform ${LIFT_MS}ms ease-out, stroke-width ${LIFT_MS}ms ease-out, stroke-opacity ${LIFT_MS}ms ease-out, fill-opacity ${LIFT_MS}ms ease-out; }`,
  );
  rules.push(`@media (prefers-reduced-motion: reduce) { .anim .sh, .anim .bd, .anim .sh > g { transition: none; } }`);
  return rules.join('\n');
}

/**
 * The same shadow with each soft layer split into `k` (widths stepping evenly up from the next smaller
 * layer, each with 1/k of the optical density). Coverage inside every original band is unchanged, but
 * each step is k times smaller: smooth at export resolution, where four steps would band.
 */
export function subdivide(s: ShadowSpec, k = 4): ShadowSpec {
  const layers: [number, number][] = [];
  let prev = s.layers[0][0] * 0.4;
  for (const [w, a] of s.layers) {
    const part = 1 - Math.pow(1 - a, 1 / k);
    for (let i = 1; i <= k; i++) layers.push([prev + ((w - prev) * i) / k, part]);
    prev = w;
  }
  return { ...s, layers };
}

/** Static shadow markup for exports: explicit attributes, `scale` user units per screen px. */
export function staticShadowMarkup(geom: string, scale: number, s: ShadowSpec = subdivide(REST_SHADOW)): string {
  let out = `<g transform="translate(${f(s.dx * scale)} ${f(s.dy * scale)})">`;
  out += geom.replace('{a}', `fill="#000" fill-opacity="${s.core}"`);
  for (const [w, a] of s.layers) {
    const [px, py] = layerPush(s, w);
    out +=
      `<g transform="translate(${f(px * scale)} ${f(py * scale)})">` +
      geom.replace('{a}', `fill="none" stroke="#000" stroke-opacity="${a}" stroke-width="${f(w * scale)}" stroke-linejoin="round"`) +
      `</g>`;
  }
  return out + '</g>';
}
