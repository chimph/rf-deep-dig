import { useEffect, useRef, useState } from 'react';
import type { GameComponentProps } from '@rarefriends/friendsdk/runtime';
import { GameMenu } from '@rarefriends/friendsdk/frame';
import { createFriendReader, type GenerationSprites } from '@rarefriends/friendsdk/sprites';
import DeepDig from './view.js';
import DescendConfirmation from './descend-confirmation.js';
import { initialSessionState, transition, expireIdle, topUpWallet, type Command } from './engine.js';
import './submission.css';
import './fonts/silkscreen-web.css';

/** GameHost owns connection, selection and fresh ownership verification.
 * Gallery artwork arrives with the verified session; direct artwork reads are
 * only a retry/compatibility fallback. The existing economy stays simulated.
 */
export default function SubmissionGame(props: GameComponentProps) {
  if (props.client.mode !== 'preview') return <GameMenu title="Simulation only"><p>Deep Dig does not support live RF actions.</p></GameMenu>;
  return <Session key={String(props.friendId)} {...props} />;
}

function Session({ friendId, client, paused, openFriendSelector, friendArtwork, soundMuted, setSoundMuted }: GameComponentProps) {
  const [state, setState] = useState(() => initialSessionState(friendId));
  const current = useRef(state);
  const [now, setNow] = useState(Date.now);
  const [sprites, setSprites] = useState<GenerationSprites | undefined>(friendArtwork);
  const [sessionReady, setSessionReady] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Command | null>(null);
  const active = useRef(false), blocked = useRef(true);
  blocked.current = paused || !sessionReady || !sprites || !!loadingError;

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setSprites(friendArtwork); setSessionReady(false); setLoadingError('');
    // Completes the SDK handshake. Its fixed-table ledger is not Deep Dig's pool.
    void Promise.all([client.read(), friendArtwork ?? createFriendReader().read(friendId)]).then(([, art]) => {
      if (!cancelled) { setSprites(art); setSessionReady(true); }
    }).catch(() => { if (!cancelled) setLoadingError('Could not load your Friend artwork or session. Retry to continue.'); });
    return () => { cancelled = true; active.current = false; };
  }, [client, friendId, friendArtwork, attempt]);

  function commit(next: typeof state) {
    current.current = next; setState(next);
    if (next.result?.kind === 'idle') setConfirmation(null);
  }
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      try { const next = expireIdle(current.current); if (next !== current.current) commit(next); }
      catch { setError('The simulation clock failed. Reset this session in Settings.'); }
    };
    const timer = setInterval(tick, 1000);
    window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);

  function dispatch(command: Command) {
    if (!active.current || blocked.current) return false;
    if (command.type === 'enter' && command.friend !== String(friendId)) return false;
    try {
      const before = current.current;
      let next = transition(before, command);
      if (next === before) return false;
      // Skip the old acknowledgement screen without hiding an idle refund.
      if (command.type === 'extract' && next.result?.kind === 'extracted') next = transition(next, { type: 'clearResult' });
      commit(next); setError('');
      return !(before.run && next.result?.kind === 'idle');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Simulated action failed.'); return false; }
  }
  function request(command: Command) {
    if (blocked.current || confirmation) return;
    if (command.type !== 'advance') { dispatch(command); return; }
    const next = expireIdle(current.current);
    if (next !== current.current) { commit(next); return; }
    setConfirmation(command);
  }
  return <div className="submission-surface rf-game-frame" data-session-friend={String(friendId)}>
    <div className="submission-content" inert={paused || undefined}>
      {!sprites || loadingError ? <GameMenu title={loadingError ? 'Friend unavailable' : 'Loading your Friend…'} footer={<>{loadingError && <button onClick={() => setAttempt(n => n + 1)}>Retry artwork</button>}{openFriendSelector && <button onClick={openFriendSelector}>Choose Friend</button>}</>}><p role={loadingError ? 'alert' : 'status'}>{loadingError || 'Reading canonical artwork for your selected Friend.'}</p></GameMenu> :
        <DeepDig soundMuted={soundMuted} onSoundMutedChange={setSoundMuted} openFriendSelector={openFriendSelector} friendId={friendId} sprites={sprites} sessionOnly paused={paused || !sessionReady || !!confirmation} state={state} now={now} error={error}
          dispatch={dispatch} request={request}
          reset={() => { if (!blocked.current) { commit(initialSessionState(friendId)); setConfirmation(null); setError(''); } }}
          topUp={() => { if (blocked.current) return false; commit(topUpWallet(current.current, String(friendId))); return true; }} />}
      {confirmation && state.run && <DescendConfirmation run={state.run} onCancel={() => setConfirmation(null)}
        onConfirm={() => { const command = confirmation; setConfirmation(null); dispatch(command); }} />}
    </div>
  </div>;
}
