/**
 * Flat, geometric inline-SVG icons for the controls on narrow screens (24x24, stroked in currentColor).
 * Purely decorative: every button keeps its aria-label.
 */
const P = (d: string) => `<path d="${d}"/>`;

const ICONS: Record<string, string> = {
  delete: P('M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6'),
  forward: '<rect x="9" y="3" width="12" height="12" fill="currentColor" stroke="none"/>' + P('M3 9v12h12'),
  backward: '<rect x="9" y="3" width="12" height="12"/>' + '<rect x="3" y="9" width="12" height="12" fill="currentColor" stroke="none"/>',
  undo: P('M9 5L4 10l5 5') + P('M4 10h10a5 5 0 0 1 0 10h-4'),
  redo: P('M15 5l5 5-5 5') + P('M20 10H10a5 5 0 0 0 0 10h4'),
  clear: '<rect x="3" y="3" width="18" height="18"/>' + P('M8 8l8 8M16 8l-8 8'),
  share: P('M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1') + P('M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1'),
  export: P('M12 3v12M7 10l5 5 5-5M4 20h16'),
  'zoom-out': P('M5 12h14'),
  'zoom-in': P('M5 12h14M12 5v14'),
  fit: P('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'),
  close: P('M6 6l12 12M18 6L6 18'),
  // Lowercase "abc": a single-storey a (bowl + stem), b (ascender + bowl), an open c. Same 2-unit stroke, round bowls.
  letters: '<circle cx="3.75" cy="15.5" r="2.75"/>' + P('M6.5 12.75V18.25') + P('M10 5V18.25') + '<circle cx="12.75" cy="15.5" r="2.75"/>' + P('M22.2 13.55A2.75 2.75 0 1 0 22.2 17.45'),
  menu: P('M4 6h16M4 12h16M4 18h16'),
  help: P('M8 9a4 4 0 1 1 6 3.5c-1.5 1-2 1.5-2 3') + P('M12 19v2'),
};

export function icon(name: string): string {
  return `<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}
