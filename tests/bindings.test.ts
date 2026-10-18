import { describe, expect, it } from 'vitest';
import { deviceLabels, isPadSlot, moveFor, padIndex, slotForKey, slotKeys } from '../src/core/bindings';

describe('co-op key bindings', () => {
  it('kbA owns WASD + Space/LeftShift, kbB owns arrows + RightShift/Numpad0', () => {
    expect(slotForKey('KeyW', false)).toMatchObject({ slot: 'kbA', move: [0, -1] });
    expect(slotForKey('KeyD', false)).toMatchObject({ slot: 'kbA', move: [1, 0] });
    expect(slotForKey('Space', false)).toMatchObject({ slot: 'kbA', dash: true });
    expect(slotForKey('ShiftLeft', false)).toMatchObject({ slot: 'kbA', dash: true });
    expect(slotForKey('ArrowLeft', false)).toMatchObject({ slot: 'kbB', move: [-1, 0] });
    expect(slotForKey('ShiftRight', false)).toMatchObject({ slot: 'kbB', dash: true });
    expect(slotForKey('Numpad0', false)).toMatchObject({ slot: 'kbB', dash: true });
    expect(slotForKey('KeyZ', false)).toBeNull();
  });

  it('RightCtrl dashes for kbB only when allowed (desktop build)', () => {
    expect(slotForKey('ControlRight', false)).toBeNull();
    expect(slotForKey('ControlRight', true)).toMatchObject({ slot: 'kbB', dash: true });
    expect(slotKeys('kbB', true)).toContain('ControlRight');
    expect(slotKeys('kbB', false)).not.toContain('ControlRight');
  });

  it('Enter is kbB confirm and never a dash key', () => {
    for (const code of ['Enter', 'NumpadEnter']) {
      const b = slotForKey(code, true)!;
      expect(b.slot).toBe('kbB');
      expect(b.dash).toBeFalsy();
      expect(b.lobby).toBe('confirm');
      expect(b.pick).toBe('confirm');
    }
  });

  it('kbA and kbB key sets are disjoint', () => {
    const a = new Set(slotKeys('kbA', true));
    for (const k of slotKeys('kbB', true)) expect(a.has(k)).toBe(false);
  });

  it('no dash key confirms a level-up pick (anti-mash)', () => {
    for (const slot of ['kbA', 'kbB'] as const) {
      for (const code of slotKeys(slot, true)) {
        const b = slotForKey(code, true)!;
        if (b.dash) expect(b.pick).toBeUndefined();
      }
    }
  });

  it('maps lobby and pick actions per device', () => {
    expect(slotForKey('Space', false)!.lobby).toBe('confirm');
    expect(slotForKey('KeyE', false)!.pick).toBe('confirm');
    expect(slotForKey('KeyQ', false)!.lobby).toBe('back');
    expect(slotForKey('KeyR', false)!.pick).toBe('reroll');
    expect(slotForKey('Backspace', false)).toMatchObject({ slot: 'kbB', lobby: 'back', pick: 'reroll' });
    expect(slotForKey('Digit2', false)).toMatchObject({ slot: 'kbA', pick: 'pick1' });
    expect(slotForKey('Numpad3', false)).toMatchObject({ slot: 'kbB', pick: 'pick2' });
    // Digits never belong to kbB and numpad digits never to kbA.
    expect(slotForKey('Digit1', false)!.slot).toBe('kbA');
    expect(slotForKey('Numpad1', false)!.slot).toBe('kbB');
  });

  it('moveFor only answers for the owning slot', () => {
    expect(moveFor('kbA', 'KeyS')).toEqual([0, 1]);
    expect(moveFor('kbA', 'ArrowDown')).toBeUndefined();
    expect(moveFor('kbB', 'ArrowDown')).toEqual([0, 1]);
    expect(moveFor('kbB', 'KeyS')).toBeUndefined();
  });

  it('pad slots and labels', () => {
    expect(isPadSlot('pad2')).toBe(true);
    expect(isPadSlot('kbA')).toBe(false);
    expect(padIndex('pad3')).toBe(3);
    expect(deviceLabels('kbA').picks).toEqual(['1', '2', '3']);
    expect(deviceLabels('kbB').confirm).toBe('ENTER');
    expect(deviceLabels('kbB', true).dash).toContain('R-CTRL');
    expect(deviceLabels('pad1').name).toBe('Controller 2');
    expect(deviceLabels('pad1').picks).toBeNull();
    // The stick steers menus as well as the d-pad, so the hint names both.
    expect(deviceLabels('pad1').cycle).toBe('STICK / D-PAD');
  });
});
