import { describe, expect, it } from 'vitest';
import { BLOCK_ORDER, blockState, deleteLabel } from './block';

const base = { selected: 0, pieces: 0, canUndo: false, canRedo: false, fwd: false, back: false };

describe('the bottom button block (v1.5.0)', () => {
  it('is X, Undo, Redo, Back, Forward, left to right', () => {
    expect(BLOCK_ORDER).toEqual(['x', 'undo', 'redo', 'backward', 'forward']);
  });

  it('X with a selection deletes it: "Delete piece" / "Delete N pieces", always on', () => {
    expect(blockState({ ...base, selected: 1, pieces: 3 })).toMatchObject({ x: 'delete', buttons: { x: { label: 'Delete piece', disabled: false } } });
    expect(blockState({ ...base, selected: 4, pieces: 4 }).buttons.x).toEqual({ label: 'Delete 4 pieces', disabled: false });
    expect(deleteLabel(2)).toBe('Delete 2 pieces');
  });

  it('X with nothing selected asks to clear the board; off when the board is empty', () => {
    expect(blockState({ ...base, pieces: 2 })).toMatchObject({ x: 'clear', buttons: { x: { label: 'Clear board', disabled: false } } });
    expect(blockState(base).buttons.x).toEqual({ label: 'Clear board', disabled: true });
  });

  it('Back and Forward: off with nothing selected (even if a press could move something), else by the no-op rules', () => {
    const none = blockState({ ...base, pieces: 3, fwd: true, back: true }).buttons;
    expect([none.backward.disabled, none.forward.disabled]).toEqual([true, true]);
    const some = blockState({ ...base, selected: 1, pieces: 3, fwd: true, back: false }).buttons;
    expect([some.backward, some.forward]).toEqual([{ label: 'Send backward', disabled: true }, { label: 'Bring forward', disabled: false }]);
  });

  it('Undo and Redo follow the history', () => {
    const b = blockState({ ...base, canUndo: true }).buttons;
    expect([b.undo.disabled, b.redo.disabled]).toEqual([false, true]);
  });
});
