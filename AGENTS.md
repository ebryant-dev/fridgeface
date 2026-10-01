# fridgeface — interactive five-shape type toy (satellite repo)

Agent entry point for this repo (`CLAUDE.md` is a symlink to this file). When a session is rooted here, load THIS file — not the workspace root CLAUDE.md.

Edward (Bryant) Hamel goes by **Edward** professionally; close friends/family (and you) call him **Bry**.

## ⚠️ Read the planning/state system FIRST, every session

Code lives here. Planning, decisions and live progress live in the private workspace repo (kept out of this **public** repo on purpose). Read, by absolute path:

```
/Users/edwardhamel/Dropbox (Personal)/Bryant-AI-Workspace/creative/personal-brand/working/fridgeface/
  CLAUDE.md
  docs/PRD.md
  state/verify.sh               <- RUN FIRST: checks the state docs against git (and the deploy, once one exists)
  state/PROJECT-STATE.md        <- verified snapshot + deviations register (source of truth)
  state/CURRENT-NEXT-ACTION.md  <- the immediate next task
  state/SESSION-HANDOFF.md      <- where the last session stopped
  state/DECISION-LOG.md         <- locked decisions (read before changing anything)
  state/WORKFLOW-RULES.md       <- build loop, safety, state-file discipline
  state/OPEN-QUESTIONS.md       <- deferred items + pending human decisions
  state/CHECKPOINTS.md          <- milestone history
```

In this repo: `CONTEXT.md` (the glossary — use its terms exactly) and `docs/adr/` (architecture decisions).

**This repo is public.** Never commit personal, career or internal planning material here — that belongs in the workspace planning folder above.

## What this project is

An interactive canvas for Fridgeface, Bry's five-shape modular typeface: players place copies of the five shapes, move, rotate and restack them to build words and pictograms. Shipped as one self-contained web component consumed by two hosts: the portfolio (`ebryanthamel-portfolio`, route `/work/fridgeface/play`) and, later, a standalone Fridgeface site. See `docs/adr/0001-shared-web-component.md`.

## Sacred rules (never change without asking Bry)

- **Pieces only move, rotate and restack.** No scaling, no mirroring — the physical magnets can't, so the digital ones can't.
- **The five shapes' geometry comes from Bry's original vectors**, at one shared scale. Never redraw, approximate or "clean up" a shape.
- **Suggestions, never rules.** The alphabet panel shows *one way* to build a letter, and must say there is no right way.
- Fridgeface's own visual identity (black / white / fridge texture), not the portfolio's cosmic look.

## Safety

- Never `rm -rf` a directory. Delete only files you created, by exact name.
- Subagents `cd` here first and never touch anything at or above `_workspace/`.
- Pushes and deploys are outward-facing — follow the workspace confirmation norms.
