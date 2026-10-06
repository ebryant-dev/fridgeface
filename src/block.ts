/**
 * The bottom button block (v1.5.0): one always-visible row of icon buttons, left to right X, Undo, Redo, Back, Forward, on
 * phones and desktop alike. Pure, no DOM: what each button says and whether it is on. The component (main.ts) renders it.
 *
 * X acts on the selection when there is one (deletes it, one undo step); with nothing selected it clears the whole board,
 * after the inline confirm. Back (send backward) and Forward (bring forward) restack the selection past the next piece it
 * overlaps, so they are off with nothing selected, and off when that press would move nothing.
 */

export const BLOCK_ORDER = ['x', 'undo', 'redo', 'backward', 'forward'] as const;
export type BlockButton = (typeof BLOCK_ORDER)[number];

export interface BlockInput {
  /** How many pieces are selected. */
  selected: number;
  /** How many pieces are on the board. */
  pieces: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Bring forward / send backward would move the selection (overlap-aware); ignored with nothing selected. */
  fwd: boolean;
  back: boolean;
}

export interface BlockButtonState {
  /** Screen-reader label, also the tooltip. */
  label: string;
  disabled: boolean;
}

export interface BlockState {
  /** What X does now: delete the selection, or ask to clear the board. */
  x: 'delete' | 'clear';
  buttons: Record<BlockButton, BlockButtonState>;
}

export const BLOCK_LABELS = {
  clear: 'Clear board',
  undo: 'Undo',
  redo: 'Redo',
  backward: 'Send backward',
  forward: 'Bring forward',
} as const;

/** "Delete piece" / "Delete N pieces". */
export const deleteLabel = (n: number) => (n === 1 ? 'Delete piece' : `Delete ${n} pieces`);

export function blockState(i: BlockInput): BlockState {
  const sel = i.selected > 0;
  return {
    x: sel ? 'delete' : 'clear',
    buttons: {
      x: { label: sel ? deleteLabel(i.selected) : BLOCK_LABELS.clear, disabled: !sel && i.pieces === 0 },
      undo: { label: BLOCK_LABELS.undo, disabled: !i.canUndo },
      redo: { label: BLOCK_LABELS.redo, disabled: !i.canRedo },
      backward: { label: BLOCK_LABELS.backward, disabled: !sel || !i.back },
      forward: { label: BLOCK_LABELS.forward, disabled: !sel || !i.fwd },
    },
  };
}
