import { describe, expect, it } from 'vitest';
import {
  announceAdded, announceDeleted, announceHistory, announceLoaded, announceMoved, announceRestacked, announceRotated,
  announceSelected, announceZoom, announceSuggestion, announceIntro, describeAngle, pieceCount,
} from './announce';

describe('announcements', () => {
  it('counts pieces with the right plural', () => {
    expect(pieceCount(0)).toBe('0 pieces on the board.');
    expect(pieceCount(1)).toBe('1 piece on the board.');
    expect(pieceCount(3)).toBe('3 pieces on the board.');
  });

  it('describes angles from upright with a direction', () => {
    expect(describeAngle(0)).toBe('upright');
    expect(describeAngle(15)).toBe('15 degrees clockwise from upright');
    expect(describeAngle(-30)).toBe('30 degrees anticlockwise from upright');
    expect(describeAngle(1)).toBe('1 degree clockwise from upright');
    expect(describeAngle(14.96)).toBe('15 degrees clockwise from upright');
    expect(describeAngle(-0.04)).toBe('upright');
  });

  it('builds the add / rotate / move / delete messages', () => {
    expect(announceAdded('Positive stem', 3)).toBe('Positive stem added. 3 pieces on the board.');
    expect(announceRotated('Wedge', 15)).toBe('Wedge rotated to 15 degrees clockwise from upright.');
    expect(announceMoved('Wedge')).toBe('Wedge moved.');
    expect(announceDeleted(2)).toBe('Piece deleted. 2 pieces on the board.');
    expect(announceDeleted(0)).toBe('Piece deleted. 0 pieces on the board.');
  });

  it('describes a selection with its place in the stacking order', () => {
    expect(announceSelected('Wedge', 1, 4, -45)).toBe('Wedge selected. 2 of 4 in stacking order. 45 degrees anticlockwise from upright.');
    expect(announceSelected('Round', 0, 1, 0)).toBe('Round selected. 1 of 1 in stacking order. Upright.');
  });

  it('describes restacking, including the ends of the stack', () => {
    expect(announceRestacked('forward', true, 1, 4)).toBe('Moved forward. 2 of 4 in stacking order.');
    expect(announceRestacked('backward', true, 0, 4)).toBe('Moved backward. 1 of 4 in stacking order.');
    expect(announceRestacked('forward', false, 3, 4)).toBe('Already on top.');
    expect(announceRestacked('backward', false, 0, 4)).toBe('Already at the bottom.');
  });

  it('covers history, zoom and loading', () => {
    expect(announceHistory('undo', true)).toBe('Undone.');
    expect(announceHistory('redo', true)).toBe('Redone.');
    expect(announceHistory('undo', false)).toBe('Nothing to undo.');
    expect(announceHistory('redo', false)).toBe('Nothing to redo.');
    expect(announceZoom(1.2499)).toBe('Zoom 125 percent.');
    expect(announceLoaded(1)).toBe('Composition opened. 1 piece on the board.');
  });

  it('announces a placed suggestion and the intro', () => {
    expect(announceSuggestion('a', 2, 5, 12)).toBe('Suggestion for a, variant 2, placed. 5 pieces added. 12 pieces on the board.');
    expect(announceSuggestion('l', 1, 1, 1)).toBe('Suggestion for l, variant 1, placed. 1 piece added. 1 piece on the board.');
    expect(announceIntro(9)).toBe('A starting composition, the word play, is on the board. 9 pieces on the board.');
  });
});
