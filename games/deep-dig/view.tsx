import { useEffect, useRef, useState } from 'react';
import { GameMenu } from '@rarefriends/friendsdk/frame';
import type { GameComponentProps } from '@rarefriends/friendsdk/runtime';
import { createDeepDigSoundKit, type DeepDigSoundKit } from './sounds.js';
import { soundForTransition } from './sound-events.js';
import type { GenerationSprites } from '@rarefriends/friendsdk/sprites';
import { drawFriend } from './world.js';
import { PixelIcon, SettingsIcon, SoundIcon } from './pixel-art.js';
import { WIDTH, SIZE, ENTRY, idleDeadline, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, STAKE_OPTIONS, entryChoices, maxEntryStake, maxPoolStake, runStake, sourceCounts, actualLevelMaximum, emptyCells, cardinalNeighbors, clearedCount, boardCleared, mysteryFound, canAdvance, canFundNext, maxReserve, runMysteryReward, lootRange, mysteryReward, MAX_DEPTH, sum, money, type State, type Command } from './engine.js';
import './style.css';

export type DeepDigProps = Pick<GameComponentProps, 'friendId' | 'paused'> & {
  soundMuted?: boolean; onSoundMutedChange?: (muted: boolean) => void; openFriendSelector?: () => void; sprites: GenerationSprites; sessionOnly?: boolean; state: State; now?: number; dispatch: (c: Command) => boolean; request: (c: Command) => void; reset: () => void; topUp?: () => boolean; error: string;
};
export function FriendAvatar({ id, sprites }: { id: bigint; sprites: GenerationSprites }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx || !sprites) return;
    drawFriend(ctx, sprites);
  }, [sprites]);
  return <canvas ref={ref} width={32} height={32} className="friend-avatar" aria-label={`Canonical Friend #${id}`} />;
}
const PORTRAIT_QUERY = '(max-width: 600px) and (orientation: portrait)';
const rowColumn = (i: number, portrait: boolean) => `Row ${(portrait ? i % WIDTH : Math.floor(i / WIDTH)) + 1}, column ${(portrait ? Math.floor(i / WIDTH) : i % WIDTH) + 1}`;
type Direction = 'up' | 'left' | 'down' | 'right';
type TileReveal = { kind: 'mine' | 'orb'; cell: number; amount: bigint; revision: number };
const directionForKey: Record<string, Direction> = { arrowup: 'up', w: 'up', arrowleft: 'left', a: 'left', arrowdown: 'down', s: 'down', arrowright: 'right', d: 'right' };
function step(from: number, direction: Direction) {
  const target = from + ({ up: -WIDTH, left: -1, down: WIDTH, right: 1 }[direction]);
  return cardinalNeighbors(from).includes(target) ? target : from;
}
export default function DeepDig({ friendId, paused, sprites, sessionOnly = false, state, now = Date.now(), dispatch, request, reset, topUp, openFriendSelector, soundMuted = false, onSoundMutedChange, error }: DeepDigProps) {
  const [touchControls, setTouchControls] = useState(() => matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    const query = matchMedia('(pointer: coarse)');
    let usedPointer = false;
    const update = () => { if (!usedPointer) setTouchControls(query.matches); };
    const pointer = (event: PointerEvent) => {
      if (!['mouse', 'touch', 'pen'].includes(event.pointerType)) return;
      // Keep an intentionally clicked D-pad available until its click completes.
      if (event.pointerType === 'mouse' && event.target instanceof Element && event.target.closest('.direction-pad')) return;
      usedPointer = true;
      setTouchControls(event.pointerType !== 'mouse');
    };
    query.addEventListener('change', update);
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('pointermove', pointer, true);
    return () => { query.removeEventListener('change', update); window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('pointermove', pointer, true); };
  }, []);
  const [portrait, setPortrait] = useState(() => matchMedia(PORTRAIT_QUERY).matches);
  useEffect(() => { const query = matchMedia(PORTRAIT_QUERY), update = () => { setPortrait(query.matches); cancelPress(); setFlagDirection(false); }; query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  const [menu, setMenu] = useState<'rules' | 'settings' | 'abandon' | 'reset' | 'extract' | 'complete' | null>(null);
  const [muted, setMuted] = useState(soundMuted), [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [riskCell, setRiskCell] = useState<number | null>(null);
  const [cursor, setCursor] = useState(34);
  const [friendCursor, setFriendCursor] = useState('');
  useEffect(() => {
    if (!sprites) { setFriendCursor(''); return; }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    if (context) { drawFriend(context, sprites); setFriendCursor(canvas.toDataURL()); }
  }, [friendId, sprites]);
  const [flagDirection, setFlagDirection] = useState(false), [pickup, setPickup] = useState<number | null>(null);
  const [reveal, setReveal] = useState<TileReveal | null>(null), [revealReady, setRevealReady] = useState(false);
  const [moveHint, setMoveHint] = useState('');
  const [selectedStake, setSelectedStake] = useState(ENTRY);
  const mineOverlay = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressedClick = useRef<{ cell: number; time: number } | null>(null);
  const sound = useRef<DeepDigSoundKit | null>(null), buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const r = state.run;
  const idleWarning = !!r && now >= idleDeadline(r) - (IDLE_TIMEOUT_MS - IDLE_WARNING_MS);
  const idleSeconds = r ? Math.max(0, Math.ceil((idleDeadline(r) - now) / 1000)) : 0;
  const mineResult = state.result?.kind === 'failed' && state.result.hit !== null;
  const revealPending = reveal?.kind === 'mine' && mineResult;
  const blocked = paused || !!menu || riskCell !== null || !!state.result || revealPending || idleWarning;
  const bag = r ? sum(r.bag) : 0n;
  const previousSoundState = useRef(state);
  const previousHaul = useRef({ run: r?.id, bag });
  const previousOrbs = useRef({ run: r?.id, depth: r?.depth, count: r ? mysteryFound(r) : 0 });
  const previousGround = useRef({ friendId, run: r?.id, depth: r?.depth, cleared: !!r && boardCleared(r) });
  useEffect(() => {
    const kit = createDeepDigSoundKit({ muted }); sound.current = kit;
    // Remembering "on" never bypasses the browser's user-gesture requirement.
    const unlock = () => { void kit.unlock(); };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, true);
    return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); kit.dispose(); };
  }, []);
  useEffect(() => { setMuted(soundMuted); sound.current?.setMuted(soundMuted); }, [soundMuted]);
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReduced(q.matches);
    q.addEventListener('change', change); return () => q.removeEventListener('change', change);
  }, []);
  useEffect(() => { setMenu(null); setRiskCell(null); setFlagDirection(false); setPickup(null); setReveal(null); setRevealReady(false); setCursor(34); setMoveHint(''); cancelPress(); }, [friendId, r?.depth, r?.id]);
  useEffect(() => {
    const previous = previousGround.current;
    const cleared = !!r && boardCleared(r);
    previousGround.current = { friendId, run: r?.id, depth: r?.depth, cleared };
    if (r?.depth === MAX_DEPTH && previous.friendId === friendId && previous.run === r.id && previous.depth === r.depth && !previous.cleared && cleared) setMenu('complete');
  }, [friendId, r]);
  useEffect(() => { if (blocked) { cancelPress(); setFlagDirection(false); } }, [blocked]);
  useEffect(() => {
    const previous = previousHaul.current;
    previousHaul.current = { run: r?.id, bag };
    if (r && previous.run === r.id && bag > previous.bag) setPickup(state.revision);
  }, [r?.id, bag, state.revision]);
  useEffect(() => {
    if (pickup === null) return;
    const timer = setTimeout(() => setPickup(null), 600);
    return () => clearTimeout(timer);
  }, [pickup]);
  useEffect(() => {
    const count = r ? mysteryFound(r) : 0, previous = previousOrbs.current;
    previousOrbs.current = { run: r?.id, depth: r?.depth, count };
    if (r && r.position !== null && previous.run === r.id && previous.depth === r.depth && count > previous.count) {
      setReveal({ kind: 'orb', cell: r.position, amount: runMysteryReward(r), revision: state.revision });
      setRevealReady(false);
    }
  }, [r?.id, r?.depth, state.revision]);
  useEffect(() => {
    if (state.result?.kind === 'failed' && state.result.hit !== null) {
      setReveal({ kind: 'mine', cell: state.result.hit, amount: state.result.amount, revision: state.revision });
      setRevealReady(false);
    }
  }, [state.result, friendId]);
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => {
      if (reveal.kind === 'mine') setRevealReady(true);
      else setReveal(null);
    }, 650);
    return () => clearTimeout(timer);
  }, [reveal]);
  useEffect(() => {
    const cue = soundForTransition(previousSoundState.current, state);
    previousSoundState.current = state;
    if (cue === 'pickup') {
      sound.current?.play('select');
      sound.current?.play('pickup', { volume: .45 });
    } else if (cue) sound.current?.play(cue);
  }, [state]);
  useEffect(() => { if (paused) sound.current?.stop(); }, [paused]);
  useEffect(() => {
    if (mineResult && revealReady && !paused && !menu) mineOverlay.current?.focus({ preventScroll: true });
  }, [mineResult, revealReady, paused, menu]);
  function tryAgain() {
    setSelectedStake(state.result?.stake ?? ENTRY);
    setReveal(null); setRevealReady(false);
    dispatch({ type: 'clearResult' });
  }
  function act(type: 'dig' | 'flag', cell: number) {
    if (blocked || !r) return false;
    if (type === 'dig' && r.position !== null && !cardinalNeighbors(r.position).includes(cell)) {
      if (cell !== r.position) setMoveHint('Walk one square at a time. Choose a tile beside your Friend.');
      return false;
    }
    if (type === 'flag' && !r.ready) { setMoveHint('Choose your safe starting tile first.'); return false; }
    setMoveHint('');
    setCursor(cell); void sound.current?.unlock();
    if (type === 'dig' && r.cells[cell].flagged) { setRiskCell(cell); return false; }
    const accepted = dispatch({ type, cell });
    if (accepted) {
      if (type === 'flag') setFlagDirection(false);
    }
    return accepted;
  }
  function cancelPress() { if (press.current) clearTimeout(press.current.timer); press.current = null; }
  useEffect(() => () => cancelPress(), []);
  function isSuppressed(cell: number) { return suppressedClick.current?.cell === cell && performance.now() - suppressedClick.current.time < 1500; }
  function toggleFlagDirection() {
    if (blocked || !r) return;
    if (!r.ready) { setMoveHint('Choose your safe starting tile first.'); return; }
    setFlagDirection(value => !value); setMoveHint('');
  }
  function directionTarget(direction: Direction) {
    const logicalDirection = portrait ? ({ up: 'left', down: 'right', left: 'up', right: 'down' } as const)[direction] : direction;
    return step(r?.position ?? cursor, logicalDirection);
  }
  function canFlagDirection(direction: Direction) {
    if (!r?.ready || r.position === null) return false;
    const next = directionTarget(direction);
    return next !== r.position && !r.cells[next].revealed;
  }
  function move(direction: Direction) {
    if (blocked || !r) return;
    const origin = r.position ?? cursor, next = directionTarget(direction);
    if (next === origin) { if (flagDirection) setMoveHint('No tile that way. Choose a highlighted neighbour or cancel flagging.'); return; }
    if (!r.ready) { setCursor(next); buttons.current[next]?.focus({ preventScroll: portrait }); return; }
    if (flagDirection) {
      if (r.cells[next].revealed) { setMoveHint('That tile is already open. Choose a highlighted neighbour or cancel flagging.'); return; }
      if (act('flag', next)) { setFlagDirection(false); buttons.current[origin]?.focus({ preventScroll: portrait }); }
      return;
    }
    act('dig', next);
    buttons.current[next]?.focus({ preventScroll: portrait });
  }
  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (blocked || !r) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault(); if (event.repeat) return;
        toggleFlagDirection(); return;
      }
      if (key === 'escape' && flagDirection) { event.preventDefault(); setFlagDirection(false); setMoveHint(''); return; }
      if (directionForKey[key]) { event.preventDefault(); if (!event.repeat) move(directionForKey[key]); return; }
      if (['e', ' ', 'enter'].includes(key) && (target?.closest('.mine-board') || key === 'e')) {
        event.preventDefault(); if (!event.repeat && !flagDirection) act('dig', cursor);
      }
    };
    const loseFocus = () => { cancelPress(); setFlagDirection(false); };
    window.addEventListener('keydown', onDown); window.addEventListener('blur', loseFocus); document.addEventListener('visibilitychange', loseFocus);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('blur', loseFocus); document.removeEventListener('visibilitychange', loseFocus); };
  });
  const choices = entryChoices(state, String(friendId)), cap = maxEntryStake(state, String(friendId));
  const shownStakes = STAKE_OPTIONS;
  const previewStake = choices.includes(selectedStake) ? selectedStake : choices[0] ?? ENTRY;
  const stake = r ? runStake(r) : state.result?.stake ?? previewStake;
  const canEnter = !r && !state.result && cap >= stake;
  const counts = r ? sourceCounts(r) : state.result ? {
    orbs: state.result.cells.filter(c=>c.mystery&&!c.mine).length,
    mines: state.result.cells.filter(c=>c.mine).length,
  } : null;
  const cells = r?.cells ?? state.result?.cells ?? emptyCells();
  const displayDepth = r?.depth ?? state.result?.depth ?? 1;
  const friendCell = r?.position ?? (mineResult ? state.result!.hit : null);
  const boardFriend = mineResult ? BigInt(state.result!.friend) : friendId;
  const statusText = error || moveHint || (flagDirection ? touchControls ? 'Choose a direction to flag · tap flag again to cancel.' : 'Choose a direction to flag · F or Esc cancels.' : '');
  const cleared = r ? clearedCount(r) : 0;
  const orbRewardAt = (depth: number) => r?.depth === depth ? runMysteryReward(r) : state.result?.depth === depth ? state.result.orbPrize ?? mysteryReward(depth, stake) : mysteryReward(depth, stake);
  const levelMaximums = Array.from({ length: MAX_DEPTH }, (_, i) => { const depth = i + 1; return r?.depth === depth ? actualLevelMaximum(r) : state.result?.depth === depth && state.result.maximum !== undefined ? state.result.maximum : maxReserve(depth, stake); });
  const totalMaximum = levelMaximums.reduce((total, maximum) => total + maximum, 0n);
  return <section data-depth={r || state.result ? displayDepth : 0} className="dig" data-touch-controls={touchControls} data-layout={portrait ? 'portrait' : 'landscape'} aria-label="Deep Dig">
    <header className="dig-top"><div><span className="eyebrow">RARE FRIENDS</span><h1>DEEP DIG<span className="title-orb" aria-hidden="true"><PixelIcon name="orb" /></span></h1></div>
      <div className="identity-art"><FriendAvatar id={friendId} sprites={sprites} /></div>
      <div className="header-account"><span className="mode-label">● SIMULATED RF ONLY</span><div className="header-wallet"><span>Wallet</span><strong data-testid="balance">{money(state.wallets[String(friendId)])}<small> RF</small></strong></div></div>
      <button className="settings-button" aria-label="Open settings" onClick={() => setMenu('settings')}><SettingsIcon /></button>
    </header>
    {(r || state.result) && <div className="depth-title board-depth-title"><span className="eyebrow">{`DEPTH 0${displayDepth} / 03`}</span>{r && <span className="run-stake">{money(stake)} RF stake</span>}</div>}
    <div className={`mine-board ${!r ? 'at-camp' : ''} ${flagDirection ? 'flag-mode' : ''}`} role="group" aria-label="Deep Dig board" data-placing={!!r && !r.ready && !blocked} style={r && !r.ready && !blocked && friendCursor ? { cursor: `url("${friendCursor}") 16 16, crosshair` } : undefined} data-outcome={reveal?.kind} data-outcome-ready={revealReady} data-flag-direction={flagDirection} data-paused={blocked} inert={blocked || undefined}>
      {cells.map((cell, i) => {
        const cache = cell.revealed ? r?.caches.find(c => c.cell === i) : undefined;
        const pile = cache?.kind === 'ordinary' && !cache.opened ? sum(cache.loot) : 0n;
        const showMine = mineResult && i === state.result!.hit;
        const showSource = mineResult && cell.mystery && !cell.revealed && !showMine;
        const reachable = r?.position !== null && r?.position !== undefined && cardinalNeighbors(r.position).includes(i);
        const label = `${rowColumn(i, portrait)}: ${showMine ? 'mine hit' : showSource ? 'unopened resonance source, orb or mine' : cell.flagged ? 'flagged' : cell.revealed ? `${cell.adjacent} adjacent resonance sources${cell.mystery ? ', orb recovered' : pile ? `, ${money(pile)} RF on ground` : cache?.opened && sum(cache.loot) > 0n ? ', ground find collected' : ', empty ground'}` : 'covered'}${friendCell === i ? ', your Friend is here' : ''}`;
        return <button key={i} ref={node => { buttons.current[i] = node; }} type="button" style={portrait ? { gridRow: i % WIDTH + 1, gridColumn: Math.floor(i / WIDTH) + 1 } : undefined} className={`tile ${cell.revealed ? 'revealed' : 'covered'} ${cell.flagged ? 'flagged' : ''} ${showMine ? 'mine-hit' : ''} ${showSource ? 'source-unopened' : ''} ${cell.revealed && cell.mystery && !showMine ? 'treasure-tile' : ''} ${friendCell === i ? 'friend-tile' : ''} ${reachable ? 'reachable' : ''} ${flagDirection && reachable && !cell.revealed ? 'flag-target' : ''} ${pile ? 'has-find' : ''}`}
          data-testid={`cell-${i}`} data-state={showMine ? 'mine' : showSource ? 'source' : cell.flagged ? 'flagged' : cell.revealed ? 'revealed' : 'covered'}
          tabIndex={cursor === i ? 0 : -1} disabled={!r} aria-label={label} onFocus={() => setCursor(i)}
          onPointerDown={event => {
            suppressedClick.current = null;
            if (event.pointerType === 'mouse' || blocked || !r) return;
            cancelPress();
            press.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
              press.current = null; suppressedClick.current = { cell: i, time: performance.now() }; act('flag', i);
            }, 450) };
          }}
          onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) { cancelPress(); suppressedClick.current = { cell: i, time: performance.now() }; } }}
          onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
          onClick={() => {
            if (isSuppressed(i)) { suppressedClick.current = null; return; }
            if (flagDirection) { if (reachable && !cell.revealed && act('flag', i)) setFlagDirection(false); return; }
            act('dig', i);
          }}
          onContextMenu={e => { e.preventDefault(); const touching = !!press.current; cancelPress(); if (!isSuppressed(i)) act('flag', i); if (touching) suppressedClick.current = { cell: i, time: performance.now() }; }}>
          {showMine ? <span className="mine-mark" aria-hidden><PixelIcon name="mine" /></span> : showSource ? <span className="source-mark" aria-hidden><PixelIcon name="source" /></span> : cell.flagged ? <span className="flag-mark" aria-hidden><PixelIcon name="flag" /></span> : cell.revealed ? <>
            {!cell.mystery && cell.adjacent > 0 && <span className={`clue clue-${cell.adjacent}`} aria-hidden>{cell.adjacent}</span>}
            {pile > 0n && <span className="ground-find" aria-hidden><i><PixelIcon name="find" /></i><small>{money(pile)}</small></span>}
            {cell.mystery && cell.revealed && !cell.mine && <span className="treasure mystery" aria-hidden><PixelIcon name="orb" /></span>}
          </> : <span className="covered-mark" aria-hidden>·</span>}
            {flagDirection && reachable && !cell.revealed && !cell.flagged && <span className="flag-preview" aria-hidden><PixelIcon name="flag" /></span>}
            {r && !r.ready && cursor === i && <span className="placement-preview" aria-hidden="true"><FriendAvatar id={friendId} sprites={sprites} /></span>}
            {friendCell === i && <span className="friend-token"><FriendAvatar id={boardFriend} sprites={sprites} />{pickup !== null && !blocked && <svg key={pickup} className={`pickup-shimmer${reduced ? ' reduced' : ''}`} viewBox="-32 -32 64 64" aria-hidden="true">
              {Array.from({ length: 8 }, (_, ray) => <g key={ray} transform={`rotate(${ray * 45})`}><g className="shimmer-ray"><line x1="0" y1="-19" x2="0" y2="-25" /></g></g>)}
            </svg>}{reveal?.kind === 'mine' && reveal.cell === i && <svg key={reveal.revision} className={`mine-burst${reduced ? ' reduced' : ''}`} viewBox="-32 -32 64 64" aria-hidden="true"><path className="blast-ring" d="M-9-17H9v4h4v4h4V9h-4v4H9v4H-9v-4h-4V9h-4V-9h4v-4h4Z" />{Array.from({ length: 8 }, (_, ray) => <g key={ray} transform={`rotate(${ray * 45})`}><g className="blast-ray"><line x1="0" y1="-18" x2="0" y2="-25" /></g></g>)}</svg>}</span>}
        </button>;
      })}
      {!r && !state.result && <div className="camp-card"><h2>DIG DEEP.<br/>EXTRACT ORBS.</h2></div>}
    </div>
    {touchControls && r && !r.ready && <span className="touch-start-hint">Tap to start</span>}
    {mineResult && revealReady && !paused && !menu && <div className="mine-result-overlay">
      <div className="camp-card mine-result-card" ref={mineOverlay} role="dialog" aria-labelledby="mine-result-title" tabIndex={-1}>
        <h2 id="mine-result-title">YOU HIT A MINE.</h2>
        <button className="primary" onClick={tryAgain}>Try again</button>
      </div>
    </div>}
    {r && !revealPending && <div className="walking-controls" inert={blocked || undefined}>
      <div className={`direction-pad${flagDirection ? ' choosing-flag' : ''}`} role="group" aria-label={flagDirection ? 'Choose a neighbour to flag' : 'Walk one tile'}>{(['left', 'up', 'flag', 'down', 'right'] as const).map(direction => direction === 'flag' ? <button key={direction} type="button" className="flag-toggle" aria-label="Flag a direction" aria-pressed={flagDirection} title={flagDirection ? 'Cancel flagging' : 'Flag, then choose a direction'} disabled={!r?.ready || blocked} onClick={toggleFlagDirection}><PixelIcon name="flag" /></button> : <button key={direction} data-direction={direction} data-can-flag={flagDirection && canFlagDirection(direction)} aria-label={`${flagDirection ? 'Flag' : 'Move'} ${direction}`} disabled={!r || (flagDirection && !canFlagDirection(direction))} onClick={() => move(direction)}><PixelIcon name={direction} /></button>)}</div>
      <span className="keyboard-hint">{!r?.ready ? 'Choose your first tile' : flagDirection ? 'Press a direction to flag · Esc to cancel' : 'Move: WASD / arrows · Flag: F, then direction'}</span>
    </div>}
    <aside className="dig-panel">
      {(r || state.result) && <div className="run-overview">
      <div className="wallet-stats">
        <div className={`bag stat${mineResult ? ' lost-haul' : ''}`}><span className="eyebrow">{mineResult ? 'LOST' : 'YOUR HAUL'}</span><strong data-testid="bag">{money(mineResult ? state.result!.amount : bag)}<small> RF</small></strong>{mineResult && <span className="entry-loss" data-testid="entry-loss">+ {money(state.result!.stake ?? ENTRY)} RF entry</span>}</div>
      </div>
      <div className="progress">{r && <span>{cleared}/{SIZE - r.mysteryCount} tiles cleared</span>}
      <span className="board-counter">{r || state.result ? `ORBS FOUND: ${r ? mysteryFound(r) : cells.filter(c=>c.mystery&&c.revealed&&!c.mine).length}/${counts?.orbs ?? 5}` : 'ORBS FOUND: 0/5'}</span>
      </div>
      </div>}
      <div className="reward-summary">
      <div className="level-rewards">
        <table className="level-budgets" aria-label="Rewards per level"><caption>RF Rewards</caption><colgroup><col /><col /><col /><col /></colgroup><thead><tr><th scope="col">Level</th><th scope="col">Ground finds</th><th scope="col">Each orb</th><th scope="col">Up to</th></tr></thead><tbody>{Array.from({ length: MAX_DEPTH }, (_, i) => i + 1).map(depth => {
          const maximum = levelMaximums[depth - 1], funded = r ? depth <= r.depth || canFundNext(state) : state.result ? true : maxPoolStake(state) >= stake;
          const ground = lootRange(depth, stake);
          return <tr key={depth} data-testid={`level-budget-${depth}`} data-funded={funded} className={r?.depth === depth ? 'current-level' : ''} aria-current={r?.depth === depth ? 'step' : undefined}><th scope="row">{depth}</th><td>{money(ground.min)}–{money(ground.max)}</td><td>{money(orbRewardAt(depth))}</td><td>{money(maximum)}{!funded && <span className="pool-shortfall">Pool too low</span>}</td></tr>;
        })}</tbody><tfoot><tr data-testid="level-budget-total"><th scope="row" colSpan={3}>MAX TOTAL</th><td>{money(totalMaximum)}</td></tr></tfoot></table>
      </div>
      </div>
      <div className="entry-controls">
      {!r && !state.result && <fieldset className="stake-picker" disabled={paused || !!menu} aria-label="Entry stake"><legend>Pay to enter · sim RF</legend><div className="stake-options">{shownStakes.map(value => <button key={String(value)} type="button" aria-label={`Stake ${money(value)} RF`} aria-pressed={canEnter && previewStake === value} disabled={value > cap} onClick={() => setSelectedStake(value)}>{money(value)}</button>)}</div>{!canEnter && <small>{state.wallets[String(friendId)] < ENTRY ? 'Not enough RF in wallet.' : 'No funded entry available.'}</small>}</fieldset>}
      <div className="expedition-actions" inert={blocked || undefined}>{mineResult ? null : !r ? <button className="primary" disabled={!canEnter} onClick={() => request({ type: 'enter', friend: String(friendId), stake })}>Enter mine <small>{money(stake)} sim RF ↘</small></button> : <>
        <button className="primary" onClick={() => setMenu('extract')}>Extract &amp; finish <small>{money(bag)} sim RF ↑</small></button>
        <button className="deeper" disabled={!canAdvance(r) || !canFundNext(state)} onClick={() => request({ type: 'advance' })}>{r.depth === MAX_DEPTH ? 'Deepest level' : 'Go deeper'}<small>{r.depth === MAX_DEPTH ? 'Extract to finish' : canAdvance(r) ? canFundNext(state) ? 'Higher rewards ↘' : 'Pool too low · extract' : boardCleared(r) ? 'Recover 1 orb' : 'Reveal ordinary ground'}</small></button>
      </>}</div>
      </div>
    </aside>
    <div className={`status${mineResult || !statusText ? ' status-quiet' : ''}`} role="status">{mineResult ? '' : statusText}</div>
    {sessionOnly && <span className="session-note">Session only · refresh resets</span>}
    <button aria-label="How to play ?" className="footer-help" disabled={blocked} onClick={() => setMenu('rules')}>How to play</button>
    {idleWarning && r && !paused && !menu && riskCell === null && <GameMenu title="Still digging?" footer={<><button onClick={() => dispatch({ type: 'continue' })}>Continue playing</button><button className="rf-frame-primary" onClick={() => setMenu('extract')}>Extract {money(bag)} RF</button></>}>
      <p>Your run ends in <b data-testid="idle-countdown">{Math.floor(idleSeconds / 60)}:{String(idleSeconds % 60).padStart(2, '0')}</b> without activity.</p>
      <p>Your <b>{money(runStake(r))} RF entry</b> will be returned. Your <b>{money(bag)} RF unbanked haul</b> will be discarded.</p>
    </GameMenu>}
    {menu === 'complete' && r && <GameMenu title="Level 3 cleared!" footer={<button type="button" className="rf-frame-primary" onClick={() => setMenu(null)}>Continue</button>}>
      <p>Congratulations! You uncovered all ordinary ground.</p>
      <p>Your haul stays at risk until you extract.</p>
    </GameMenu>}
    {menu === 'rules' && <GameMenu title="How to play" onClose={() => setMenu(null)}>
      <div className="how-to-play">
        <p className="rules-intro">One entry. Three levels. Extract before you hit a mine.</p>
        <ol>
          <li><b>Explore.</b> Your first square is safe. Walk into neighbouring tiles to reveal them.</li>
          <li><b>Read the clues.</b> Numbers count orbs and mines in the 8 surrounding tiles. Each level hides 5 of each.</li>
          <li><b>Collect RF.</b> Walk over ground finds or uncover orbs. A mine ends your run and loses your entire unbanked haul.</li>
          <li><b>Extract.</b> Press Extract &amp; finish anytime to bank your haul and end the run.</li>
          <li><b>Next level.</b> Reveal every ordinary tile and collect at least 1 orb on this level. Then press <b>Go deeper</b> for no extra entry fee. Your entire haul carries over and stays at risk: hit a mine and lose everything collected across all levels.</li>
        </ol>
        <dl className="rules-controls">
          <div><dt>Move</dt><dd>WASD / arrows, tap a neighbour, or use the direction pad.</dd></div>
          <div><dt>Flag</dt><dd>Tap the flag button, then a direction. Or use F then a direction, right-click or long-press. Tap flag again to cancel. Flags are your guesses.</dd></div>
          <div><dt>Place</dt><dd>Click your first square, or choose with arrows and press Enter / Space.</dd></div>
        </dl>
        <p className="rules-note">Idle for 10 minutes? Only your entry is refunded; your haul is discarded. All RF is simulated.</p>
      </div>
    </GameMenu>}
    {riskCell !== null && r && <GameMenu title="Risk opening this flag?" onClose={() => setRiskCell(null)} footer={<><button onClick={() => setRiskCell(null)}>Keep flagged</button><button className="rf-frame-primary" onClick={() => { if (!paused) { void sound.current?.unlock(); dispatch({ type: 'risk', cell: riskCell }); setRiskCell(null); } }}>Risk this tile</button></>}>
      <p>Your flag is a guess. This could be an orb worth <b>{money(runMysteryReward(r))} sim RF</b> or a mine. A mine ends your run{bag > 0n && <> and you lose your <b>{money(bag)} sim RF</b> haul</>}.</p>
    </GameMenu>}
    {menu === 'settings' && <GameMenu title="Expedition settings" onClose={() => setMenu(null)} footer={<div className="settings-links"><button onClick={() => setMenu('rules')}>How to play</button><button onClick={() => setMenu('reset')}>Reset simulation</button></div>}>
      <div className="settings-actions">
        {openFriendSelector && <button onClick={() => { setMenu(null); openFriendSelector(); }}>Choose Friend</button>}
        <button className="settings-sound" aria-label={muted ? 'Sound off' : 'Sound on'} aria-pressed={!muted} title={muted ? 'Turn sound on' : 'Turn sound off'} onClick={() => { const next = !muted; setMuted(next); sound.current?.setMuted(next); onSoundMutedChange?.(next); void sound.current?.unlock().then(ready => { if (ready && !next) sound.current?.play('select'); }); }}><SoundIcon muted={muted}/></button>
      </div>
      <p>{sessionOnly ? "Wallet ownership is verified by FriendSDK. Progress lasts only for this selected Friend session. Refreshing or changing account, network or Friend resets the simulation. Offline saves remain separate. All RF is simulated." : "Saved in this browser. One active game tab at a time. The samples use canonical artwork with no ownership claim. All RF is simulated."}</p>
      <div className="menu-actions">{topUp && <button onClick={() => { if (topUp()) setMenu(null); }}>Top up wallet to 500 RF</button>}{r && <button onClick={() => setMenu('abandon')}>Abandon run</button>}</div>
    </GameMenu>}
    {menu === 'extract' && r && <GameMenu title="Extract your haul?" onClose={() => setMenu(null)} footer={<><button onClick={() => setMenu(null)}>Keep digging</button><button className="rf-frame-primary" disabled={paused} onClick={() => { if (!paused && dispatch({ type: 'extract' })) { sound.current?.play('reveal-rare'); setMenu(null); } }}>Extract and return to camp</button></>}>
      <div className="result-number" data-testid="extraction-haul">{money(bag)} <small>SIM RF TO BANK</small></div>
      <p>Bank all collected RF in your Friend’s simulated balance and end this expedition.</p>
      <p>Uncollected finds and unopened orb rewards return to the shared pool.</p>
      {error && <p role="alert">{error}</p>}
    </GameMenu>}
    {menu === 'abandon' && <GameMenu title="Abandon this board?" onClose={() => setMenu(null)} footer={<><button onClick={() => setMenu(null)}>Keep digging</button><button className="rf-frame-primary" onClick={() => { dispatch({ type: 'abandon' }); setMenu(null); }}>Abandon run</button></>}><p>Your {money(bag)} unbanked simulated RF returns to the shared pool as lost loot. You can close this dialog and extract instead.</p></GameMenu>}
    {menu === 'reset' && <GameMenu title="Reset this local simulation?" onClose={() => setMenu('settings')} footer={<><button onClick={() => setMenu('settings')}>Cancel</button><button onClick={() => { reset(); setMenu(null); }}>{sessionOnly ? "Reset Friend & pool" : "Reset both Friends & pool"}</button></>}><p>{sessionOnly ? "Clear this session balance, board, pool and history. Your Friend starts with 20 sim RF; the mine starts with 1,000,000 simulated RF. Offline saves are unaffected." : "Clear both balances, the board, pool and history. Each sample starts with 20 sim RF; the mine starts with 1,000,000 simulated RF."}</p></GameMenu>}
    {state.result && (!mineResult) && <GameMenu title={state.result.kind === 'idle' ? 'Entry returned after inactivity.' : state.result.kind === 'extracted' ? 'Haul safely extracted.' : state.result.hit !== null ? 'Mine hit. Haul lost.' : 'Haul left behind.'} footer={<button className="rf-frame-primary" onClick={() => { setReveal(null); dispatch({ type: 'clearResult' }); }}>Return to camp</button>}>
      <div className="result-number">{money(state.result.amount)} <small>SIM RF {state.result.kind === 'idle' ? 'RETURNED' : state.result.kind === 'extracted' ? 'BANKED' : 'LOST'}</small></div>{state.result.kind === 'failed' && <div className="entry-loss result-entry-loss" data-testid="result-entry-loss">+ {money(state.result.stake ?? ENTRY)} RF entry</div>}<p>{state.result.reason}</p>{state.result.kind === 'idle' && <p data-testid="idle-discarded">{money(state.result.discarded ?? 0n)} sim RF unbanked haul returned to the shared pool.</p>}
      {state.result.hit !== null && <><div className="result-board" role="img" aria-label="The red square is the mine you hit. Hollow rings mark unopened sources: orb or mine. Filled rings mark recovered orbs.">{state.result.cells.map((c, i) => {
        const hit = i === state.result!.hit, unopened = c.mystery && !c.revealed && !hit;
        return <span key={i} style={portrait ? { gridRow: i % WIDTH + 1, gridColumn: Math.floor(i / WIDTH) + 1 } : undefined} className={hit ? 'hit' : unopened ? 'source-unopened' : c.mystery ? 'jackpot' : c.revealed ? 'safe' : ''}>{hit ? <PixelIcon name="mine" /> : unopened ? <i className="source-mark" aria-hidden><PixelIcon name="source" /></i> : c.mystery ? <PixelIcon name="orb" /> : c.revealed && c.adjacent ? c.adjacent : ''}</span>;
      })}</div><p className="result-legend"><i className="source-mark" aria-hidden><PixelIcon name="source" /></i> Unopened source · could be an orb or a mine.</p></>}
      <p>{state.result.kind === 'idle' ? 'Only the entry was refunded. The discarded haul was not added to your wallet.' : state.result.kind === 'failed' ? '100% of your unbanked haul is back in the shared pool for later runs to discover. Your banked balance is unchanged.' : 'Your unbanked haul is now safe in the selected Friend’s simulated balance.'}</p>
    </GameMenu>}
  </section>;
}
