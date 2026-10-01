# Fridgeface

Five shapes. Infinite possibilities.

Fridgeface is a modular typeface built from just five shapes. Black shapes add form, white shapes cut it away. This repo is the interactive version: a board where you place, move, rotate and restack pieces to build words and pictograms.

Design and concept by [Edward Hamel](https://www.edwardbryanthamel.com). The domain glossary is in [CONTEXT.md](CONTEXT.md) and architecture decisions are in [docs/adr/](docs/adr/).

Status: early development (chunk 9: keyboard, screen-reader and mobile hardening; chunk 7: place, select, move, rotate, delete and restack pieces; pan and zoom the infinite board; undo/redo, clear board and auto-save; share link and PNG/SVG export; Fridgeface's visual identity: fridge-door texture, magnet shadows, Jost type).

© Edward Hamel. All rights reserved, except the bundled typeface below.

### Third-party: Jost

The controls use [Jost](https://github.com/indestructible-type/Jost) (weights 500 and 700, latin subset, from the `@fontsource/jost` package), © 2020 The Jost Project Authors, licensed under the SIL Open Font License 1.1: see [LICENSES/Jost-OFL.txt](LICENSES/Jost-OFL.txt). The two woff2 files are inlined into `dist/fridgeface.js` and registered once on the host document under the family name `Fridgeface Jost`.

## Development

Requires Node 22 or newer.

```sh
npm install     # install dependencies
npm run dev     # serve the demo page (index.html) with hot reload
npm test        # run the unit tests (Vitest)
npm run build   # type-check, then build the ES module to dist/fridgeface.js
```

The build defines the `<fridge-face>` custom element (Shadow DOM, styles inside the shadow root).

## Sharing and export

- `getShareUrl()` returns `<share-base>#c=<encoded>`. Set the optional `share-base` attribute to the page that hosts the toy; it defaults to the current URL without its hash. Opening a link applies the composition as one undoable step, frames it, and removes the hash.
- `exportSVG()` returns a standalone SVG string; `exportPNG()` returns a 2x PNG blob (longest side capped at 4096 px). Both come from `src/export.ts`, with the same fridge texture (an embedded data-URL pattern) and magnet shadows as the board.

## Look

- **Fridge texture** (`src/texture.ts`): a seamless tile generated once per page (tileable Worley creases + value noise, embossed), used as an SVG pattern in board space so it pans and zooms with the board.
- **Magnet shadows** (`src/shadow.ts`): no SVG or CSS filters anywhere. Each piece is drawn as [shadow, shape]; the shadow is offset copies of the geometry with round-join strokes of growing width and falling opacity. Sizes are in screen px (counter-scaled on zoom). The piece being dragged, rotated or twisted lifts.

## Keyboard

The board is one Tab stop; Tab and Shift+Tab always leave it. Shortcuts work while focus is anywhere inside the element (not in the share field), and `?` opens the in-app list.

| Keys | Action |
| --- | --- |
| `1`-`5` | Add a piece (tray order: positive stem, positive round, negative stem, negative round, wedge) |
| `N` / `P` | Select the next / previous piece in the stacking order (wraps; pans if it is off screen) |
| Arrows, `Shift`+Arrows | Move the selected piece 1 / 10 units. With nothing selected they pan the board |
| `Alt`+Arrows | Pan the board (`Shift` for bigger steps), even with a piece selected |
| `,` / `.` | Rotate 1 degree anticlockwise / clockwise. `Shift` + them: one 15 degree step |
| `S` | Snap on / off |
| `]` / `[` | Bring forward / send backward |
| `Delete`, `Backspace` | Delete the piece |
| `+` / `-`, `F` or `Shift`+`1` | Zoom, frame all pieces |
| `Space` + drag | Pan with the pointer |
| `Ctrl`/`Cmd`+`Z`, `Ctrl`+`Shift`+`Z` or `Ctrl`+`Y` | Undo, redo |
| `C`, `E` | Copy the share link, open the export menu |
| `?` | Keyboard shortcuts dialog (focus moves in, Tab stays inside, `Esc` closes and returns focus) |
| `Esc` | Closes the innermost open thing first (export menu, clear confirm, share field), then deselects |

Screen readers: the board is `role="application"` with a name and description, and one polite live region announces changes ("Positive stem added. 3 pieces on the board.", "Moved forward. 2 of 4 in stacking order."). Held or repeated keys (rotate, nudge, zoom) and pointer drags are summarised once, when they pause or end. Text comes from `src/announce.ts`.

## Embedding

- Give `<fridge-face>` a definite size (a fixed or percentage height inside a sized parent). It is a size container, so the compact layout (icon controls, small tray; also used for phones in landscape) follows the element's own box, not the window.
- It does not need to be full viewport. `embed.html` (dev only: `npm run dev`, open `/embed.html`) shows a 900 x 600 box in a scrolling page. Wheel, pinch and touch drags that start on the board never scroll the page; the page scrolls normally everywhere else, and keys such as Space, PageDown and arrows are consumed only while the board has focus. Leave room around the element on touch devices: a swipe that starts inside it will not scroll the page.
- `share-base` sets the page that share links open (default: the current URL without its hash). The link is precomputed shortly after every change so Share can write the clipboard synchronously inside the click, which Safari requires; if it is not ready yet, or the clipboard refuses, the selectable link field appears instead.
- On notched phones add `viewport-fit=cover` to the page's viewport meta (as `index.html` does). Safe-area insets are applied only where the element actually touches a screen edge. The view stays centred on the same board point when the element resizes (window resize, rotation, the iOS URL bar).
