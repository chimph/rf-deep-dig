import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled=await build({entryPoints:[new URL('../games/deep-dig/engine.ts',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',write:false});
const E=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const {RF,SIZE,initialState,transition,total,sum,serialize,deserialize,migrateLegacy,neighbors,cardinalNeighbors,mysteryCount,mysteryReward,ordinaryBudget,lootRange,maxReserve,reserved,futureReserved,clearedCount,collectedCount,canAdvance}=E;
const t=(s,c,draw)=>transition(s,c,draw,s.run?.lastActivityAt??1000);
const seeded=(seed=42)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed%10000;};
const enter=(s=initialState(),friend='7730',draw=seeded())=>t(s,{type:'enter',friend},draw);
const start=(s=enter(),cell=34)=>t(s,{type:'dig',cell});
function route(r,target){const prev=new Map([[r.position,null]]),q=[r.position];for(let k=0;k<q.length;k++)for(const n of cardinalNeighbors(q[k]))if(!prev.has(n)&&(!r.cells[n].mystery||r.cells[n].revealed||n===target)){prev.set(n,q[k]);q.push(n);}assert.ok(prev.has(target),'target must be physically reachable');const p=[];for(let at=target;at!==r.position;at=prev.get(at))p.unshift(at);return p;}
function walk(s,target){for(const cell of route(s.run,target))s=t(s,{type:'dig',cell});return s;}
function collectGround(s){for(let i=0;i<SIZE;i++)if(!s.run.cells[i].mystery)s=walk(s,i);return s;}
function orb(s){const i=s.run.cells.findIndex(c=>c.mystery&&!c.mine&&!c.revealed);assert.ok(i>=0);return walk(s,i);}
function mine(s){const i=s.run.cells.findIndex(c=>c.mine);assert.ok(i>=0);return walk(s,i);}
const cacheAt=(s,i)=>s.run.caches.find(c=>c.cell===i);

test('verified-session simulation uses the selected ID, conserves its pool and leaves offline seeds unchanged',()=>{
 const offline=serialize(initialState());
 let s=E.initialSessionState(123456n);
 assert.deepEqual(Object.keys(s.wallets),['123456']);
 assert.equal(total(s),1_000_020n*RF);
 assert.throws(()=>t(s,{type:'enter',friend:'7730'}),/Choose a Friend/);
 s=t(s,{type:'enter',friend:'123456',stake:5n*RF},seeded());
 assert.equal(s.wallets['123456'],15n*RF);
 s=start(s);s=collectGround(s);s=orb(s);s=t(s,{type:'advance'},seeded(21));
 s=start(s);s=collectGround(s);s=t(s,{type:'extract'});
 assert.equal(s.result.friend,'123456');assert.equal(total(s),1_000_020n*RF);E.assertState(s);
 assert.equal(serialize(initialState()),offline);
 assert.throws(()=>E.initialSessionState(0n),/Invalid Friend ID/);
 assert.throws(()=>E.initialSessionState(1n<<256n),/Invalid Friend ID/);
});

function legacyBoard(prize=80n*RF/100n) {
 const s=enter(),r=s.run;s.pool+=reserved(r)+futureReserved(r);
 delete r.stake;delete r.future;delete r.layout;r.mysteryCount=8;r.hazards=r.hazards.slice(0,8);
 const ground=[...E.ordinaryAmounts(1),...Array(SIZE-20).fill(0n)];
 r.caches=Array.from({length:SIZE},(_,id)=>{const value=id<8?prize:ground[id-8];return{id,kind:id<8?'mystery':'ordinary',cell:null,opened:false,loot:value?[{name:'Legacy reward',amount:value}]:[]};});
 s.pool-=reserved(r);return s;
}

test('one admission and maximum source/ground reserves conserve all issued RF',()=>{
 const s=enter();assert.equal(s.version,4);assert.equal(s.wallets['7730'],19n*RF);assert.equal(s.pool+reserved(s.run)+futureReserved(s.run),1_000_001n*RF);
 assert.deepEqual([1,2,3].map(d=>maxReserve(d)),[524n,728n,1152n].map(n=>n*RF/100n));assert.equal(total(s),1_000_040n*RF);
});
test('each board has12 randomly placed finds, four of each size, with empty tiles',()=>{
 for(let depth=1,s=enter();depth<=3;depth++){
  const amounts=s.run.caches.filter(c=>c.kind==='ordinary').map(c=>sum(c.loot));
  assert.equal(amounts.filter(n=>n>0n).length,12);assert.equal(amounts.reduce((a,b)=>a+b,0n),ordinaryBudget(depth));
  for(const n of [1n,2n,3n])assert.equal(amounts.filter(x=>x===n*BigInt(depth)*RF/100n).length,4);
  assert.equal(amounts.filter(n=>n===0n).length,SIZE-mysteryCount(depth)-12);
  if(depth<3)s=t(orb(collectGround(start(s))),{type:'advance'},seeded(depth+80));
 }
 const a=enter(initialState(),'7730',seeded(1)),b=enter(initialState(),'7730',seeded(2));assert.notDeepEqual(a.run.caches.map(c=>sum(c.loot)),b.run.caches.map(c=>sum(c.loot)));
});
test('fixed five/five split is shuffled independently of source geometry and ground rewards',()=>{
 const states=[];for(const value of [0,4999,5000,9999]){let calls=0;const s=start(enter(initialState(),'7730',()=>{calls++;return calls>SIZE-1&&calls<=SIZE+8?value:1234;}));assert.equal(s.run.hazards.filter(Boolean).length,5);assert.equal(s.run.hazards.filter(h=>!h).length,5);states.push(s);}
 assert.ok(states.some(s=>JSON.stringify(s.run.hazards)!==JSON.stringify(states[0].run.hazards)));
 for(const s of states.slice(1)){assert.deepEqual(s.run.cells.map(c=>[c.mystery,c.adjacent]),states[0].run.cells.map(c=>[c.mystery,c.adjacent]));assert.deepEqual(s.run.caches.filter(c=>c.kind==='ordinary'),states[0].run.caches.filter(c=>c.kind==='ordinary'));assert.equal(E.runMaxReserve(s.run),maxReserve(1));}
});
test('all80 starts protect the first3x3 and produce correct8-neighbor clues',()=>{
 for(let first=0;first<SIZE;first++){const s=start(enter(initialState(),'7730',seeded(first+1)),first),r=s.run;
  assert.equal(r.position,first);assert.equal(r.start,first);assert.ok([first,...neighbors(first)].every(i=>!r.cells[i].mystery));
  for(let i=0;i<SIZE;i++)assert.equal(r.cells[i].adjacent,neighbors(i).filter(j=>r.cells[j].mystery).length);
  assert.equal(sum(r.bag),sum(cacheAt(s,first).loot));assert.equal(r.caches.filter(c=>c.opened).length,1);
 }
});
test('flood reveals finds without collecting them; walking onto each pays once',()=>{
 let s=start();const target=s.run.caches.find(c=>c.kind==='ordinary'&&c.loot.length&&!c.opened&&s.run.cells[c.cell].revealed);assert.ok(target);
 const before=sum(s.run.bag),amount=sum(target.loot);assert.ok(reserved(s.run)>=amount);
 s=walk(s,target.cell);assert.ok(sum(s.run.bag)>=before+amount);assert.equal(cacheAt(s,target.cell).opened,true);
 const haul=sum(s.run.bag),neighbor=cardinalNeighbors(target.cell).find(i=>!s.run.cells[i].mystery&&cacheAt(s,i).opened);assert.ok(neighbor!==undefined);
 s=walk(s,neighbor);s=walk(s,target.cell);assert.equal(sum(s.run.bag),haul);
});
test('empty ordinary tiles award zero and cleared ground can be revisited',()=>{
 let s=start();const target=s.run.caches.find(c=>c.kind==='ordinary'&&!c.loot.length&&!c.opened);const path=route(s.run,target.cell);
 for(const cell of path.slice(0,-1))s=t(s,{type:'dig',cell});const before=sum(s.run.bag);s=t(s,{type:'dig',cell:target.cell});assert.equal(sum(s.run.bag),before);assert.equal(s.run.position,target.cell);
});
test('cardinal walking rejects remote/diagonal digs atomically and cannot wrap rows',()=>{
 let s=start(enter(),9);for(const cell of [10,0,18,60]){const before=serialize(s);assert.throws(()=>t(s,{type:'dig',cell}),/neighbouring/);assert.equal(serialize(s),before);}
 s=t(s,{type:'dig',cell:8});assert.equal(s.run.facing,'left');s=t(s,{type:'dig',cell:9});assert.equal(s.run.facing,'right');assert.equal(t(s,{type:'dig',cell:9}),s);
});
test('flags annotate remote covered tiles, block walking and require adjacent explicit risk',()=>{
 let s=start();const target=s.run.cells.findIndex(c=>c.mystery&&!c.mine);s=t(s,{type:'flag',cell:target});const before=serialize(s);
 if(!cardinalNeighbors(s.run.position).includes(target))assert.throws(()=>t(s,{type:'risk',cell:target}),/next to/);
 assert.equal(serialize(s),before);const path=route(s.run,target);for(const cell of path.slice(0,-1))s=t(s,{type:'dig',cell});
 assert.equal(t(s,{type:'dig',cell:target}),s);const bag=sum(s.run.bag);s=t(s,{type:'risk',cell:target});assert.equal(sum(s.run.bag),bag+mysteryReward(1));assert.equal(s.run.position,target);assert.equal(s.run.cells[target].flagged,false);
});
test('wrongly flagged ordinary ground is still ordinary when explicitly risked',()=>{
 let s=enter();s=t(s,{type:'flag',cell:33});s=start(s);assert.equal(s.run.cells[33].revealed,false);const before=sum(s.run.bag),reward=sum(cacheAt(s,33).loot);
 s=t(s,{type:'risk',cell:33});assert.equal(sum(s.run.bag),before+reward);assert.equal(s.run.cells[33].mystery,false);
});
test('walking into a mine returns collected haul and all uncollected backing to one pool',()=>{
 let s=orb(collectGround(start()));const haul=sum(s.run.bag),bank=s.wallets['7730'];s=mine(s);
 assert.equal(s.run,null);assert.equal(s.result.kind,'failed');assert.equal(s.result.amount,haul);assert.equal(s.wallets['7730'],bank);assert.equal(s.pool,1_000_001n*RF);assert.equal(sum(s.lost),haul);assert.equal(total(s),1_000_040n*RF);
});
test('partial extraction banks collected RF only and ends the expedition without an orb',()=>{
 let s=t(enter(),{type:'flag',cell:33});s=start(s);const find=s.run.caches.find(c=>c.kind==='ordinary'&&c.loot.length&&c.cell!==33);s=walk(s,find.cell);
 assert.ok(s.run.cells.every(c=>!c.mystery||!c.revealed));assert.ok(clearedCount(s.run)<SIZE-s.run.mysteryCount);const haul=sum(s.run.bag);assert.ok(haul>0n);const released=s.pool+reserved(s.run)+futureReserved(s.run);
 s=t(s,{type:'extract'});assert.equal(s.run,null);assert.equal(s.wallets['7730'],19n*RF+haul);assert.equal(s.result.amount,haul);assert.equal(s.pool,released);assert.equal(total(s),1_000_040n*RF);
 assert.throws(()=>t(s,{type:'extract'}));assert.throws(()=>t(s,{type:'dig',cell:33}));
});
test('extracting immediately returns all reserves but never refunds entry',()=>{
 const s=t(enter(),{type:'extract'});assert.equal(s.pool,1_000_001n*RF);assert.equal(s.wallets['7730'],19n*RF);assert.equal(s.result.amount,0n);
});
test('descent requires ordinary reveal and current-floor orb, not all loot collection',()=>{
 let s=collectGround(start());assert.equal(sum(s.run.bag),ordinaryBudget(1));assert.equal(collectedCount(s.run),12);assert.equal(canAdvance(s.run),false);assert.throws(()=>t(s,{type:'advance'}),/orb/);
 s=orb(s);assert.equal(canAdvance(s.run),true);const bag=sum(s.run.bag);s=t(s,{type:'advance'},seeded(81));assert.equal(s.run.depth,2);assert.equal(sum(s.run.bag),bag);assert.equal(s.run.position,null);
 s=collectGround(start(s));assert.equal(canAdvance(s.run),false);assert.throws(()=>t(s,{type:'advance'}),/orb/);
});
test('early orb counts, additional orbs pay once, and no free chording exists',()=>{
 let s=orb(start(enter(initialState(),'7730',seeded(1))));const orbCount=s.run.cells.filter(c=>c.revealed&&c.mystery).length;assert.equal(orbCount,1);assert.equal(canAdvance(s.run),false);
 const before=sum(s.run.bag),position=s.run.position;s=t(s,{type:'dig',cell:position});assert.equal(sum(s.run.bag),before);
 s=collectGround(s);assert.equal(canAdvance(s.run),true);s=orb(s);assert.equal(sum(s.run.bag),ordinaryBudget(1)+2n*mysteryReward(1));
});
test('three depths retain one entry and arbitrary partial extraction with current-floor finds',()=>{
 let s=enter();for(let depth=1;depth<=3;depth++){
  const old=sum(s.run.bag);s=start(s);s=collectGround(s);assert.equal(sum(s.run.bag),old+ordinaryBudget(depth));
  const ended=t(s,{type:'extract'});assert.equal(ended.run,null);assert.equal(ended.result.amount,sum(s.run.bag));assert.equal(ended.wallets['7730'],19n*RF+sum(s.run.bag));
  if(depth<3)s=t(orb(s),{type:'advance'},seeded(depth+80));
 }
 assert.equal(sum(s.run.bag),380n*RF/100n);assert.throws(()=>t(s,{type:'advance'}),/bottom/);
});
test('admission shortfalls are atomic; fully backed descents work with no free pool',()=>{
 let s=initialState();s.wallets['7730']=1_000_039n*RF;s.wallets['3412']=0n;s.pool=RF;const before=serialize(s);assert.throws(()=>enter(s),/back/);assert.equal(serialize(s),before);
 s=orb(collectGround(start()));s.wallets['3412']+=s.pool;s.pool=0n;const raw=serialize(s),next=t(s,{type:'advance'});assert.equal(next.run.depth,2);assert.equal(serialize(s),raw);assert.equal(total(next),1_000_040n*RF);assert.equal(total(t(next,{type:'extract'})),1_000_040n*RF);
});
test('past-loss tags can be collected by another Friend without increasing rewards',()=>{
 let s=mine(collectGround(start()));const lost=sum(s.lost);assert.equal(lost,ordinaryBudget(1));s=collectGround(start(enter(s,'3412',()=>9999)));
 s=orb(s);assert.ok(s.run.bag.some(l=>l.owner==='7730'));const before=total(s);s=t(s,{type:'extract'});assert.equal(total(s),before);assert.ok(sum(s.lost)<lost);
});
test('committed board and finds survive reload without new rolls',()=>{
 const pending=enter();assert.deepEqual(start(pending),start(deserialize(serialize(pending))));let s=start(pending);s=t(s,{type:'flag',cell:s.run.cells.findIndex(c=>!c.revealed)});assert.deepEqual(deserialize(serialize(s)),s);
 const bad=structuredClone(s);bad.run.cells[34].adjacent=8;assert.throws(()=>deserialize(serialize(bad)),/Invalid/);
 const dup=structuredClone(s);const empty=dup.run.caches.find(c=>c.kind==='ordinary'&&!c.loot.length);empty.loot=[{name:'bad',amount:RF}];assert.throws(()=>deserialize(serialize(dup)));
});
test('saved 0.80 RF orb boards keep their backing and rewards; new boards offer 1 RF',()=>{
 const old=legacyBoard();
 const raw=serialize(old),loaded=deserialize(raw);
 assert.equal(serialize(loaded),raw);assert.equal(E.runMysteryReward(loaded.run),80n*RF/100n);
 assert.equal(E.runMaxReserve(loaded.run),664n*RF/100n);assert.equal(total(loaded),1_000_040n*RF);
 let s=orb(collectGround(start(loaded)));assert.equal(sum(s.run.bag),104n*RF/100n);
 s=deserialize(serialize(s));assert.equal(sum(s.run.bag),104n*RF/100n);
 s=t(s,{type:'extract'});s=orb(collectGround(start(enter(s))));
 assert.equal(E.runMysteryReward(s.run),RF);assert.equal(sum(s.run.bag),124n*RF/100n);assert.equal(total(s),1_000_040n*RF);
 const mixed=structuredClone(old);mixed.run.caches[0].loot[0].amount+=RF/5n;mixed.pool-=RF/5n;
 assert.throws(()=>deserialize(serialize(mixed)),/Invalid/,'one legacy prize cannot be mixed with new prizes');
 const arbitrary=structuredClone(old);for(const c of arbitrary.run.caches.filter(c=>c.kind==='mystery')){c.loot[0].amount-=RF/100n;arbitrary.pool+=RF/100n;}
 assert.throws(()=>deserialize(serialize(arbitrary)),/Invalid/,'only explicitly supported old rewards load');
});
test('v1/v2/v3 migration banks old carried RF and preserves single-pool accounting',()=>{
 for(const version of [1,2,3]){
  const caches=[{opened:true,loot:[{name:'earned',amount:RF/5n}]},{opened:false,loot:[{name:'reserved',amount:58n*RF/10n}]}];
  const old={version,revision:7,serial:2,wallets:{'7730':19n*RF,'3412':20n*RF},pool:(version===3?55n:54n)*RF,lost:[{name:'past',amount:RF,owner:'3412',run:1}],run:{friend:'7730',bag:[{name:'earned',amount:RF/5n}],...(version===1?{nodes:caches}:{caches})}};
  const migrated=migrateLegacy(serialize(old));assert.equal(migrated.version,4);assert.equal(migrated.wallets['7730'],192n*RF/10n);assert.equal(migrated.pool,608n*RF/10n);assert.equal(sum(migrated.lost),RF);assert.equal(migrated.run,null);assert.equal(total(migrated),100n*RF);
 }
 assert.throws(()=>migrateLegacy('{"version":3}'));
});
test('invalid commands and RNG fail atomically',()=>{
 const s=enter(),raw=serialize(s);assert.throws(()=>t(s,{type:'dig',cell:SIZE}));assert.equal(serialize(s),raw);
 assert.throws(()=>enter(initialState(),'7730',()=>10000));assert.throws(()=>enter(initialState(),'7730',()=>-1));assert.throws(()=>enter(initialState(),'7730',()=>.5));
});
test('mixed walking, flagging, extraction and loss conserve all issued RF',()=>{
 for(let seed=1;seed<=100;seed++){const draw=seeded(seed);let s=start(enter(initialState(),'7730',draw));for(let step=0;s.run&&step<80;step++){
   if(draw()<1000){s=t(s,{type:'extract'});break;}const near=cardinalNeighbors(s.run.position),cell=near[draw()%near.length];s=t(s,{type:'dig',cell});assert.equal(total(s),1_000_040n*RF);
  }if(s.run)s=t(s,{type:'abandon'});assert.equal(total(s),1_000_040n*RF);}
});


test('stake choices use clean rounding, wallet limits and full-run exposure',()=>{
 const s=initialState();assert.deepEqual(E.entryChoices(s,'7730'),[1n,2n,5n,10n,20n].map(n=>n*RF));
 s.wallets['7730']=100n*RF;s.pool-=80n*RF;assert.equal(E.maxEntryStake(s,'7730'),80n*RF);
 assert.equal(E.cleanStake(16n),15n);assert.equal(E.cleanStake(67n),60n);assert.equal(E.cleanStake(0n),0n);
 s.pool=12_019n*RF;assert.equal(E.maxEntryStake(s,'7730'),0n);
});
test('selected stakes scale exact prizes, reserve all floors and survive reload',()=>{
 for(const stake of [1n,2n,5n,10n,20n].map(n=>n*RF)){
  const original=initialState();let s=t(original,{type:'enter',friend:'7730',stake},seeded(42));
  assert.equal(s.wallets['7730'],20n*RF-stake);assert.equal(reserved(s.run)+futureReserved(s.run),E.fullRunReserve(stake));
  assert.equal(E.runMysteryReward(s.run),stake);s=deserialize(serialize(s));assert.equal(s.run.stake,stake);
  s=collectGround(start(s));assert.equal(sum(s.run.bag),ordinaryBudget(1,stake));
  s=orb(s);s=t(s,{type:'advance'},seeded(81));assert.equal(s.run.stake,stake);assert.equal(E.runMysteryReward(s.run),136n*stake/100n);
  s=collectGround(start(s));s=orb(s);s=t(s,{type:'advance'},seeded(82));assert.equal(futureReserved(s.run),0n);assert.equal(E.runMysteryReward(s.run),216n*stake/100n);
  s=collectGround(start(s));const haul=sum(s.run.bag);s=t(s,{type:'extract'});assert.equal(s.wallets['7730'],20n*RF-stake+haul);assert.equal(total(s),total(original));
 }
});
test('invalid, unaffordable and stale stakes never debit or create a run',()=>{
 const s=initialState(),raw=serialize(s);
 for(const stake of [0n,-RF,RF/2n,21n*RF,100n*RF])assert.throws(()=>t(s,{type:'enter',friend:'7730',stake}));
 assert.equal(serialize(s),raw);
 const poor=structuredClone(s);poor.wallets['7730']=0n;poor.pool+=20n*RF;assert.throws(()=>t(poor,{type:'enter',friend:'7730',stake:RF}));
});
test('exact counts and conditional odds track committed orbs, never flags',()=>{
 let s=start();const c=E.sourceCounts(s.run);assert.equal(c.orbs+c.mines,10);assert.equal(c.orbs,5);assert.equal(c.mines,5);assert.equal(c.orbs,s.run.hazards.filter(h=>!h).length);
 assert.equal(E.actualLevelMaximum(s.run),ordinaryBudget(1)+BigInt(c.orbs)*mysteryReward(1));
 s=t(s,{type:'flag',cell:s.run.cells.findIndex(c=>c.mine)});assert.deepEqual(E.sourceCounts(s.run),c);
 s=orb(s);assert.equal(E.sourceCounts(s.run).remainingOrbs,c.orbs-1);assert.equal(E.orbChance(s.run),Math.round(100*(c.orbs-1)/9));
 for(let i=1;i<5;i++)s=orb(s);assert.equal(E.sourceCounts(s.run).found,5);assert.equal(E.orbChance(s.run),0);assert.equal(E.sourceCounts(s.run).mines,5);
});
test('one-time seed upgrade preserves old wallets, board, haul, flags and provenance',()=>{
 const s=start(legacyBoard());
 const subtract=999_940n*RF;s.pool-=subtract;delete s.issued;delete s.poolSeeded;
 const original=deserialize(serialize(s)),upgraded=E.seedPool(original);
 assert.deepEqual(upgraded.wallets,original.wallets);assert.deepEqual(upgraded.run,original.run);assert.deepEqual(upgraded.lost,original.lost);
 assert.equal(upgraded.pool+reserved(upgraded.run)+sum(upgraded.run.bag),1_000_000n*RF);
 assert.equal(total(upgraded),upgraded.issued);assert.equal(E.seedPool(upgraded),upgraded);
 const after=t(upgraded,{type:'extract'});assert.equal(E.seedPool(after),after,'ordinary play must not refill the pool');
});
test('future backing is validated and returned on loss or abandonment exactly once',()=>{
 const s=enter(),bad=structuredClone(s);bad.run.future[0].amount-=RF;bad.pool+=RF;assert.throws(()=>deserialize(serialize(bad)));
 const badStake=structuredClone(s);badStake.run.stake=2n*RF;assert.throws(()=>deserialize(serialize(badStake)));
 for(const ended of [mine(collectGround(start(s))),t(s,{type:'abandon'})]){
  assert.equal(ended.pool,1_000_001n*RF);assert.equal(total(ended),1_000_040n*RF);assert.throws(()=>t(ended,{type:'abandon'}));
 }
});


test('all five orbs on every level pay exactly the full admitted backing at mixed stakes',()=>{
 for(const stake of [RF,5n*RF]){
  let s=t(initialState(),{type:'enter',friend:'7730',stake},seeded(52));
  s.wallets['3412']+=s.pool;s.pool=0n;
  for(let d=1;d<=3;d++){
   s=collectGround(start(s));while(E.mysteryFound(s.run)<5)s=orb(s);
   assert.equal(E.sourceCounts(s.run).remainingOrbs,0);assert.equal(reserved(s.run),0n);
   if(d<3){assert.equal(E.canFundNext(s),true);s=t(s,{type:'advance'},seeded(d+50));}
  }
  assert.equal(sum(s.run.bag),2404n*stake/100n);assert.equal(futureReserved(s.run),0n);
  const payout=sum(s.run.bag);s=t(s,{type:'extract'});assert.equal(s.result.amount,payout);assert.equal(total(s),1_000_040n*RF);
 }
});
test('five/five composition and empty mine reserves are enforced in saved games',()=>{
 const s=enter(),bad=structuredClone(s),i=bad.run.hazards.findIndex(h=>!h);bad.run.hazards[i]=true;
 assert.throws(()=>deserialize(serialize(bad)));
 const badMine=structuredClone(s),mineIndex=badMine.run.hazards.findIndex(Boolean);badMine.run.caches[mineIndex].loot=[{name:'bad',amount:RF}];badMine.pool-=RF;
 assert.throws(()=>deserialize(serialize(badMine)));
});


test('local wallet top-up preserves an active board, pool and other wallet; repeat never removes RF',()=>{
 const before=orb(collectGround(start())), original=serialize(before), next=E.topUpWallet(before,'7730');
 assert.equal(next.wallets['7730'],500n*RF);
 assert.equal(next.wallets['3412'],before.wallets['3412']);
 assert.equal(next.pool,before.pool);assert.deepEqual(next.run,before.run);assert.deepEqual(next.lost,before.lost);
 assert.equal(total(next)-total(before),500n*RF-before.wallets['7730']);
 assert.equal(serialize(before),original);assert.deepEqual(deserialize(serialize(next)),next);
 assert.equal(E.topUpWallet(next,'7730'),next);
 const richer={...next,wallets:{...next.wallets,'7730':501n*RF},issued:next.issued+RF};
 assert.equal(E.topUpWallet(richer,'7730'),richer);
 assert.throws(()=>E.topUpWallet(before,'unknown'));
});


test('seven-row saves gain an empty reachable row without rerolling or changing RF',async()=>{
 const {readFile}=await import('node:fs/promises');
 const raw=await readFile(new URL('./fixtures/deep-dig-seven-row.json',import.meta.url),'utf8');
 const old=JSON.parse(raw,(_,v)=>v?.$rf?BigInt(v.$rf):v),s=deserialize(raw);
 assert.equal(s.run.cells.length,80);assert.deepEqual(s.run.cells.slice(0,70),old.run.cells);
 assert.deepEqual(s.run.caches.slice(0,70),old.run.caches);assert.deepEqual(s.run.hazards,old.run.hazards);
 assert.deepEqual(s.wallets,old.wallets);assert.equal(total(s),total(old));assert.equal(s.pool,old.pool);
 assert.equal(s.run.position,old.run.position);assert.deepEqual(s.run.bag,old.run.bag);
 assert.ok(s.run.cells.slice(70).every(c=>!c.mystery&&!c.mine&&!c.revealed));
 const collected=collectGround(s);assert.equal(clearedCount(collected.run),70);
 assert.deepEqual(deserialize(serialize(s)),s);
 const result={...old,run:null,result:{kind:'failed',amount:sum(old.run.bag),depth:1,reason:'Old mine',cells:old.run.cells,hit:null,friend:'7730'}};
 result.pool+=reserved(old.run)+futureReserved(old.run)+sum(old.run.bag);
 assert.equal(deserialize(serialize(result)).result.cells.length,80);
});


test('idle refund replaces an empty, small or large haul and releases all backing once',()=>{
 for(const stake of [1n,5n,20n,80n])for(const mode of ['empty','ground','orb','third']){
  let s=transition(E.topUpWallet(initialState(),'7730'),{type:'enter',friend:'7730',stake:stake*RF},seeded(),1000);
  const initialWallet=s.wallets['7730']+stake*RF;
  if(mode!=='empty')s=collectGround(start(s));
  if(mode==='orb'||mode==='third')s=orb(s);
  if(mode==='third'){s=orb(collectGround(start(t(s,{type:'advance'},seeded(6)))));s=collectGround(start(t(s,{type:'advance'},seeded(8))));}
  const beforeTotal=total(s),discarded=sum(s.run.bag),deadline=E.idleDeadline(s.run);
  // Other accepted games may own all currently free funds. This run needs only its own backing.
  s.wallets['3412']+=s.pool;s.pool=0n;
  const ended=E.expireIdle(s,deadline);
  assert.equal(ended.run,null);assert.equal(ended.result.kind,'idle');assert.equal(ended.result.amount,stake*RF);
  assert.equal(ended.result.discarded,discarded);assert.equal(ended.wallets['7730'],initialWallet);assert.equal(total(ended),beforeTotal);
  assert.equal(E.expireIdle(ended,deadline+999999),ended);assert.throws(()=>transition(ended,{type:'continue'},seeded(),deadline+1));
  assert.equal(deserialize(serialize(ended),deadline+1).result.amount,stake*RF);
 }
});
test('only accepted actions restart the idle clock; entry, flag, movement, descent and continue count',()=>{
 let s=transition(initialState(),{type:'enter',friend:'7730'},seeded(),1000);
 assert.equal(s.run.lastActivityAt,1000);
 s=transition(s,{type:'dig',cell:34},seeded(),2000);assert.equal(s.run.lastActivityAt,2000);
 assert.equal(transition(s,{type:'dig',cell:34},seeded(),3000),s);
 assert.throws(()=>transition(s,{type:'dig',cell:0},seeded(),3000),/neighbour/);assert.equal(s.run.lastActivityAt,2000);
 const flag=s.run.cells.findIndex(c=>!c.revealed);
 s=transition(s,{type:'flag',cell:flag},seeded(),4000);assert.equal(s.run.lastActivityAt,4000);
 s=transition(s,{type:'flag',cell:flag},seeded(),5000);assert.equal(s.run.lastActivityAt,5000);
 s=transition(s,{type:'continue'},seeded(),6000);assert.equal(s.run.lastActivityAt,6000);
 s=orb(collectGround(s));s=transition(s,{type:'advance'},seeded(),7000);assert.equal(s.run.lastActivityAt,7000);
 assert.equal(E.expireIdle(s,7000+E.IDLE_TIMEOUT_MS-1),s);
 const backwards=transition(s,{type:'continue'},seeded(),6999);assert.equal(backwards.run.lastActivityAt,7000);
});
test('deadline wins over late gameplay, extraction and acknowledgement; a timely mine cannot be refunded',()=>{
 const s=orb(collectGround(start())),deadline=E.idleDeadline(s.run);
 for(const command of [{type:'extract'},{type:'advance'},{type:'continue'},{type:'dig',cell:0},{type:'flag',cell:0},{type:'risk',cell:0},{type:'abandon'}]){
  const ended=transition(s,command,seeded(),deadline);
  assert.equal(ended.result.kind,'idle');assert.equal(ended.result.amount,RF);assert.equal(ended.wallets['7730'],20n*RF);
 }
 const extracted=transition(s,{type:'extract'},seeded(),deadline-1);assert.equal(extracted.result.kind,'extracted');assert.equal(E.expireIdle(extracted,deadline),extracted);
 const failed=mine(start());assert.equal(failed.result.kind,'failed');assert.equal(E.expireIdle(failed,deadline+E.IDLE_TIMEOUT_MS),failed);assert.equal(failed.wallets['7730'],19n*RF);
});
test('reload keeps the deadline; pre-timeout saves get a one-time grace window without reroll or funding changes',()=>{
 const s=start(),r=s.run,at=r.lastActivityAt;
 assert.deepEqual(deserialize(serialize(s),at+590000),s);
 const legacy=structuredClone(s);delete legacy.run.lastActivityAt;
 const upgraded=deserialize(serialize(legacy),9000);
 assert.equal(upgraded.run.lastActivityAt,9000);assert.deepEqual(upgraded.run.cells,r.cells);assert.deepEqual(upgraded.run.caches,r.caches);assert.deepEqual(upgraded.wallets,s.wallets);assert.equal(total(upgraded),total(s));
 assert.equal(deserialize(serialize(upgraded),10000).run.lastActivityAt,9000);
 const expired=E.expireIdle(deserialize(serialize(upgraded),609000),609000);assert.equal(expired.result.kind,'idle');
 for(const invalid of [-1,null,1.2,Number.MAX_SAFE_INTEGER]){const bad=structuredClone(s);bad.run.lastActivityAt=invalid;assert.throws(()=>deserialize(serialize(bad)));}
});
