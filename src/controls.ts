/**
 * The "Controls" panel: which input-method sections to show for the device (pure, no DOM) and what each lists.
 * The component feeds `controlSections` from `matchMedia`, `navigator.maxTouchPoints` and whether a physical key press
 * has been seen; the rules are Edward's and are unit-tested in `controls.test.ts`.
 */

export interface ControlsEnv {
  /** `typeof matchMedia === 'function'`. */
  hasMatchMedia: boolean;
  /** `matchMedia('(any-pointer: coarse)').matches` (a touch screen). */
  anyCoarse: boolean;
  /** `matchMedia('(any-pointer: fine)').matches` (a mouse, trackpad or pen). */
  anyFine: boolean;
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints: number;
  /** A trusted, real `keydown` has been seen in this page session. */
  keyboardSeen: boolean;
}

export interface ControlSections {
  touch: boolean;
  pointer: boolean;
  keyboard: boolean;
  /** Every section is shown, so there is nothing for "Show all controls" to reveal. */
  allShown: boolean;
}

/**
 * - Touch: `(any-pointer: coarse)` OR `maxTouchPoints > 0`.
 * - Mouse and trackpad: `(any-pointer: fine)`.
 * - Keyboard: `(any-pointer: fine)` OR a physical key press has been seen.
 * - Ambiguity: no `matchMedia`, or neither coarse nor fine matches: show everything.
 */
export function controlSections(env: ControlsEnv): ControlSections {
  if (!env.hasMatchMedia || (!env.anyCoarse && !env.anyFine)) return { touch: true, pointer: true, keyboard: true, allShown: true };
  const touch = env.anyCoarse || env.maxTouchPoints > 0;
  const pointer = env.anyFine;
  const keyboard = env.anyFine || env.keyboardSeen;
  return { touch, pointer, keyboard, allShown: touch && pointer && keyboard };
}

/** A real key press from a person: trusted, a non-empty key, not part of IME composition. */
export function isPhysicalKey(e: { isTrusted: boolean; key: string; isComposing?: boolean; keyCode?: number }): boolean {
  if (!e.isTrusted || e.isComposing || e.keyCode === 229) return false;
  return !!e.key && e.key !== 'Process' && e.key !== 'Unidentified' && e.key !== 'Dead';
}

export interface ControlRow {
  /** Alternative key or gesture combos; each combo is a list of keys shown joined by "+". */
  keys: readonly (readonly string[])[];
  text: string;
  /** Shown only while letter suggestions exist. */
  when?: 'sg-only';
}
export interface ControlGroup {
  title?: string;
  rows: readonly ControlRow[];
}
export interface ControlSection {
  id: 'touch' | 'pointer' | 'keyboard';
  title: string;
  groups: readonly ControlGroup[];
}

/** The copy. Order on screen: Touch, Mouse and trackpad, Keyboard. */
export const CONTROL_SECTIONS: readonly ControlSection[] = [
  { id: 'touch', title: 'Touch', groups: [{ rows: [
    { keys: [['Tap']], text: 'Tap a shape in the tray to add it, or tap a piece to select it' },
    { keys: [['Drag']], text: 'Drag a shape from the tray onto the board, or drag a piece or the selection to move it' },
    { keys: [['Drag']], text: 'Drag the empty board with one finger to pan' },
    { keys: [['Hold', 'drag']], text: 'Hold the empty board, then drag: select the pieces a box touches' },
    { keys: [['Hold']], text: 'Hold a piece: add it to the selection, or remove it' },
    { keys: [['Handle']], text: 'Drag the round handle to rotate the selection, freely' },
    { keys: [['Twist']], text: 'Two fingers, the first on the selection: rotate it, freely' },
    { keys: [['Pinch']], text: 'Zoom the board' },
    { keys: [['X button']], text: 'Delete the selection; with nothing selected, clear the board (it asks first)' },
    { keys: [['Arrow buttons']], text: 'Down sends the selection backward, up brings it forward, past the next piece it overlaps' },
  ] }] },
  { id: 'pointer', title: 'Mouse and trackpad', groups: [{ rows: [
    { keys: [['Click']], text: 'Click a shape in the tray to add it, or click a piece to select it' },
    { keys: [['Drag']], text: 'Drag a shape from the tray onto the board, or drag a piece or the selection to move it' },
    { keys: [['Drag', 'empty board']], text: 'Select the pieces a box touches; with Shift, add them' },
    { keys: [['Shift', 'click']], text: 'Add a piece to the selection, or remove it' },
    { keys: [['Handle']], text: 'Drag the round handle to rotate the selection, freely' },
    { keys: [['Wheel'], ['Two-finger scroll']], text: 'Pan the board' },
    { keys: [['Space', 'drag'], ['Middle', 'drag']], text: 'Pan the board with the pointer' },
    { keys: [['Ctrl', 'wheel'], ['Pinch']], text: 'Zoom the board (pinch on a trackpad)' },
    { keys: [['X button']], text: 'Delete the selection; with nothing selected, clear the board (it asks first)' },
    { keys: [['Arrow buttons']], text: 'Down sends the selection backward, up brings it forward, past the next piece it overlaps' },
  ] }] },
  { id: 'keyboard', title: 'Keyboard', groups: [
    { title: 'Add and choose', rows: [
      { keys: [['1'], ['2'], ['3'], ['4'], ['5']], text: 'Add a piece (tray order)' },
      { keys: [['N'], ['P']], text: 'Select the next or previous piece in the stacking order' },
      { keys: [['Ctrl', 'A'], ['Cmd', 'A']], text: 'Select every piece' },
      { keys: [['Esc']], text: 'Close a menu, then deselect' },
    ] },
    { title: 'Move and rotate the selection', rows: [
      { keys: [['Arrows'], ['Shift', 'Arrows']], text: 'Move 1 unit, or 10' },
      { keys: [[','], ['.']], text: 'Rotate 1 degree anticlockwise or clockwise (several pieces turn as one, about their centre)' },
    ] },
    { title: 'Stack and delete', rows: [
      { keys: [[']'], ['[']], text: 'Bring forward or send backward, past the next piece it overlaps' },
      { keys: [['Delete'], ['Backspace']], text: 'Delete the selected pieces' },
    ] },
    { title: 'View', rows: [
      { keys: [['Arrows'], ['Alt', 'Arrows']], text: 'Pan the board; Shift for bigger steps. With a selection, only Alt + Arrows pans' },
      { keys: [['+'], ['−']], text: 'Zoom in or out' },
      { keys: [['F'], ['Shift', '1']], text: 'Frame all pieces' },
    ] },
    { title: 'History, share and export', rows: [
      { keys: [['Ctrl', 'Z'], ['Cmd', 'Z']], text: 'Undo' },
      { keys: [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']], text: 'Redo' },
      { keys: [['C']], text: 'Copy the share link' },
      { keys: [['E']], text: 'Open the export menu' },
      { keys: [['L']], text: 'Show or hide letter suggestions', when: 'sg-only' },
    ] },
    { title: 'Everything else', rows: [
      { keys: [['Tab'], ['Shift', 'Tab']], text: 'Move to the next or previous control' },
      { keys: [['?']], text: 'Show or hide this list' },
    ] },
  ] },
];
