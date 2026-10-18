import { describe, expect, it } from 'vitest';
import type { ShipId } from '../src/game/types';
import { CoopLobby, LOBBY_COUNTDOWN } from '../src/ui/lobby';

const ALL: ShipId[] = ['spark', 'vanguard', 'tempest', 'bastion', 'phantom'];

describe('co-op lobby', () => {
  it('joins devices into the lowest free slot, one slot per device', () => {
    const l = new CoopLobby(ALL, 'spark');
    expect(l.action('kbB', 'confirm')).toBe(true);
    expect(l.action('kbA', 'confirm')).toBe(true);
    expect(l.slots[0]!.device).toBe('kbB');
    expect(l.slots[1]!.device).toBe('kbA');
    // A joined device's confirm readies instead of joining twice.
    l.action('kbB', 'confirm');
    expect(l.joined()).toHaveLength(2);
    expect(l.slots[0]!.ready).toBe(true);
    // Non-confirm actions from unjoined devices do nothing.
    expect(l.action('pad0', 'left')).toBe(false);
    expect(l.action('pad0', 'back')).toBe(false);
  });

  it('caps at four pilots', () => {
    const l = new CoopLobby(ALL, 'spark');
    for (const d of ['kbA', 'kbB', 'pad0', 'pad1'] as const) expect(l.action(d, 'confirm')).toBe(true);
    expect(l.action('pad2', 'confirm')).toBe(false);
    expect(l.join('bot')).toBe(false);
  });

  it('gives P1 the hangar ship and others the next free unlocked ship', () => {
    const l = new CoopLobby(['spark', 'vanguard', 'tempest'], 'tempest');
    l.action('kbA', 'confirm');
    l.action('kbB', 'confirm');
    l.action('pad0', 'confirm');
    l.action('pad1', 'confirm');
    expect(l.slots.map((s) => s!.ship)).toEqual(['tempest', 'spark', 'vanguard', 'tempest']);
  });

  it('cycles only unlocked ships, and not while ready', () => {
    const l = new CoopLobby(['spark', 'tempest'], 'spark');
    l.action('kbA', 'confirm');
    l.action('kbA', 'right');
    expect(l.slots[0]!.ship).toBe('tempest');
    l.action('kbA', 'right');
    expect(l.slots[0]!.ship).toBe('spark');
    l.action('kbA', 'left');
    expect(l.slots[0]!.ship).toBe('tempest');
    l.action('kbA', 'confirm');
    expect(l.action('kbA', 'left')).toBe(false);
    expect(l.slots[0]!.ship).toBe('tempest');
  });

  it('back un-readies, then leaves; later pilots move up', () => {
    const l = new CoopLobby(ALL, 'spark');
    l.action('kbA', 'confirm');
    l.action('kbB', 'confirm');
    l.action('pad0', 'confirm');
    l.action('kbA', 'confirm');
    l.action('kbA', 'back');
    expect(l.slots[0]!.ready).toBe(false);
    l.action('kbA', 'back');
    expect(l.slots.map((s) => s?.device ?? null)).toEqual(['kbB', 'pad0', null, null]);
  });

  it('counts down once 2+ pilots are all ready; any change cancels', () => {
    const l = new CoopLobby(ALL, 'spark');
    l.action('kbA', 'confirm');
    l.action('kbA', 'confirm');
    expect(l.countdown).toBe(-1); // one pilot is not enough
    l.action('kbB', 'confirm');
    expect(l.countdown).toBe(-1);
    l.action('kbB', 'confirm');
    expect(l.countdown).toBe(LOBBY_COUNTDOWN);
    expect(l.update(1)).toBeNull();
    l.action('kbB', 'back'); // un-ready cancels
    expect(l.countdown).toBe(-1);
    expect(l.update(5)).toBeNull();
    l.action('kbB', 'confirm');
    expect(l.update(1)).toBeNull();
    l.action('pad0', 'confirm'); // a new pilot joining (not ready) cancels
    expect(l.countdown).toBe(-1);
    l.action('pad0', 'confirm');
    expect(l.update(LOBBY_COUNTDOWN + 0.1)).toBe('start');
    expect(l.update(1)).toBeNull(); // only once
    expect(l.action('kbA', 'back')).toBe(false); // frozen after launch
  });

  it('roster() lists joined pilots in pid order', () => {
    const l = new CoopLobby(ALL, 'spark');
    l.action('kbB', 'confirm');
    l.action('pad3', 'confirm');
    l.action('pad3', 'right');
    expect(l.roster()).toEqual([
      { device: 'kbB', ship: 'spark' },
      { device: 'pad3', ship: 'tempest' },
    ]);
  });

  it('remembers ships per device from the last roster', () => {
    const l = new CoopLobby(ALL, 'spark', [
      { device: 'kbB', ship: 'phantom' },
      { device: 'kbA', ship: 'locked-ship' as ShipId },
    ]);
    l.action('kbB', 'confirm');
    l.action('kbA', 'confirm');
    expect(l.slots[0]!.ship).toBe('phantom');
    expect(l.slots[1]!.ship).toBe('spark');
  });

  it('bots join ready; mouse helpers toggle and drop', () => {
    const l = new CoopLobby(ALL, 'spark');
    l.action('kbA', 'confirm');
    expect(l.join('bot')).toBe(true);
    expect(l.slots[1]).toMatchObject({ device: 'bot', ready: true });
    expect(l.toggleReady(0)).toBe(true);
    expect(l.allReady()).toBe(true);
    expect(l.drop('kbA')).toBe(true);
    expect(l.slots[0]!.device).toBe('bot');
    expect(l.allReady()).toBe(false);
  });
});
