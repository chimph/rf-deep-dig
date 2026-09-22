/** Deep Dig procedural audio. No audio files, network requests or gameplay randomness.
 * Playback lifecycle adapted from FriendSDK v0.1.2 src/friend-sounds.ts (Apache-2.0).
 * Stock PCM is rendered through the exported SDK API; its source is unchanged.
 */
import { renderFriendSound, FRIEND_SOUND_IDS, FRIEND_SOUND_SAMPLE_RATE, FRIEND_SOUND_MAX_VOICES,
  FRIEND_SOUND_MAX_GAIN, FRIEND_SOUND_PEAK, type FriendSoundCue, type FriendSoundKit, type FriendSoundState } from '@rarefriends/friendsdk/sounds';
export type DeepDigSoundCue = FriendSoundCue | 'orb' | 'mine' | 'pickup';
export type DeepDigSoundKit = Omit<FriendSoundKit, 'play'> & {
  play(cue: DeepDigSoundCue, options?: { volume?: number; delay?: number }): boolean;
};
function unit(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}
const smooth = (value: number) => Math.sin(Math.PI / 2 * Math.max(0, Math.min(1, value))) ** 2;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Pure deterministic PCM: crystal orb, gravelly mine and a brief ground-find shimmer. */
export function renderDeepDigSound(cue: DeepDigSoundCue, options: { sampleRate?: number } = {}): Float32Array {
  if (cue !== 'orb' && cue !== 'mine' && cue !== 'pickup') return renderFriendSound(cue, options);
  const rate = options.sampleRate ?? FRIEND_SOUND_SAMPLE_RATE;
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new RangeError('sampleRate must be between 8000 and 192000');
  const out = new Float64Array(Math.round((cue === 'orb' ? .92 : cue === 'pickup' ? .28 : .44) * rate));
  const tone = (at: number, duration: number, start: number, end: number, level: number, bell = false) => {
    let phase = 0;
    for (let i = 0; i < duration * rate; i++) {
      const t = i / rate, index = Math.round(at * rate) + i;
      if (index >= out.length) break;
      phase += start * (end / start) ** (t / duration) / rate;
      const envelope = smooth(t / .004) * smooth((duration - t) / .05) * Math.exp(-t / (duration * .36));
      const wave = bell ? Math.sin(2 * Math.PI * phase) + .32 * Math.sin(2 * Math.PI * phase * 2.76) + .1 * Math.sin(2 * Math.PI * phase * 4.1)
        : .8 * Math.sin(2 * Math.PI * phase) + .2 * (4 * Math.abs(phase % 1 - .5) - 1);
      out[index] += level * envelope * wave;
    }
  };
  if (cue === 'pickup') {
    // Two light glints: shorter and quieter in playback than a recovered orb.
    tone(0, .19, hz(88), hz(88), .22, true);
    tone(.055, .225, hz(95), hz(95), .13, true);
  } else if (cue === 'orb') {
    // A rising crystal motif, with quiet delayed glints and a warm lower landing.
    tone(0, .35, hz(48), hz(48), .14);
    [72, 76, 79, 84, 88].forEach((note, i) => {
      const at = i * .065;
      tone(at, .48, hz(note), hz(note), .3 - i * .025, true);
      tone(at + .14, .46, hz(note + 12), hz(note + 12), .045, true);
    });
  } else {
    tone(0, .3, 145, 38, .5);
    let seed = 0x444947, low = 0, held = 0;
    const hold = Math.max(1, Math.round(rate / 9600));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      if (i % hold === 0) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        held = Math.round(((seed / 4294967296) * 2 - 1) * 12) / 12;
      }
      low += (1 - .83 ** (48000 / rate)) * (held - low);
      let envelope = 0;
      for (const [at, strength] of [[0, 1], [.045, .55], [.105, .32], [.175, .16]]) {
        const age = t - at;
        if (age >= 0) envelope += strength * smooth(age / .0015) * Math.exp(-age / .03);
      }
      out[i] += .52 * envelope * Math.tanh(2.4 * (.65 * low + .35 * held));
    }
  }
  let peak = 0;
  for (const sample of out) peak = Math.max(peak, Math.abs(sample));
  return Float32Array.from(out, (sample, i) => sample * (peak ? FRIEND_SOUND_PEAK / peak : 0) * smooth(i / (rate * .001)) * smooth((out.length - 1 - i) / (rate * .015)));
}

export function createDeepDigSoundKit(options: { muted?: boolean; volume?: number } = {}): DeepDigSoundKit {
  if (options.muted !== undefined && typeof options.muted !== "boolean") throw new TypeError("muted must be a boolean");
  let muted = options.muted ?? false, volume = unit(options.volume ?? 0.65, "volume");
  let context: AudioContext | null = null, master: GainNode | null = null;
  let unlocked = false, unsupported = false, disposed = false, epoch = 0;
  let pending: Promise<boolean> | null = null, listening = false;
  const buffers = new Map<DeepDigSoundCue, AudioBuffer>();
  type Playing = { source: AudioBufferSourceNode; gain: GainNode; released: boolean };
  const voices = new Set<Playing>();
  const doc = typeof document === "undefined" ? null : document;
  const win = typeof window === "undefined" ? null : window;
  const hidden = () => Boolean(doc?.hidden);
  function release(voice: Playing) {
    if (voice.released) return;
    voice.released = true; voices.delete(voice); voice.source.onended = null;
    try { voice.source.disconnect(); } catch { /* Already detached. */ }
    try { voice.gain.disconnect(); } catch { /* Already detached. */ }
  }
  function halt(voice: Playing) {
    try { voice.source.stop(); } catch { /* A finished source can already be stopped. */ }
    release(voice);
  }
  function stop() {
    epoch++;
    if (pending) { pending = null; unlocked = false; }
    for (const voice of [...voices]) halt(voice);
  }
  const visibility = () => { if (hidden()) stop(); };
  const pageHide = () => stop();
  function masterLevel() { if (master) master.gain.value = muted ? 0 : volume * FRIEND_SOUND_MAX_GAIN; }
  function attach() {
    if (listening) return;
    doc?.addEventListener("visibilitychange", visibility); win?.addEventListener("pagehide", pageHide); listening = true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; unlocked = false; stop(); buffers.clear();
    if (listening) { doc?.removeEventListener("visibilitychange", visibility); win?.removeEventListener("pagehide", pageHide); listening = false; }
    try { master?.disconnect(); } catch { /* Closing a graph is idempotent. */ }
    const previous = context; context = null; master = null;
    if (previous) { try { void previous.close().catch(() => {}); } catch { /* Unsupported close. */ } }
  }
  function unlock(): Promise<boolean> {
    if (disposed || muted || hidden() || unsupported) return Promise.resolve(false);
    if (unlocked && context?.state === "running") return Promise.resolve(true);
    if (pending) return pending;
    if (context?.state === "closed") {
      for (const voice of [...voices]) halt(voice);
      try { master?.disconnect(); } catch { /* The browser closed this graph. */ }
      context = null; master = null; unlocked = false; buffers.clear();
    }
    const generation = epoch;
    if (!context || context.state === "closed") {
      try {
        const AudioContextClass = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) { unsupported = true; return Promise.resolve(false); }
        context = new AudioContextClass(); master = context.createGain(); masterLevel(); master.connect(context.destination); buffers.clear(); attach();
      } catch {
        const failed = context; context = null; master = null; unsupported = true;
        if (failed) { try { void failed.close().catch(() => {}); } catch { /* Allocation was rejected. */ } }
        return Promise.resolve(false);
      }
    }
    const active = context;
    let resume: Promise<void>;
    try { resume = active.state === "running" ? Promise.resolve() : active.resume(); }
    catch { unlocked = false; return Promise.resolve(false); }
    unlocked = false;
    const attempt = resume.then(() => {
      if (disposed || generation !== epoch || muted || hidden() || context !== active || active.state !== "running") return false;
      unlocked = true; return true;
    }, () => false).finally(() => { if (pending === attempt) pending = null; });
    pending = attempt;
    return attempt;
  }
  function play(cue: DeepDigSoundCue, playOptions: { volume?: number; delay?: number } = {}): boolean {
    if (![...FRIEND_SOUND_IDS, "orb", "mine", "pickup"].includes(cue)) throw new TypeError(`Unknown Deep Dig sound: ${cue}`);
    const level = unit(playOptions.volume ?? 1, "cue volume"), delay = unit(playOptions.delay ?? 0, "delay");
    if (disposed || muted || hidden() || !unlocked || !context || !master || context.state !== "running" || !volume || !level) return false;
    let source: AudioBufferSourceNode | null = null, gain: GainNode | null = null, voice: Playing | null = null;
    try {
      let buffer = buffers.get(cue);
      if (!buffer) {
        const pcm = renderDeepDigSound(cue);
        buffer = context.createBuffer(1, pcm.length, FRIEND_SOUND_SAMPLE_RATE); buffer.getChannelData(0).set(pcm); buffers.set(cue, buffer);
      }
      if (voices.size >= FRIEND_SOUND_MAX_VOICES) halt(voices.values().next().value!);
      source = context.createBufferSource(); gain = context.createGain(); gain.gain.value = level;
      source.buffer = buffer; source.connect(gain); gain.connect(master);
      voice = { source, gain, released: false }; voices.add(voice);
      const playing = voice; source.onended = () => release(playing);
      source.start(context.currentTime + delay); return true;
    } catch {
      if (voice) halt(voice);
      else { try { source?.disconnect(); } catch {} try { gain?.disconnect(); } catch {} }
      return false;
    }
  }
  return Object.freeze({
    get state(): FriendSoundState { return Object.freeze({ status: disposed ? "disposed" : unsupported ? "unsupported" : unlocked && context?.state === "running" ? "ready" : "locked", muted, volume, activeVoices: voices.size }); },
    unlock, play, stop, dispose,
    setMuted(next: boolean) {
      if (typeof next !== "boolean") throw new TypeError("muted must be a boolean");
      if (disposed) return;
      muted = next; masterLevel(); if (muted) stop();
    },
    setVolume(next: number) { const checked = unit(next, "volume"); if (disposed) return; volume = checked; masterLevel(); if (!volume) stop(); },
  });
}
