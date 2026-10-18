import { expect, it } from 'vitest';
import { makeRunConfig } from '../src/game/runconfig';
import { World } from '../src/game/world';
import { resultFromWorld } from '../src/meta/result';
import { defaultSave, migrate } from '../src/meta/save';
import { decodeTransmission, earnTransmission, normalizeTransmission, SIGNAL_ANSWER } from '../src/meta/transmission';

it('old and malformed saves get a bounded compatible transmission state', () => {
  expect(migrate({ version: 1, cores: 40 }).transmission).toEqual({ unlocked: false, letters: '', hinted: false, solved: false, revealed: false });
  expect(migrate({ version: 1, cores: 40 }).cores).toBe(40);
  expect(normalizeTransmission({ unlocked: true, letters: 'BBEEXA-C0ON', hinted: 'yes' }).letters).toBe('BEACON');
  expect(normalizeTransmission({ unlocked: true, letters: 17, solved: false }).letters).toBe('');
  expect(normalizeTransmission({ solved: true, letters: 'BEACON' }).solved).toBe(false);
  expect(normalizeTransmission({ unlocked: true, revealed: true }).letters).toBe(SIGNAL_ANSWER);
});

it('only a finished non-Daily solo run earns the fragment, once, without rewards', () => {
  const r = resultFromWorld(new World(makeRunConfig({ seed: 77 }))), save = defaultSave();
  const before = { ...save }; delete before.transmission;
  expect(earnTransmission(save, r, false)).toBe(false);
  expect(earnTransmission(save, { ...r, daily: true }, true)).toBe(false);
  expect(earnTransmission(save, { ...r, players: 2 }, true)).toBe(false);
  expect(earnTransmission(save, r, true)).toBe(true);
  expect(earnTransmission(save, r, true)).toBe(false);
  const after = { ...save }; delete after.transmission;
  expect(after).toEqual(before);
});

it('wrong and duplicate submissions preserve progress and completion survives save migration', () => {
  const s = normalizeTransmission({ unlocked: true, letters: 'OCABEN', hinted: true });
  expect(decodeTransmission(s)).toBe('incorrect'); expect(s.letters).toBe('OCABEN');
  expect(decodeTransmission(s)).toBe('incorrect'); expect(s.solved).toBe(false);
  s.letters = SIGNAL_ANSWER;
  expect(decodeTransmission(s)).toBe('solved');
  expect(decodeTransmission(s, true)).toBe('solved'); expect(s.revealed).toBe(false);
  expect(migrate(JSON.parse(JSON.stringify({ ...defaultSave(), transmission: s }))).transmission).toEqual(s);
  const revealed = normalizeTransmission({ unlocked: true, letters: 'O' });
  expect(decodeTransmission(revealed)).toBe('incomplete');
  expect(decodeTransmission(revealed, true)).toBe('revealed');
  expect(decodeTransmission(revealed)).toBe('revealed'); expect(revealed.solved).toBe(false);
});
