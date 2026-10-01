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

export function announceRestacked(dir: 'forward' | 'backward', moved: boolean, index: number, total: number): string {
  if (!moved) return dir === 'forward' ? 'Already on top.' : 'Already at the bottom.';
  return `Moved ${dir === 'forward' ? 'forward' : 'backward'}. ${stackPosition(index, total)}`;
}

export const announceDeleted = (remaining: number): string => `Piece deleted. ${pieceCount(remaining)}`;

export const announceSnap = (on: boolean): string => (on ? 'Snap on. Rotation steps by 15 degrees.' : 'Snap off.');

export const announceZoom = (zoomRatio: number): string => `Zoom ${Math.round(zoomRatio * 100)} percent.`;

export const announceHistory = (kind: 'undo' | 'redo', did: boolean): string =>
  did ? (kind === 'undo' ? 'Undone.' : 'Redone.') : kind === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.';

export const announceLoaded = (total: number): string => `Composition opened. ${pieceCount(total)}`;

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
