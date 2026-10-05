import { describe, expect, it } from 'vitest';
import { CONTROL_SECTIONS, controlSections, isPhysicalKey, type ControlsEnv } from './controls';

const env = (o: Partial<ControlsEnv>): ControlsEnv => ({ hasMatchMedia: true, anyCoarse: false, anyFine: false, maxTouchPoints: 0, keyboardSeen: false, ...o });

describe('controlSections', () => {
  it('coarse only (a phone): touch only', () => {
    expect(controlSections(env({ anyCoarse: true, maxTouchPoints: 5 }))).toEqual({ touch: true, pointer: false, keyboard: false, allShown: false });
  });
  it('fine only (a desktop without touch): mouse and keyboard', () => {
    expect(controlSections(env({ anyFine: true }))).toEqual({ touch: false, pointer: true, keyboard: true, allShown: false });
  });
  it('both (touchscreen laptop, iPad with a trackpad): everything', () => {
    expect(controlSections(env({ anyCoarse: true, anyFine: true, maxTouchPoints: 10 }))).toEqual({ touch: true, pointer: true, keyboard: true, allShown: true });
  });
  it('neither matches: everything', () => {
    expect(controlSections(env({}))).toEqual({ touch: true, pointer: true, keyboard: true, allShown: true });
  });
  it('no matchMedia: everything', () => {
    expect(controlSections(env({ hasMatchMedia: false }))).toEqual({ touch: true, pointer: true, keyboard: true, allShown: true });
  });
  it('coarse only after a trusted key press: touch and keyboard', () => {
    expect(controlSections(env({ anyCoarse: true, maxTouchPoints: 5, keyboardSeen: true }))).toEqual({ touch: true, pointer: false, keyboard: true, allShown: false });
  });
  it('maxTouchPoints alone shows touch next to a fine pointer', () => {
    expect(controlSections(env({ anyFine: true, maxTouchPoints: 1 })).touch).toBe(true);
  });
  it('maxTouchPoints alone (no media match) is ambiguous: everything', () => {
    expect(controlSections(env({ maxTouchPoints: 5 })).allShown).toBe(true);
  });
});

describe('isPhysicalKey', () => {
  it('accepts a trusted key with a name', () => expect(isPhysicalKey({ isTrusted: true, key: '?' })).toBe(true));
  it('rejects synthetic events', () => expect(isPhysicalKey({ isTrusted: false, key: 'a' })).toBe(false));
  it('rejects an empty key', () => expect(isPhysicalKey({ isTrusted: true, key: '' })).toBe(false));
  it('rejects IME composition', () => {
    expect(isPhysicalKey({ isTrusted: true, key: 'a', isComposing: true })).toBe(false);
    expect(isPhysicalKey({ isTrusted: true, key: 'Process', keyCode: 229 })).toBe(false);
  });
});

describe('control copy', () => {
  const text = JSON.stringify(CONTROL_SECTIONS);
  it('has the three sections in order', () => expect(CONTROL_SECTIONS.map((s) => s.id)).toEqual(['touch', 'pointer', 'keyboard']));
  it('mentions no snapping or 15 degree steps', () => expect(text).not.toMatch(/snap|15°|15 degree/i));
});
