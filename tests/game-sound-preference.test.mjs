import test from 'node:test';
import assert from 'node:assert/strict';
import { readGameSoundMuted, writeGameSoundMuted } from '../dist/game-sound-preference.js';

test('sound defaults on, saved mute is respected, and blocked storage stays usable without changing saves', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['deep-dig.offline.v4', 'untouched-save']]);
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    } });
    assert.equal(readGameSoundMuted('Deep Dig'), false);
    writeGameSoundMuted('Deep Dig', false); assert.equal(readGameSoundMuted('Deep Dig'), false);
    assert.equal(readGameSoundMuted('Another game'), false);
    writeGameSoundMuted('Deep Dig', true); assert.equal(readGameSoundMuted('Deep Dig'), true);
    values.set('friendsdk.sound-muted:Deep Dig', 'invalid'); assert.equal(readGameSoundMuted('Deep Dig'), false);
    writeGameSoundMuted('Deep Dig', 'false'); assert.equal(values.get('friendsdk.sound-muted:Deep Dig'), 'invalid');
    assert.equal(values.get('deep-dig.offline.v4'), 'untouched-save'); assert.equal(values.size, 2);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('Storage blocked'); } });
    assert.equal(readGameSoundMuted('Deep Dig'), false); assert.doesNotThrow(() => writeGameSoundMuted('Deep Dig', false));
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});
