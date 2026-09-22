import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { renderFriendSound } from '../dist/friend-sounds.js';

async function load(file) {
  const bundle = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const { renderDeepDigSound, createDeepDigSoundKit } = await load('../games/deep-dig/sounds.ts');
const { soundForTransition } = await load('../games/deep-dig/sound-events.ts');
const E = await load('../games/deep-dig/engine.ts');
let seed = 42;
const draw = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % 10000; };
const act = (s, command) => E.transition(s, command, draw, s.run?.lastActivityAt ?? 1000);
const start = () => act(act(E.initialState(), { type: 'enter', friend: '7730' }), { type: 'dig', cell: 34 });
function route(r, target) {
  const previous = new Map([[r.position, null]]), queue = [r.position];
  for (const at of queue) for (const next of E.cardinalNeighbors(at)) {
    if (!previous.has(next) && (!r.cells[next].mystery || r.cells[next].revealed || next === target)) { previous.set(next, at); queue.push(next); }
  }
  assert.ok(previous.has(target));
  const path = []; for (let at = target; at !== r.position; at = previous.get(at)) path.unshift(at);
  return path;
}

test('original movement and flag samples are retained exactly; custom cues are distinct bounded deterministic PCM', () => {
  for (const cue of ['select', 'action-ready']) assert.deepEqual(renderDeepDigSound(cue), renderFriendSound(cue));
  for (const cue of ['orb', 'mine', 'pickup']) for (const sampleRate of [8000, 44100, 48000, 96000]) {
    const pcm = renderDeepDigSound(cue, { sampleRate });
    assert.deepEqual(pcm, renderDeepDigSound(cue, { sampleRate }));
    assert.equal(pcm.length, Math.round(sampleRate * (cue === 'orb' ? .92 : cue === 'pickup' ? .28 : .44)));
    let peak = 0, energy = 0, mean = 0;
    for (const value of pcm) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); energy += value * value; mean += value; }
    assert.ok(peak > .69 && peak <= .700001);
    assert.ok(Math.sqrt(energy / pcm.length) > .02);
    assert.ok(Math.abs(mean / pcm.length) < .025);
    assert.equal(Math.abs(pcm[0]), 0); assert.equal(Math.abs(pcm.at(-1)), 0);
  }
});

test('movement uses the old flag blip; flag placement and removal use the old movement cue', () => {
  let state = act(E.initialState(), { type: 'enter', friend: '7730' });
  const moved = act(state, { type: 'dig', cell: 34 });
  assert.ok(['select', 'pickup'].includes(soundForTransition(state, moved))); state = moved;
  const cell = state.run.cells.findIndex(c => !c.revealed);
  for (let i = 0; i < 2; i++) { const next = act(state, { type: 'flag', cell }); assert.equal(soundForTransition(state, next), 'action-ready'); state = next; }
  assert.equal(soundForTransition(state, act(state, { type: 'dig', cell: 34 })), null);
  assert.equal(soundForTransition(state, state), null, 'loading an existing save has no transition');
});

test('orb and mine outcomes override movement, including confirmed flags; revisiting an orb does not replay its cue', () => {
  for (const mine of [false, true]) for (const flagged of [false, true]) {
    let state = start();
    const target = state.run.cells.findIndex(c => c.mystery && c.mine === mine);
    const path = route(state.run, target);
    for (const cell of path.slice(0, -1)) { const next = act(state, { type: 'dig', cell }); assert.ok(['select', 'pickup'].includes(soundForTransition(state, next))); state = next; }
    const previousPosition = state.run.position;
    if (flagged) state = act(state, { type: 'flag', cell: target });
    let next = act(state, { type: flagged ? 'risk' : 'dig', cell: target });
    assert.equal(soundForTransition(state, next), mine ? 'mine' : 'orb');
    assert.equal(soundForTransition(next, next), null);
    if (!mine) {
      state = act(next, { type: 'dig', cell: previousPosition });
      next = act(state, { type: 'dig', cell: target });
      assert.equal(soundForTransition(state, next), 'select');
    } else assert.equal(soundForTransition(next, act(next, { type: 'clearResult' })), null);
  }
});

test('ground finds shimmer only when collected, not on flood reveal, empty steps or revisits', () => {
  let state = start();
  const target = state.run.caches.find(c => c.kind === 'ordinary' && !c.opened && c.loot.some(item => item.amount > 0n));
  assert.ok(target);
  const path = route(state.run, target.cell);
  for (const cell of path) {
    const next = act(state, { type: 'dig', cell });
    const pickedUp = E.sum(next.run.bag) > E.sum(state.run.bag);
    assert.equal(soundForTransition(state, next), pickedUp ? 'pickup' : 'select');
    state = next;
  }
  const previousPosition = path.length > 1 ? path.at(-2) : 34;
  const away = act(state, { type: 'dig', cell: previousPosition });
  const returned = act(away, { type: 'dig', cell: target.cell });
  assert.equal(soundForTransition(away, returned), 'select');
  assert.equal(soundForTransition(returned, returned), null);
  // Initial placement may flood-reveal multiple finds, but only the occupied
  // cache pays. First-tile pickup must follow that exact paid amount as well.
  for (let cell = 0; cell < E.SIZE; cell++) {
    const before = act(E.initialState(), { type: 'enter', friend: '7730' });
    const after = act(before, { type: 'dig', cell });
    assert.equal(soundForTransition(before, after), E.sum(after.run.bag) > 0n ? 'pickup' : 'select');
  }
});

test('custom audio stays silent until enabled, bounds overlap, and stops on mute, hiding and disposal', async () => {
  const keys = ['AudioContext', 'document', 'window'];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const doc = new EventTarget(), win = new EventTarget(); doc.hidden = false;
  const sources = [];
  class Context {
    state = 'running'; currentTime = 0; destination = {};
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createBuffer(channels, length) { const pcm = new Float32Array(length); return { getChannelData: () => pcm }; }
    createBufferSource() { const source = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; this.onended?.(); } }; sources.push(source); return source; }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  try {
    for (const [key, value] of Object.entries({ AudioContext: Context, document: doc, window: win })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const kit = createDeepDigSoundKit({ muted: true });
    assert.equal(await kit.unlock(), false); assert.equal(kit.play('orb'), false); assert.equal(sources.length, 0);
    kit.setMuted(false); assert.equal(await kit.unlock(), true);
    for (let i = 0; i < 8; i++) assert.equal(kit.play(['orb', 'mine', 'pickup'][i % 3]), true);
    assert.equal(kit.state.activeVoices, 4); assert.ok(sources.slice(0, 4).every(s => s.stopped));
    kit.setMuted(true); assert.equal(kit.state.activeVoices, 0); assert.equal(kit.play('mine'), false);
    kit.setMuted(false); await kit.unlock(); kit.play('orb'); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(kit.state.activeVoices, 0); assert.equal(kit.play('mine'), false);
    doc.hidden = false; await kit.unlock(); kit.play('mine'); kit.dispose();
    assert.equal(kit.state.activeVoices, 0); assert.equal(kit.play('orb'), false); assert.ok(sources.every(s => s.stopped));
  } finally { keys.forEach((key, i) => { if (saved[i]) Object.defineProperty(globalThis, key, saved[i]); else delete globalThis[key]; }); }
});
