# Fridgeface

Five shapes. Infinite possibilities.

Fridgeface is a modular typeface built from just five shapes. Black shapes add form, white shapes cut it away. This repo is the interactive version: a board where you place, move, rotate and restack pieces to build words and pictograms.

Design and concept by [Edward Hamel](https://www.edwardbryanthamel.com). The domain glossary is in [CONTEXT.md](CONTEXT.md) and architecture decisions are in [docs/adr/](docs/adr/).

Status: v0.1.0 (first release). Built up over chunks 5 to 10 (chunk 8: letter suggestions, dev-only author mode and the "play" intro; chunk 9: keyboard, screen-reader and mobile hardening; chunk 7: place, select, move, rotate, delete and restack pieces; pan and zoom the infinite board; undo/redo, clear board and auto-save; share link and PNG/SVG export; Fridgeface's visual identity: fridge-door texture, magnet shadows, Jost type).

© Edward Hamel. All rights reserved (`UNLICENSED`), except the bundled typeface below.

### Third-party: Jost

The controls use [Jost](https://github.com/indestructible-type/Jost) (weights 500 and 700, latin subset, from the `@fontsource/jost` package), © 2020 The Jost Project Authors, licensed under the SIL Open Font License 1.1: see [LICENSES/Jost-OFL.txt](LICENSES/Jost-OFL.txt). The two woff2 files are inlined into `dist/fridgeface.js` and registered once on the host document under the family name `Fridgeface Jost`.

## Using it

### In a host site (git dependency)

Install a pinned tag. `npm install` builds `dist/` for you (the `prepare` script runs `vite build`; npm installs the dev dependencies it needs for that), so no prebuilt files live in git.

```sh
npm install "github:ebryant-dev/fridgeface#v0.1.0"
```

or in `package.json`: `"fridgeface": "github:ebryant-dev/fridgeface#v0.1.0"`. Then, in client-side code:

```js
import 'fridgeface'; // registers <fridge-face>
```

```html
<fridge-face share-base="https://example.com/play" no-intro style="width:100%;height:80vh"></fridge-face>
```

- The import touches `customElements` and `HTMLElement`, so run it in the browser only (in Astro: a `<script>` in the page or a client-side island, not frontmatter).
- `share-base`: the page that share links open. Default: the current URL without its hash.
- `no-intro`: skip the first-visit "play" animation.
- Size: the element needs a definite size (see Embedding below). It is `display: block; width: 100%; height: 100%`, so give its parent a height or size it directly.
- Everything (styles, texture, the Jost subset) ships inside the one JS file. Nothing else to load.

### Standalone site

`npm run build:site` builds `index.html` (the toy full screen) into `site-dist/` (gitignored); `npm run preview:site` serves it. `embed.html` and the dev-only author mode are not part of it. `vercel.json` makes it deploy with no dashboard settings: import the repo in Vercel, leave everything as detected (`npm ci`, `npm run build:site`, output `site-dist`). Hashed files under `/assets/` are cached as immutable; `index.html` is always revalidated.

`index.html` carries `<meta name="robots" content="noindex">` for the staging URL. Remove that meta when a real domain is attached.

## Releasing

1. Make sure `npm test`, `npx tsc --noEmit` and `npm run build` pass.
2. Bump `version` in `package.json` (`npm version patch|minor` also commits and tags; or edit by hand), commit, merge to `main`.
3. Tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. In each host, change the pin to `github:ebryant-dev/fridgeface#vX.Y.Z`, run `npm install` (updates the lockfile) and redeploy. The standalone site deploys from `main` with the repo itself.

## Development

Requires Node 22 or newer.

```sh
npm install     # install dependencies
npm run dev     # serve the demo page (index.html) with hot reload
npm test        # run the unit tests (Vitest)
npm run build   # type-check, then build the ES module to dist/fridgeface.js
npm run build:site  # build the standalone site to site-dist/
```

The build defines the `<fridge-face>` custom element (Shadow DOM, styles inside the shadow root).

## Sharing and export

- `getShareUrl()` returns `<share-base>#c=<encoded>`. Set the optional `share-base` attribute to the page that hosts the toy; it defaults to the current URL without its hash. Opening a link applies the composition as one undoable step, frames it, and removes the hash.
- `exportSVG()` returns a standalone SVG string; `exportPNG()` returns a 2x PNG blob (longest side capped at 4096 px). Both come from `src/export.ts`, with the same fridge texture (an embedded data-URL pattern) and magnet shadows as the board.

## Look

- **Fridge texture** (`src/texture.ts`): a seamless tile generated once per page (tileable Worley creases + value noise, embossed), used as an SVG pattern in board space so it pans and zooms with the board.
- **Magnet shadows** (`src/shadow.ts`): no SVG or CSS filters anywhere. Each piece is drawn as [shadow, shape]; the shadow is offset copies of the geometry with round-join strokes of growing width and falling opacity. Sizes are in screen px (counter-scaled on zoom). The piece being dragged, rotated or twisted lifts.

## Letter suggestions

A **suggestion** is one way to build a character. There is never a single correct construction, so a character can have any number of numbered variants, and the panel always says so ("One way to build it. There's no right way — make your own.").

- Each suggestion is one JSON file in `src/suggestions/`, named by character and variant: `lower-a-1.json`, `upper-a-1.json`, `digit-7-1.json`, and `u0021-1.json` (code point in hex) for any other character. The names are safe on case-insensitive filesystems (macOS).
- Format: `{ "v": 1, "char": "a", "variant": 1, "pieces": [{ "s", "x", "y", "r" }, ...], "baseline": 0 }`. Pieces use the composition wire format. Coordinates are relative to an origin ON THE BASELINE at the letter's LEFT edge: the leftmost rotated bound is at x = 0 and y = 0 is the baseline (ascenders have negative y, descenders positive).
- The files are bundled at build time (`import.meta.glob`) and checked with the same strict rules as share links; an invalid file is skipped with a console warning. With no files, the toy looks and works as before: there is no suggestions button and no intro. Files light up automatically as they appear.
- **Panel:** the Letters button in the dock (or the `L` key) opens it. Pick a character, then a variant thumbnail: its pieces are added on top of the board, centred in the current view, as ONE undo step. On phones the panel is a bottom sheet that closes after you place a variant.
- **Word layout** (`layoutWord` in `src/suggestions.ts`) puts constructions left to right on one baseline, each separated by the previous one's rotated bounds plus a gap of 60 board units (about one positive-stem width).
- **"play" intro:** on a first visit only (no auto-saved composition, no share link), and only when `lower-p-1`, `lower-l-1`, `lower-a-1` and `lower-y-1` all exist, the word "play" slides in from the tray in about 1.3 seconds. It is a normal, editable composition, not in undo history, and auto-saved. Any pointer or key input finishes it at once; with reduced motion it just appears. Add the `no-intro` attribute to `<fridge-face>` to switch it off.

### Author workflow (for Edward, no coding needed)

Author mode exists only on the dev server and is not part of any build.

1. In a terminal in this folder: `npm run dev`.
2. Open the address it prints with `?author` on the end, e.g. `http://localhost:5173/?author`.
3. Build the letter with the pieces, standing on the **baseline** (the solid line; the dashed line is the x-height guide, the height of one positive round standing upright, about two thirds of a stem). The small mark on the baseline is the origin. Stand the letter anywhere along the line: saving moves it so its left edge is at x = 0.
4. In the Author mode panel, type the character in **Character**. **Variant** fills in the next free number (change it to make another way to build the same character).
5. Click **Save suggestion**. The file appears in `src/suggestions/` (the page reloads, and your board comes back). If that file exists you are asked to **Replace** it; nothing is overwritten otherwise.
6. To change one, click **Load** beside it in the list (it replaces the board, undoable), edit, Save and choose Replace. **Delete** removes just that file after you confirm.

The new files are ordinary source files: commit them like any other change.

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
| `L` | Show or hide letter suggestions (only when suggestions exist) |
| `?` | Keyboard shortcuts dialog (focus moves in, Tab stays inside, `Esc` closes and returns focus) |
| `Esc` | Closes the innermost open thing first (export menu, clear confirm, share field), then deselects |

Screen readers: the board is `role="application"` with a name and description, and one polite live region announces changes ("Positive stem added. 3 pieces on the board.", "Moved forward. 2 of 4 in stacking order."). Held or repeated keys (rotate, nudge, zoom) and pointer drags are summarised once, when they pause or end. Text comes from `src/announce.ts`.

## Embedding

- Give `<fridge-face>` a definite size (a fixed or percentage height inside a sized parent). It is a size container, so the compact layout (icon controls, small tray; also used for phones in landscape) follows the element's own box, not the window.
- It does not need to be full viewport. `embed.html` (dev only: `npm run dev`, open `/embed.html`) shows a 900 x 600 box in a scrolling page. Wheel, pinch and touch drags that start on the board never scroll the page; the page scrolls normally everywhere else, and keys such as Space, PageDown and arrows are consumed only while the board has focus. Leave room around the element on touch devices: a swipe that starts inside it will not scroll the page.
- `share-base` sets the page that share links open (default: the current URL without its hash). The link is precomputed shortly after every change so Share can write the clipboard synchronously inside the click, which Safari requires; if it is not ready yet, or the clipboard refuses, the selectable link field appears instead.
- On notched phones add `viewport-fit=cover` to the page's viewport meta (as `index.html` does). Safe-area insets are applied only where the element actually touches a screen edge. The view stays centred on the same board point when the element resizes (window resize, rotation, the iOS URL bar).
