import rules from './game.json' with { type: 'json' };
import { WIDTH, SIZE, neighbors, cardinalNeighbors, sourcePositions, isReachableLayout } from './board.js';
export { WIDTH, HEIGHT, SIZE, neighbors, cardinalNeighbors } from './board.js';
export const RF = 10n ** 18n;
export const FRIENDS = ['7730', '3412'] as const;
export const ENTRY = BigInt(rules.price), MAX_DEPTH = 3;
export const IDLE_TIMEOUT_MS = 10 * 60_000, IDLE_WARNING_MS = 9 * 60_000;
export type Loot = { amount: bigint; name: string; owner?: string; run?: number };
export type Cell = { mystery: boolean; mine: boolean; adjacent: number; revealed: boolean; flagged: boolean };
/** opened means collected by visiting, not merely revealed by a flood. */
export type Cache = { id: number; kind: 'ordinary' | 'mystery'; cell: number | null; loot: Loot[]; opened: boolean };
export type Run = {
  id: number; friend: string; depth: number; mysteryCount: number; ready: boolean;
  /** Missing only on legacy saved boards. New runs lock a whole-RF stake and future backing. */
  stake?: bigint; future?: Loot[]; layout?: 'five-five';
  /** Persisted wall-clock activity; absent only on pre-timeout saves. */
  lastActivityAt?: number;
  cells: Cell[]; order: number[]; hazards: boolean[]; caches: Cache[]; bag: Loot[];
  start: number | null; position: number | null; facing: 'up' | 'down' | 'left' | 'right';
};
export type Result = { stake?: bigint; orbPrize?: bigint; maximum?: bigint; kind: 'extracted' | 'failed' | 'idle'; amount: bigint; discarded?: bigint; depth: number; reason: string; cells: Cell[]; hit: number | null; friend: string };
export type State = {
  sessionFriend?: string;
  version: 4; revision: number; issued?: bigint; poolSeeded?: boolean; wallets: Record<string, bigint>; pool: bigint;
  /** Tags describe part of available pool value, never extra balances. */
  lost: Loot[]; run: Run | null; serial: number; result: Result | null; history: string[];
};
export type Command = { type: 'enter'; friend: string; stake?: bigint } | { type: 'dig' | 'flag' | 'risk'; cell: number }
  | { type: 'advance' | 'extract' | 'abandon' | 'clearResult' | 'continue' };
export const sum = (loot: readonly Loot[]) => loot.reduce((n, l) => n + l.amount, 0n);
export const money = (n: bigint) => `${Number(n / (RF / 100n)) / 100}`;
export const validCell = (i: number) => Number.isInteger(i) && i >= 0 && i < SIZE;
export const level = (depth: number) => rules.deepDig.levels[depth - 1];
export const mysteryCount = (depth: number) => level(depth).mysteryTiles;
export const mysteryReward = (depth: number, stake = ENTRY) => BigInt(level(depth).mysteryReward) * stake / ENTRY;
export const ordinaryAmounts = (depth: number, stake = ENTRY) => level(depth).groundFinds.flatMap(f => Array.from({ length: f.count }, () => BigInt(f.reward) * stake / ENTRY));
export const ordinaryBudget = (depth: number, stake = ENTRY) => ordinaryAmounts(depth, stake).reduce((a, b) => a + b, 0n);
export const lootRange = (depth: number, stake = ENTRY) => {
  const a = ordinaryAmounts(depth, stake);
  return { min: a.reduce((x,y)=>x<y?x:y), max: a.reduce((x,y)=>x>y?x:y), count: a.length };
};
/** Compatibility: maximum find, not a guaranteed per-tile reward. */
export const ordinaryReward = (depth: number) => lootRange(depth).max;
export const maxReserve = (depth: number, stake = ENTRY) => ordinaryBudget(depth, stake) + BigInt(rules.deepDig.orbsPerLevel) * mysteryReward(depth, stake);
export const fullRunReserve = (stake = ENTRY, fromDepth = 1) => Array.from({ length: MAX_DEPTH - fromDepth + 1 }, (_, i) => maxReserve(fromDepth + i, stake)).reduce((a,b)=>a+b,0n);
export const runStake = (r: Run) => r.stake ?? ENTRY;
export const idleDeadline = (r: Run) => r.lastActivityAt === undefined ? Infinity : r.lastActivityAt + IDLE_TIMEOUT_MS;
function checkTime(now: number) { if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - IDLE_TIMEOUT_MS) throw Error('Invalid local clock.'); }
export const futureReserved = (r: Run | null) => sum(r?.future ?? []);
export function cleanStake(whole: bigint) {
  if (whole < 1n) return 0n;
  let power = 1n; while (power * 10n <= whole) power *= 10n;
  const step = power === 1n ? 1n : whole < power * 5n ? power / 2n : power;
  return whole / step * step;
}
/** Limit each new reservation to at most 1/500 of available funding. */
export const maxPoolStake = (s: State) => cleanStake(s.pool / (fullRunReserve() * 500n)) * RF;
export const maxEntryStake = (s: State, friend: string) => {
  const poolCap = maxPoolStake(s), walletCap = cleanStake((s.wallets[friend] ?? 0n) / RF) * RF;
  return poolCap < walletCap ? poolCap : walletCap;
};
export const STAKE_OPTIONS = [1n, 2n, 5n, 10n, 20n, 50n, 80n, 100n].map(n => n * RF);
export const entryChoices = (s: State, friend: string) => {
  const cap = maxEntryStake(s, friend), choices = STAKE_OPTIONS.filter(n=>n<=cap);
  return choices;
};
export const sourceCounts = (r: Run) => {
  const mines = r.hazards.filter(Boolean).length, orbs = r.mysteryCount - mines, found = mysteryFound(r);
  return { mines, orbs, found, remainingOrbs: orbs - found };
};
export const orbChance = (r: Run) => {
  const { mines, remainingOrbs } = sourceCounts(r), left = mines + remainingOrbs;
  return left ? Math.round(100 * remainingOrbs / left) : 0;
};
export const actualLevelMaximum = (r: Run) => sum(r.caches.filter(c=>c.kind==='ordinary').flatMap(c=>c.loot)) + BigInt(sourceCounts(r).orbs) * runMysteryReward(r);
/** A saved board keeps the rewards that were backed when it was entered. */
export const runMysteryReward = (r: Run) => r.caches.filter(c=>c.kind==='mystery').reduce((max,c)=>{const value=sum(c.loot);return value>max?value:max;},0n);
export const runMaxReserve = (r: Run) => sum(r.caches.flatMap(c => c.loot));
export const clearedCount = (r: Run) => r.cells.filter(c => c.revealed && !c.mystery).length;
export const collectedCount = (r: Run) => r.caches.filter(c => c.kind === 'ordinary' && c.opened && c.loot.length > 0).length;
export const boardCleared = (r: Run) => r.ready && clearedCount(r) === SIZE - r.mysteryCount;
export const mysteryFound = (r: Run) => r.cells.filter(c => c.mystery && c.revealed && !c.mine).length;
export const canAdvance = (r: Run) => boardCleared(r) && mysteryFound(r) > 0 && r.depth < MAX_DEPTH;
export const reserved = (r: Run | null) => sum(r?.caches.filter(c => !c.opened).flatMap(c => c.loot) ?? []);
export const canFundNext = (s: State) => !!s.run && s.run.depth < MAX_DEPTH && (s.run.future !== undefined ? futureReserved(s.run) >= fullRunReserve(runStake(s.run), s.run.depth + 1) : s.pool + reserved(s.run) >= fullRunReserve(runStake(s.run), s.run.depth + 1));
export const emptyCells = (): Cell[] => Array.from({ length: SIZE }, () => ({ mystery: false, mine: false, adjacent: 0, revealed: false, flagged: false }));
export function initialState(seed = 1_000_000n * RF): State {
  return { version: 4, revision: 0, issued: seed + 40n * RF, poolSeeded: seed === 1_000_000n * RF, wallets: Object.fromEntries(FRIENDS.map(id => [id, 20n * RF])), pool: seed,
    lost: [], run: null, serial: 0, result: null, history: ['Walk to reveal ground. Collect scattered RF. Extract anytime to finish.'] };
}
/** In-memory simulation for the Friend already verified by GameHost. No identity claim is made here. */
export function initialSessionState(friendId: bigint): State {
  if (friendId < 1n || friendId >= 1n << 256n) throw Error('Invalid Friend ID.');
  const s = initialState();
  s.sessionFriend = String(friendId);
  s.wallets = { [s.sessionFriend]: 20n * RF };
  s.issued = s.pool + 20n * RF;
  assertState(s);
  return s;
}
const participants = (s: State): readonly string[] => s.sessionFriend === undefined ? FRIENDS : [s.sessionFriend];
/** Local preview funding: issue only the difference, without taking from the reward pool. */
export function topUpWallet(state: State, friend: string): State {
  assertState(state);
  if (!participants(state).includes(friend)) throw Error('Choose the session Friend first.');
  const added = 500n * RF - state.wallets[friend];
  if (added <= 0n) return state;
  const s = structuredClone(state);
  s.wallets[friend] += added; s.issued = (s.issued ?? 100n * RF) + added; s.revision++;
  log(s, `Wallet topped up to 500 simulated RF.`);
  assertState(s); return s;
}
/** One-time local seed upgrade. Preserve wallets, committed boards and tagged losses. */
export function seedPool(state: State): State {
  assertState(state); if (state.poolSeeded) return state;
  const s = structuredClone(state), global = s.pool + reserved(s.run) + futureReserved(s.run) + sum(s.run?.bag ?? []);
  const added = global < 1_000_000n * RF ? 1_000_000n * RF - global : 0n;
  s.issued = (s.issued ?? 100n * RF) + added; s.pool += added; s.poolSeeded = true; s.revision++;
  log(s, `Added ${money(added)} simulated RF to the reward pool. Your wallet and current board are unchanged.`);
  assertState(s); return s;
}
function log(s: State, text: string) { s.history = [text, ...s.history].slice(0, 8); }
function roll(draw: () => number) { const n=draw(); if (!Number.isInteger(n)||n<0||n>=10000) throw Error('Roll must be 0–9999.'); return n; }
function shuffle(size: number, draw: () => number): number[] {
  const order=Array.from({length:size},(_,i)=>i);
  for(let i=size-1;i>0;i--){const j=Math.floor(roll(draw)/10000*(i+1));[order[i],order[j]]=[order[j],order[i]];} return order;
}
function take(s: State, amount: bigint, name: string): Loot[] {
  if(!amount)return [];
  let remaining=amount;const loot:Loot[]=[];
  s.lost=s.lost.flatMap(l=>{const part=l.amount<remaining?l.amount:remaining;remaining-=part;if(part)loot.push({...l,name,amount:part});return part<l.amount?[{...l,amount:l.amount-part}]:[];});
  if(remaining)loot.push({name,amount:remaining});s.pool-=amount;return loot;
}
function returnUncollected(s: State) {
  for(const c of s.run?.caches??[])if(!c.opened){s.pool+=sum(c.loot);s.lost.push(...c.loot.filter(l=>l.owner));c.opened=true;}
}
function returnFuture(s: State) {
  if (!s.run?.future) return;
  s.pool += sum(s.run.future); s.lost.push(...s.run.future.filter(l=>l.owner)); s.run.future = [];
}
function fail(s: State, reason: string, hit: number|null=null) {
  const r=s.run!;returnUncollected(s);returnFuture(s);const amount=sum(r.bag);s.pool+=amount;
  s.lost.push(...r.bag.map(l=>({...l,owner:r.friend,run:r.id})));
  s.result={stake:runStake(r),orbPrize:runMysteryReward(r),maximum:actualLevelMaximum(r),kind:'failed',amount,depth:r.depth,reason,cells:r.cells,hit,friend:r.friend};
  log(s,`Friend #${r.friend} lost ${money(amount)} RF at depth ${r.depth}. It is back in the shared pool.`);s.run=null;
}
function createFloor(s: State, friend: string, depth: number, draw: ()=>number, requestedStake = ENTRY) {
  if(depth>MAX_DEPTH)throw Error('Depth 3 is the bottom. Extract your haul.');
  if(!participants(s).includes(friend))throw Error('Choose a Friend in this simulation.');
  const entering=!s.run, stake=s.run?runStake(s.run):requestedStake;
  if(typeof stake!=='bigint'||stake<RF||stake%RF!==0n)throw Error('Choose a positive whole-RF stake.');
  if(entering&&stake>maxEntryStake(s,friend))throw Error('This stake exceeds your wallet or the available backing limit. Choose a smaller stake.');
  returnUncollected(s);returnFuture(s);
  if(s.pool+(entering?stake:0n)<fullRunReserve(stake,depth))throw Error(`The pool cannot back the remaining levels. No charge taken; extraction remains available.`);
  if(entering){s.wallets[friend]-=stake;s.pool+=stake;}
  const count=mysteryCount(depth),order=shuffle(SIZE,draw);
  // Shuffle a fixed five/five split independently of source geometry.
  const hazards=shuffle(count,draw).map(i=>i<rules.deepDig.minesPerLevel);
  const groundOrder=shuffle(SIZE-count,draw),amounts=Array<bigint>(SIZE-count).fill(0n);
  ordinaryAmounts(depth,stake).forEach((amount,i)=>{amounts[groundOrder[i]]=amount;});
  const caches:Cache[]=Array.from({length:SIZE},(_,id)=>{const kind=id<count?'mystery':'ordinary';return{id,kind,cell:null,loot:take(s,kind==='mystery'?(hazards[id]?0n:mysteryReward(depth,stake)):amounts[id-count],kind==='mystery'?'Resonant orb':'Scattered RF'),opened:false};});
  const future=depth<MAX_DEPTH?take(s,fullRunReserve(stake,depth+1),'Future level backing'):[];
  const old=s.run;s.run={stake,future,layout:'five-five',id:old?.id??++s.serial,friend,depth,mysteryCount:count,ready:false,cells:emptyCells(),order,hazards,caches,bag:old?.bag??[],start:null,position:null,facing:'down'};s.result=null;
  log(s,`Depth ${depth}: ${lootRange(depth).count} scattered finds, ${money(ordinaryBudget(depth,stake))} RF total. ${count-hazards.filter(Boolean).length} orbs worth ${money(mysteryReward(depth,stake))} RF each and ${hazards.filter(Boolean).length} mines. Choose your first step.`);
}
function layBoard(r: Run, first: number) {
  const sources=sourcePositions(r.order,first,r.mysteryCount);
  sources.forEach((i,index)=>{r.cells[i].mystery=true;r.cells[i].mine=r.hazards[index];});
  r.cells.forEach((c,i)=>{c.adjacent=neighbors(i).filter(j=>r.cells[j].mystery).length;});
  const ordinary=r.order.filter(i=>!r.cells[i].mystery);
  r.caches.forEach((c,i)=>{c.cell=c.kind==='mystery'?sources[i]:ordinary[i-r.mysteryCount];});r.start=first;r.ready=true;
}
/** Floods reveal, but only stepping on a find collects its RF. */
function revealGround(r: Run, at: number) {
  const queue=[at],seen=new Set<number>();let count=0;
  while(queue.length){const i=queue.pop()!,c=r.cells[i];if(seen.has(i)||c.flagged||c.mine)continue;seen.add(i);
    if(!c.revealed){c.revealed=true;count++;}
    if(!c.mystery&&c.adjacent===0)for(const j of neighbors(i))if(!r.cells[j].mystery&&!r.cells[j].revealed)queue.push(j);
  }return count;
}
function walk(s: State, cell: number) {
  const r=s.run!,previous=r.position;
  if(!r.ready)layBoard(r,cell);
  else if(previous!==null&&!cardinalNeighbors(previous).includes(cell))throw Error('Walk to a neighbouring tile with arrows / WASD, or tap a neighbour. Remote digging is disabled.');
  if(previous!==null)r.facing=cell===previous-WIDTH?'up':cell===previous+WIDTH?'down':cell<previous?'left':'right';
  if(r.cells[cell].mine){r.cells[cell].revealed=true;fail(s,'That resonance source was a mine. All carried RF returns to the shared pool.',cell);return;}
  const revealed=revealGround(r,cell),cache=r.caches.find(c=>c.cell===cell)!;
  const found=cache.opened?[]:cache.loot;cache.opened=true;r.bag.push(...found);r.position=cell;
  if(found.length)log(s,`${cache.kind==='mystery'?'Orb recovered':'Ground find collected'}: +${money(sum(found))} sim RF${found.some(l=>l.owner)?' · recovered lost RF':''}. Extract anytime to bank your haul.`);
  else if(revealed)log(s,`${revealed} ordinary tiles revealed. No RF on this tile. Walk onto visible finds to collect them.`);
  if(boardCleared(r))log(s,r.depth===MAX_DEPTH?'Ordinary ground revealed. Collect remaining finds or extract to finish.':mysteryFound(r)?'Ordinary ground revealed and orb recovered. Collect remaining finds, go deeper, or extract.':'Ordinary ground revealed. Find an orb to go deeper, or extract your collected haul now.');
}
/** Idempotent local settlement. Timers and every command share this same deadline check. */
export function expireIdle(state: State, now = Date.now()): State {
  checkTime(now);
  if (!state.run || now < idleDeadline(state.run)) return state;
  const s = structuredClone(state), r = s.run!, stake = runStake(r), discarded = sum(r.bag);
  if (reserved(r) + futureReserved(r) + discarded < stake) throw Error('The saved run cannot back its idle refund.');
  returnUncollected(s); returnFuture(s);
  s.pool += discarded;
  s.lost.push(...r.bag.map(l => ({ ...l, owner: r.friend, run: r.id })));
  // Remove value and its provenance tags together, so tags never exceed the available pool.
  take(s, stake, 'Idle entry refund'); s.wallets[r.friend] += stake;
  s.result = { kind: 'idle', stake, amount: stake, discarded, orbPrize: runMysteryReward(r), maximum: actualLevelMaximum(r), depth: r.depth,
    reason: 'Ten minutes without activity. Your entry was returned; your unbanked haul was discarded.', cells: r.cells, hit: null, friend: r.friend };
  s.run = null; s.revision++;
  log(s, `Idle run ended: ${money(stake)} RF entry returned; ${money(discarded)} RF haul returned to the pool.`);
  assertState(s); return s;
}
export function transition(state: State, command: Command, draw=()=>Math.floor(Math.random()*10000), now = Date.now()): State {
  const expired = expireIdle(state, now);
  if (expired !== state) return expired; // Expiry wins over any action at or after the deadline.
  const s=structuredClone(state),r=s.run;
  if(command.type==='clearResult')s.result=null;
  else if(command.type==='enter'){if(r)throw Error('An expedition is already active.');createFloor(s,command.friend,1,draw,command.stake ?? ENTRY);}
  else{
    if(!r)throw Error('Start an expedition first.');
    if(command.type==='flag'||command.type==='dig'||command.type==='risk'){
      if(!validCell(command.cell))throw Error('Choose a square inside the board.');const c=r.cells[command.cell];
      if(command.type==='flag'){if(c.revealed)return state;c.flagged=!c.flagged;}
      else{
        if(command.type==='risk'){if(!r.ready||r.position===null||!cardinalNeighbors(r.position).includes(command.cell)||!c.flagged)throw Error('Walk next to a flagged tile before choosing to risk it.');c.flagged=false;}
        else if(c.flagged||r.position===command.cell)return state;
        walk(s,command.cell);
      }
    }else if(command.type==='advance'){
      if(r.depth===MAX_DEPTH)throw Error('Depth 3 is the bottom. Extract your haul.');
      if(!boardCleared(r))throw Error('Reveal all ordinary ground and recover an orb on this level to descend.');
      if(!mysteryFound(r))throw Error('Recover an orb on this level to descend. You can extract instead.');
      createFloor(s,r.friend,r.depth+1,draw);
    }else if(command.type==='extract'){
      returnUncollected(s);returnFuture(s);const amount=sum(r.bag);s.wallets[r.friend]+=amount;
      s.result={stake:runStake(r),orbPrize:runMysteryReward(r),maximum:actualLevelMaximum(r),kind:'extracted',amount,depth:r.depth,reason:'All collected RF is banked. This expedition has ended.',cells:r.cells,hit:null,friend:r.friend};
      log(s,`Friend #${r.friend} banked ${money(amount)} RF from depth ${r.depth}.`);s.run=null;
    }else if(command.type==='abandon')fail(s,'Expedition abandoned. All carried RF returns to the pool.');
    // 'continue' is the explicit acknowledgement on the inactivity warning.
  }
  if (s.run && command.type !== 'clearResult') s.run.lastActivityAt = Math.max(now, r?.lastActivityAt ?? now);
  s.revision++;assertState(s);return s;
}
export const total=(s:State)=>Object.values(s.wallets).reduce((a,b)=>a+b,0n)+s.pool+reserved(s.run)+futureReserved(s.run)+sum(s.run?.bag??[]);
function validCells(cells:Cell[]){return Array.isArray(cells)&&cells.length===SIZE&&cells.every(c=>c&&typeof c.mystery==='boolean'&&typeof c.mine==='boolean'&&(!c.mine||c.mystery)&&typeof c.revealed==='boolean'&&typeof c.flagged==='boolean'&&Number.isInteger(c.adjacent)&&c.adjacent>=0&&c.adjacent<=8&&!(c.revealed&&c.flagged));}
export function assertState(s:State){
  const invalid=():never=>{throw Error('Invalid simulation save. Use Reset simulation to start fresh.');};
  if(!s||s.version!==4||!Number.isSafeInteger(s.revision)||s.revision<0||!Number.isSafeInteger(s.serial)||s.serial<0)invalid();
  if(s.sessionFriend!==undefined&&(typeof s.sessionFriend!=='string'||! /^[1-9][0-9]{0,77}$/.test(s.sessionFriend)||BigInt(s.sessionFriend)>=(1n<<256n)))invalid();
  if(!s.wallets||Object.keys(s.wallets).length!==participants(s).length||participants(s).some(id=>typeof s.wallets[id]!=='bigint'||s.wallets[id]<0n)||typeof s.pool!=='bigint'||s.pool<0n)invalid();
  if(!Array.isArray(s.lost)||!Array.isArray(s.history)||s.history.length>8||s.history.some(line=>typeof line!=='string'))invalid();
  if(s.run!==null){const r=s.run;
    if(!r||!participants(s).includes(r.friend)||!Number.isSafeInteger(r.id)||r.id<1||r.id>s.serial||!Number.isInteger(r.depth)||r.depth<1||r.depth>MAX_DEPTH||r.mysteryCount!==(r.layout==='five-five'?mysteryCount(r.depth):[8,12,16][r.depth-1])||typeof r.ready!=='boolean'||!validCells(r.cells)||!['up','down','left','right'].includes(r.facing))invalid();
    if(!Array.isArray(r.bag)||!Array.isArray(r.caches)||r.caches.length!==SIZE||!Array.isArray(r.hazards)||r.hazards.length!==r.mysteryCount||r.hazards.some(h=>typeof h!=='boolean'))invalid();
    if(r.caches.some((c,i)=>!c||c.id!==i||c.kind!==(i<r.mysteryCount?'mystery':'ordinary')||typeof c.opened!=='boolean'||!Array.isArray(c.loot)))invalid();
    if(!Array.isArray(r.order)||r.order.length!==SIZE||new Set(r.order).size!==SIZE||r.order.some(i=>!validCell(i)))invalid();
    if(r.layout!==undefined&&r.layout!=='five-five')invalid();
    if(r.lastActivityAt!==undefined&&(!Number.isSafeInteger(r.lastActivityAt)||r.lastActivityAt<0||r.lastActivityAt>Number.MAX_SAFE_INTEGER-IDLE_TIMEOUT_MS))invalid();
    if(r.layout==='five-five'&&(r.stake===undefined||r.hazards.filter(Boolean).length!==5))invalid();
    if(r.stake!==undefined&&(typeof r.stake!=='bigint'||r.stake<RF||r.stake%RF!==0n||!Array.isArray(r.future)||futureReserved(r)!==(r.depth<MAX_DEPTH?(r.layout==='five-five'?fullRunReserve(r.stake,r.depth+1):Array.from({length:MAX_DEPTH-r.depth},(_,i)=>{const d=r.depth+i+1;return ordinaryBudget(d,r.stake!)+BigInt([8,12,16][d-1])*mysteryReward(d,r.stake!);}).reduce((a,b)=>a+b,0n)):0n)))invalid();
    if(r.stake===undefined&&r.future!==undefined)invalid();
    const amounts=r.caches.filter(c=>c.kind==='ordinary').map(c=>sum(c.loot)).sort((a,b)=>a<b?-1:a>b?1:0);
    const expected=[...ordinaryAmounts(r.depth,runStake(r)),...Array<bigint>(SIZE-r.mysteryCount-lootRange(r.depth).count).fill(0n)].sort((a,b)=>a<b?-1:a>b?1:0);
    const orbPrize=runMysteryReward(r),knownPrize=orbPrize===mysteryReward(r.depth,runStake(r))||(r.stake===undefined&&r.depth===1&&orbPrize===80n*RF/100n);
    if(amounts.some((n,i)=>n!==expected[i])||!knownPrize||r.caches.filter(c=>c.kind==='mystery').some((c,i)=>sum(c.loot)!==(r.layout==='five-five'&&r.hazards[i]?0n:orbPrize)))invalid();
    if(r.ready){
      if(r.start===null||!validCell(r.start)||r.position===null||!validCell(r.position)||!r.cells[r.position].revealed)invalid();
      const sources=r.cells.flatMap((c,i)=>c.mystery?[i]:[]);
      const first=r.start!;
      if(sources.length!==r.mysteryCount||!isReachableLayout(sources)||[first,...neighbors(first)].some(i=>r.cells[i].mystery))invalid();
      if(r.cells.some((c,i)=>(c.mine&&c.revealed)||c.adjacent!==neighbors(i).filter(j=>r.cells[j].mystery).length))invalid();
      if(new Set(r.caches.map(c=>c.cell)).size!==SIZE||r.caches.some((c,i)=>c.cell===null||!validCell(c.cell)||r.cells[c.cell].mystery!==(c.kind==='mystery')||(c.opened&&!r.cells[c.cell].revealed)||(c.kind==='mystery'&&(c.opened!==r.cells[c.cell].revealed||r.cells[c.cell].mine!==r.hazards[i]))))invalid();
      if(!r.caches.find(c=>c.cell===r.position)?.opened)invalid();
    }else if(r.cells.some(c=>c.mystery||c.mine||c.revealed||c.adjacent!==0)||r.caches.some(c=>c.cell!==null||c.opened)||r.position!==null||r.start!==null)invalid();
  }
  const loot=[...s.lost,...(s.run?[...s.run.bag,...(s.run.future??[]),...s.run.caches.flatMap(c=>c.loot)]:[])];
  if(loot.some(l=>!l||typeof l.amount!=='bigint'||l.amount<=0n||typeof l.name!=='string'||(l.owner!==undefined&&(!participants(s).includes(l.owner)||!Number.isSafeInteger(l.run)||l.run!<1))))invalid();
  if(s.lost.some(l=>!l.owner)||sum(s.lost)>s.pool)invalid();
  if(s.result!==null&&(!s.result||!['failed','extracted','idle'].includes(s.result.kind)||!participants(s).includes(s.result.friend)||typeof s.result.amount!=='bigint'||s.result.amount<0n||typeof s.result.reason!=='string'||!Number.isInteger(s.result.depth)||s.result.depth<1||s.result.depth>MAX_DEPTH||!validCells(s.result.cells)||(s.result.hit!==null&&(!validCell(s.result.hit)||!s.result.cells[s.result.hit].mine))||s.run!==null))invalid();
  if(s.result&&['stake','orbPrize','maximum'].some(key=>{const v=s.result![key as 'stake'|'orbPrize'|'maximum'];return v!==undefined&&(typeof v!=='bigint'||v<0n);}))invalid();
  if(s.result?.kind==='idle'&&(s.result.stake===undefined||s.result.amount!==s.result.stake||typeof s.result.discarded!=='bigint'||s.result.discarded<0n||s.result.hit!==null))invalid();
  if(s.issued!==undefined&&(typeof s.issued!=='bigint'||s.issued<100n*RF))invalid();
  if(s.poolSeeded!==undefined&&typeof s.poolSeeded!=='boolean')invalid();
  if(total(s)!==(s.issued??100n*RF))invalid();
}
export const serialize=(s:State)=>JSON.stringify(s,(_,v)=>typeof v==='bigint'?{$rf:v.toString()}:v);
const parse=(raw:string)=>JSON.parse(raw,(_,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$rf==='string'&&/^\d+$/.test(v.$rf)?BigInt(v.$rf):v);
export function deserialize(raw:string, now = Date.now()):State{
  checkTime(now);
  const s:State=parse(raw);
  // Extend old boards without rerolling any committed tile or moving RF.
  if(s?.version===4){
    const extend=(cells:Cell[])=>{
      const extra=emptyCells().slice(70);
      for(let i=70;i<SIZE;i++)extra[i-70].adjacent=neighbors(i).filter(j=>cells[j]?.mystery).length;
      cells.push(...extra);
    };
    const r=s.run;
    if(r?.cells?.length===70&&r.caches?.length===70&&r.order?.length===70){
      extend(r.cells);
      for(let i=70;i<SIZE;i++){r.order.push(i);r.caches.push({id:i,kind:'ordinary',cell:r.ready?i:null,loot:[],opened:false});}
      s.revision++;
    }
    if(s.result?.cells?.length===70){extend(s.result.cells);s.revision++;}
    if(r && r.lastActivityAt===undefined){r.lastActivityAt=now;s.revision++;}
  }
  assertState(s);return s;
}
/** Preserve old balances and settle retired boards without loss; originals stay under old keys. */
export function migrateLegacy(raw:string):State{
  const old=parse(raw);if(![1,2,3].includes(old?.version)||!Array.isArray(old.lost)||!old.wallets||typeof old.pool!=='bigint')throw Error('The previous local save is invalid.');
  const s=initialState(60n*RF);s.wallets=old.wallets;s.pool=old.pool+(old.version<3?sum(old.lost):0n);s.lost=old.lost;s.revision=old.revision;s.serial=old.serial;
  if(old.run){const caches=old.version===1?old.run.nodes:old.run.caches;if(!FRIENDS.includes(old.run.friend)||!Array.isArray(caches)||!Array.isArray(old.run.bag))throw Error('The previous expedition is invalid.');
    s.wallets[old.run.friend]+=sum(old.run.bag);for(const c of caches)if(!c.opened){s.pool+=sum(c.loot);s.lost.push(...c.loot.filter((l:Loot)=>l.owner));}}
  s.history=['Walking update: old balances kept, carried RF banked, uncollected rewards returned to the shared pool.'];assertState(s);return s;
}
