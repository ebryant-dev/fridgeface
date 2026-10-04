/**
 * Screen-reader announcement text. Pure functions, no DOM: the component feeds the results to one polite
 * live region. Wording uses the glossary (piece, board, stacking order, composition) and stays short.
 */

export const pieceCount = (n: number): string => (n === 1 ? '1 piece on the board.' : `${n} pieces on the board.`);

/** "upright", "15 degrees clockwise from upright", "30 degrees anticlockwise from upright". */
export function describeAngle(fromUprightDeg: number): string {
  const r = Math.round(fromUprightDeg * 10) / 10;
  if (r === 0) return 'upright';
  const a = Math.abs(r);
  return `${a} ${a === 1 ? 'degree' : 'degrees'} ${r > 0 ? 'clockwise' : 'anticlockwise'} from upright`;
}

export const stackPosition = (index: number, total: number): string => `${index + 1} of ${total} in stacking order.`;

export const announceAdded = (name: string, total: number): string => `${name} added. ${pieceCount(total)}`;

/** Selection via the keyboard: name, place in the stacking order and current rotation. */
export function announceSelected(name: string, index: number, total: number, fromUprightDeg: number): string {
  return `${name} selected. ${stackPosition(index, total)} ${capitalise(describeAngle(fromUprightDeg))}.`;
}

export const announceRotated = (name: string, fromUprightDeg: number): string =>
  `${name} rotated to ${describeAngle(fromUprightDeg)}.`;

export const announceMoved = (name: string): string => `${name} moved.`;

const pieces = (n: number): string => (n === 1 ? '1 piece' : `${n} pieces`);

/**
 * Overlap-aware restacking. One piece: its new place in the stacking order. A selection of several: a count. When nothing
 * above (or below) overlaps, nothing moves and the announcement says why.
 */
export function announceRestacked(dir: 'forward' | 'backward', moved: boolean, index: number, total: number, count = 1): string {
  if (!moved) return `Nothing ${dir === 'forward' ? 'above' : 'below'} overlaps ${count === 1 ? 'it' : 'them'}.`;
  if (count > 1) return `${pieces(count)} moved ${dir}.`;
  return `Moved ${dir}. ${stackPosition(index, total)}`;
}

/** A selection of several pieces (or the count after one was added or removed). */
export const announceSelectionCount = (n: number): string => (n ? `${pieces(n)} selected.` : 'Selection cleared.');

export const announceGroupMoved = (n: number): string => `${pieces(n)} moved.`;

/** A selection rotated as one unit: the total turn since it was selected, in whole tenths of a degree, signed (clockwise positive). */
export function announceGroupRotated(n: number, deg: number): string {
  const r = Math.round(deg * 10) / 10 || 0;
  return `${pieces(n)} rotated to ${r} ${Math.abs(r) === 1 ? 'degree' : 'degrees'}.`;
}

export const announceGroupDeleted = (n: number): string => `${pieces(n)} deleted.`;

export const announceDeleted = (remaining: number): string => `Piece deleted. ${pieceCount(remaining)}`;

export const announceZoom = (zoomRatio: number): string => `Zoom ${Math.round(zoomRatio * 100)} percent.`;

export const announceHistory = (kind: 'undo' | 'redo', did: boolean): string =>
  did ? (kind === 'undo' ? 'Undone.' : 'Redone.') : kind === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.';

export const announceLoaded = (total: number): string => `Composition opened. ${pieceCount(total)}`;

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const announceSuggestion = (char: string, variant: number, added: number, total: number): string =>
  `Suggestion for ${char}, variant ${variant}, placed. ${added === 1 ? '1 piece' : `${added} pieces`} added. ${pieceCount(total)}`;

export const announceWord = (text: string, variant: number, added: number, total: number): string =>
  `Word composition ${text}, variant ${variant}, placed. ${added === 1 ? '1 piece' : `${added} pieces`} added. ${pieceCount(total)}`;

export const announceIntro = (total: number): string => `A starting composition, the word play, is on the board. ${pieceCount(total)}`;
