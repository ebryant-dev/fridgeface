/**
 * Which layout the element gets for its own size (pure, no DOM). The component sets the result as `data-compact` and
 * `data-short` attributes on its shadow root's top elements, from a ResizeObserver on the host.
 */

/** The compact layout (icon controls, small tray) applies when the element is at most this wide, CSS px... */
export const COMPACT_MAX_W = 600;
/** ...or at most this tall. At most this tall is also "short" (phones in landscape get a thinner tray). */
export const COMPACT_MAX_H = 520;

export function layoutState(width: number, height: number): { compact: boolean; short: boolean } {
  const short = height <= COMPACT_MAX_H;
  return { compact: short || width <= COMPACT_MAX_W, short };
}
