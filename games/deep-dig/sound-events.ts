import type { State } from './engine.js';
import type { DeepDigSoundCue } from './sounds.js';

/** Select from committed changes, including confirmed risky steps; never from a guessed outcome. */
export function soundForTransition(before: State, after: State): DeepDigSoundCue | null {
  if (before === after) return null;
  if (after.result && before.result !== after.result) {
    return after.result.kind === 'failed' ? after.result.hit !== null ? 'mine' : 'impact'
      : after.result.kind === 'idle' ? 'select' : 'reveal-rare';
  }
  const old = before.run, next = after.run;
  if (!old || !next || old.id !== next.id || old.depth !== next.depth) return null;
  if (next.cells.some((cell, i) => cell.revealed && cell.mystery && !cell.mine && !old.cells[i].revealed)) return 'orb';
  if (next.caches.some((cache, i) => cache.kind === 'ordinary' && cache.opened && !old.caches[i].opened && cache.loot.some(item => item.amount > 0n))) return 'pickup';
  if (next.position !== null && next.position !== old.position) return 'select';
  if (next.cells.some((cell, i) => cell.flagged !== old.cells[i].flagged)) return 'action-ready';
  return null;
}
