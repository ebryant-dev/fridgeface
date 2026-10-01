import jost500 from '@fontsource/jost/files/jost-latin-500-normal.woff2?url';
import jost700 from '@fontsource/jost/files/jost-latin-700-normal.woff2?url';

/**
 * Jost (SIL Open Font License 1.1, see LICENSES/Jost-OFL.txt), self-hosted and bundled with the build
 * (library mode inlines the two latin woff2 files). `@font-face` inside a shadow root is unreliable,
 * so the face is registered on the DOCUMENT once, under a namespaced family the host page won't
 * collide with, and used from inside the shadow root by name.
 */
export const FONT_FAMILY = 'Fridgeface Jost';
export const FONT_STACK = `"${FONT_FAMILY}", "Futura", "Century Gothic", sans-serif`;

let registered = false;

export function registerFont(): void {
  if (registered || typeof FontFace !== 'function' || !document.fonts) return;
  registered = true;
  for (const [src, weight] of [[jost500, '500'], [jost700, '700']] as const) {
    const face = new FontFace(FONT_FAMILY, `url("${src}") format("woff2")`, { weight, style: 'normal', display: 'swap' });
    document.fonts.add(face);
    face.load().catch(() => {
      /* offline or blocked: the fallback stack takes over */
    });
  }
}
