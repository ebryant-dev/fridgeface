# Fridgeface

A modular typeface built from five shapes. Black shapes add form, white shapes cut it away, and together they build letters and pictograms. This project is the interactive version: a board where people arrange pieces the way they would magnets on a fridge.

## Language

### The system

**Shape**:
One of the five fixed forms that make up the whole Fridgeface system. There are exactly five, and their proportions are fixed.
_Avoid_: module, glyph, part

**Positive shape**:
A black shape. It provides the body of a letter.
_Avoid_: solid, filled shape

**Negative shape**:
A white shape. It cuts into positive shapes, carving the counters and openings of a letter out of them.
_Avoid_: eraser, mask, hole

**Stem**:
A long, narrow bar. There is a positive stem and a negative stem.
_Avoid_: line, bar, rectangle

**Round**:
An oval whose axis is offset rather than a true circle; the offset gives letters their humanist stress. There is a positive round (larger) and a negative round (smaller).
_Avoid_: circle, ellipse, dot

**Wedge**:
The triangular negative shape. There is no positive wedge.
_Avoid_: triangle

### Playing

**Piece**:
One copy of a **shape** placed on the **board**. A piece can be moved, rotated and restacked — never scaled or mirrored, because a physical magnet can't be.
_Avoid_: magnet (except when talking about the physical product), instance, sticker

**Board**:
The unbounded surface pieces are placed on — the digital fridge door.
_Avoid_: canvas (implementation term), artboard, page
In visitor-facing copy the board may be called **the fridge** ("Drag the black oval onto the fridge").

**Outline**:
A guide-only target that shows where one piece of a suggestion belongs during the guide: a solid line for a positive shape, a dotted one for a negative shape. A piece released close to its outline clicks exactly into place (position and angle only: its stacking order is never changed for it); outside the guide, pieces never snap.
_Avoid_: ghost, placeholder, template, snap target

**Tray**:
Where a player takes new pieces from. It always holds all five shapes and never runs out.
_Avoid_: palette, toolbar, inventory

**Stacking order**:
Which piece sits on top where pieces overlap. Because negative shapes only cut when they sit above positive ones, stacking order is part of how a letter is built.
_Avoid_: z-index, layer order

**Selection**:
The pieces currently chosen to act on together: move, rotate, restack or delete. A selection is temporary; it is not saved and does not survive deselecting. A selection of several pieces moves and rotates as one rigid unit around its common centre.
_Avoid_: group (there are no lasting groups), layer, set

**Composition**:
Everything a player has built on the board: the full set of pieces with their positions, rotations and stacking order. This is what gets shared, exported and saved.
_Avoid_: drawing, design, scene, project

**Suggestion**:
One possible way to build a letter or a word, shown for inspiration. There is never a single correct construction in Fridgeface.
_Avoid_: rule, template, correct form, glyph

**Word composition**:
A whole word built as a single composition rather than as separate letters set side by side. Its pieces may be shared between letters, overlap, or cross letter boundaries, so the word reads as one image. It is the truest form of Fridgeface writing: the whole is more than its letters, like a semagram that is read all at once.
_Avoid_: spelled word, word layout, string, typesetting

**Ligature**:
A place within a word composition where a single piece, or a positive/negative combination, serves two or more letters at once.
_Avoid_: join, connector, kerning

## Relationships

- The system has exactly five **shapes**: positive stem, positive round, negative stem, negative round, wedge.
- A **piece** is a copy of exactly one **shape**. A **board** holds any number of pieces.
- A **composition** is the set of **pieces** on one **board**, together with their **stacking order**.
- A **negative shape** shows as a cut only when it sits above a **positive shape** in the **stacking order**.
- Bringing a **selection** forward or back moves it past the next **piece** it actually overlaps, keeping the selection's own internal **stacking order**.
- Many different **suggestions** can exist for the same letter or word.
- A **word composition** is not the sum of letter **suggestions** placed in a row; letters set side by side are only a fallback when no word composition exists.
- A **ligature** only exists inside a **word composition**.

## Example dialogue

> **Dev:** "When someone drags the wedge out of the tray, do we create a new shape?"
> **Bry:** "No — there are only ever five shapes. They're pulling a new piece of the wedge onto the board."
> **Dev:** "And the alphabet panel shows the correct 'a'?"
> **Bry:** "It shows a suggestion. There's no correct 'a' — that's the point."

## Flagged ambiguities

- "Word" could mean letters arranged in a row or one composed image. Resolved: a **word composition** is always composed as one; letters set in a row are a fallback, never the intended form.

- "Magnet" is used both for the physical product and for an on-screen element. Resolved: **piece** on screen; "magnet" only for the physical product.
- "Canvas" was used for the play surface. Resolved: **board** in domain language; "canvas" only for implementation.
