# Fridgeface

Five shapes. Infinite possibilities.

Fridgeface is a modular typeface built from just five shapes. Black shapes add form, white shapes cut it away. This repo is the interactive version: a board where you place, move, rotate and restack pieces to build words and pictograms.

Design and concept by [Edward Hamel](https://www.edwardbryanthamel.com). The domain glossary is in [CONTEXT.md](CONTEXT.md) and architecture decisions are in [docs/adr/](docs/adr/).

Status: early development (chunk 7: place, select, move, rotate, delete and restack pieces; pan and zoom the infinite board; undo/redo, clear board and auto-save; share link and PNG/SVG export; Fridgeface's visual identity: fridge-door texture, magnet shadows, Jost type).

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
