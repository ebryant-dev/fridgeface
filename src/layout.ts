/**
 * Which layout the element gets for its own size (pure, no DOM). The component sets the result as `data-compact`,
 * `data-short` and `data-landscape` attributes on its shadow root's top elements, from a ResizeObserver on the host.
 */

/** The compact layout (icon controls, small tray) applies when the element is at most this wide, CSS px... */
export const COMPACT_MAX_W = 600;
/** ...or at most this tall. At most this tall is also "short". */
export const COMPACT_MAX_H = 520;

/**
 * - compact: narrow OR short (phones in either orientation).
 * - short: at most COMPACT_MAX_H tall.
 * - landscape (landscape compact): short AND strictly wider than tall. The tray docks vertically along the LEFT edge
 *   and the board takes the rest, to its right (phones in landscape). A short element that is not wider than tall keeps
 *   the bottom tray.
 */
export function layoutState(width: number, height: number): { compact: boolean; short: boolean; landscape: boolean } {
  const short = height <= COMPACT_MAX_H;
  return { compact: short || width <= COMPACT_MAX_W, short, landscape: short && width > height };
}

/**
 * Landscape compact: the tray scale (CSS px per source unit) that fits a column of shapes, `total` source units tall
 * altogether, into `avail` CSS px with `gaps` px of minimum spacing; never larger than `max` (the compact tray scale).
 */
export function columnTrayScale(avail: number, total: number, gaps: number, max: number): number {
  if (!(total > 0)) return max;
  return Math.max(0.05, Math.min(max, (avail - gaps) / total));
}
