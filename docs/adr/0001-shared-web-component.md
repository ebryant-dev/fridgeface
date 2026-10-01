# Ship the toy as one web component consumed by both the portfolio and the standalone site

Fridgeface has to live in two places: inside the portfolio, on its own route (`/work/fridgeface/play`), and later on a dedicated Fridgeface site. We build it once in this repo as a self-contained custom element (`<fridge-face>`, Shadow DOM, its own styles and assets). Each host installs the built package from this public repo as a git dependency and mounts the element. We chose this over embedding the standalone site in an iframe, which would have kept the two codebases independent. An iframe would have made the portfolio depend on the standalone site already existing and being deployed. It also makes full-screen layout, touch gestures and history/back behaviour clumsy across the frame boundary, and the toy wouldn't feel native in the portfolio.

## Considered Options

- **Iframe of the standalone site.** Zero coupling, but needs the standalone site live first and feels less native. Rejected.
- **Build directly inside the portfolio's Astro codebase.** Fastest to start, but it would then have to be pulled out again for the standalone site. Rejected.
- **Themeable component (portfolio skins it).** Rejected: two looks to QA, and the toy uses Fridgeface's own identity on both hosts.

## Consequences

- This repo must stay **public** so Vercel can install it without credentials (the portfolio repo is private).
- The component owns its whole look. Hosts provide only the surrounding chrome (for example the portfolio's nav back to the case study).
- Releases are tagged, and hosts pin a tag (`github:ebryant-dev/fridgeface#vX.Y.Z`) rather than tracking `main`.
