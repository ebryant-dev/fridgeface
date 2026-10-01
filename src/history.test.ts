import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes one step per record', () => {
    const h = new History(0);
    h.record(1);
    h.record(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeUndefined();
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(2);
    expect(h.redo()).toBeUndefined();
    expect(h.present).toBe(2);
  });

  it('ignores a record equal to the present', () => {
    const h = new History(0);
    expect(h.record(0)).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('a new action clears the redo stack', () => {
    const h = new History(0);
    h.record(1);
    h.record(2);
    h.undo();
    expect(h.canRedo).toBe(true);
    h.record(9);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(1);
  });

  it('caps the undo stack, dropping the oldest steps', () => {
    const h = new History(0, { cap: 3 });
    for (let i = 1; i <= 10; i++) h.record(i);
    expect(h.undoDepth).toBe(3);
    expect(h.undo()).toBe(9);
    expect(h.undo()).toBe(8);
    expect(h.undo()).toBe(7);
    expect(h.undo()).toBeUndefined();
  });

  it('defaults to a cap of 200', () => {
    const h = new History(0);
    for (let i = 1; i <= 500; i++) h.record(i);
    expect(h.undoDepth).toBe(200);
  });

  describe('coalescing', () => {
    it('merges same-key records within the window into one step', () => {
      const h = new History(0);
      h.record(1, 'nudge:a', 1000);
      h.record(2, 'nudge:a', 1200);
      h.record(3, 'nudge:a', 1700); // 500ms after the previous (sliding window)
      expect(h.undoDepth).toBe(1);
      expect(h.undo()).toBe(0);
      expect(h.redo()).toBe(3);
    });

    it('starts a new step after the window lapses', () => {
      const h = new History(0);
      h.record(1, 'k', 1000);
      h.record(2, 'k', 1601);
      expect(h.undoDepth).toBe(2);
    });

    it('does not merge different keys, or keyless records', () => {
      const h = new History(0);
      h.record(1, 'a', 1000);
      h.record(2, 'b', 1100);
      h.record(3, null, 1200);
      h.record(4, null, 1300);
      expect(h.undoDepth).toBe(4);
    });

    it('does not merge across an undo', () => {
      const h = new History(0);
      h.record(1, 'k', 1000);
      h.undo();
      h.record(2, 'k', 1100);
      h.record(3, 'k', 1150);
      expect(h.undoDepth).toBe(1);
      expect(h.undo()).toBe(0);
    });

    it('clears redo when merging', () => {
      const h = new History(0);
      h.record(1, 'k', 1000);
      h.record(2, 'k', 1100);
      expect(h.canRedo).toBe(false);
    });

    it('drops the step if a run returns to where it began', () => {
      const h = new History(0);
      h.record(1, 'k', 1000);
      h.record(0, 'k', 1100);
      expect(h.canUndo).toBe(false);
      expect(h.present).toBe(0);
    });
  });

  it('reset empties both stacks', () => {
    const h = new History(0);
    h.record(1);
    h.undo();
    h.reset(5);
    expect(h.present).toBe(5);
    expect(h.canUndo || h.canRedo).toBe(false);
  });
});
