/** Host-only UI preference. Never stores gameplay, balances or wallet identity. */
export function readGameSoundMuted(gameName: string): boolean {
  try { return localStorage.getItem(`friendsdk.sound-muted:${gameName}`) === 'true'; }
  catch { return false; }
}

export function writeGameSoundMuted(gameName: string, muted: boolean): void {
  if (typeof muted !== 'boolean') return;
  try { localStorage.setItem(`friendsdk.sound-muted:${gameName}`, String(muted)); }
  catch { /* Private/blocked storage must not interrupt play or the sound toggle. */ }
}
