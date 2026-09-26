import { sampleFriendSprites } from './canonical-sprites.js';
import './fonts/silkscreen.css';
import '@rarefriends/friendsdk/frame.css';
import { readGameSoundMuted, writeGameSoundMuted } from '@rarefriends/friendsdk/runtime';
import { createRoot } from 'react-dom/client';
import { useRef, useState, useEffect } from 'react';
import { GameFrame, GameMenu } from '@rarefriends/friendsdk/frame';
import { FRIENDS, initialState, transition, expireIdle, serialize, deserialize, migrateLegacy, seedPool, topUpWallet, type State, type Command } from './engine.js';
import DeepDig, { FriendAvatar } from './view.js';
import DescendConfirmation from './descend-confirmation.js';
import './style.css';
const KEY='deep-dig.offline.v4';
const FRIEND_OPTIONS=FRIENDS.map(id=>({id:BigInt(id),label:`Friend #${id} · ${id==='7730'?'Hoverer':'Skeleton'}`,kind:'sample' as const}));
function App(){
 const [soundMuted,setSoundMuted]=useState(()=>readGameSoundMuted('Deep Dig'));
 function rememberSound(muted:boolean){setSoundMuted(muted);writeGameSoundMuted('Deep Dig',muted);}
 const [loaded]=useState(()=>{try{const raw=localStorage.getItem(KEY),old=raw?null:(localStorage.getItem('deep-dig.offline.v3') ?? localStorage.getItem('deep-dig.offline.v2') ?? localStorage.getItem('deep-dig.offline.v1'));const original=raw?deserialize(raw):old?migrateLegacy(old):initialState(),state=expireIdle(seedPool(original));return {state,upgraded:state!==original||!!raw&&serialize(state)!==raw,error:''};}catch{return {state:initialState(),error:'The local save could not be read. Retry or explicitly reset this simulation.'};}});
 const [state,setState]=useState<State>(loaded.state),current=useRef(state),[fatal,setFatal]=useState(loaded.error),[resetSave,setResetSave]=useState(false),[error,setError]=useState('');
 const [friendPickerRequest,setFriendPickerRequest]=useState(0);
 const [selected,setSelected]=useState<bigint|null>(state.run?BigInt(state.run.friend):state.result?.kind==='idle'?BigInt(state.result.friend):null),[paused,setPaused]=useState(false),[confirmation,setConfirmation]=useState<Command|null>(null),confirming=useRef(false);
 const saved=useRef<string|null>(null),[now,setNow]=useState(Date.now);
 useEffect(()=>{const tick=()=>{setNow(Date.now());checkIdle();};const timer=setInterval(tick,1000);window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);};},[fatal]);
 useEffect(()=>{try{saved.current=localStorage.getItem(KEY);if(loaded.upgraded)commit(loaded.state);}catch{setFatal('Local storage is unavailable.');}} ,[]);
 useEffect(()=>{const change=(e:StorageEvent)=>{if(e.key===KEY||e.key===null)setFatal('This simulation changed in another tab. Close the other game tab, then reload to continue safely.');};window.addEventListener('storage',change);return()=>window.removeEventListener('storage',change);},[]);
 function commit(next:State){
  try { if(localStorage.getItem(KEY)!==saved.current)throw Error('Another game tab changed this save. Reload before continuing.');const raw=serialize(next);localStorage.setItem(KEY,raw);saved.current=raw;if(next.result?.kind==='idle'){confirming.current=false;setConfirmation(null);}current.current=next;setState(next);setError('');return true; }
  catch(e){setFatal(e instanceof Error?e.message:'Storage is unavailable. Allow local storage and retry.');return false;}
 }
 function checkIdle(){if(fatal)return false;try{const next=expireIdle(current.current);if(next===current.current)return false;commit(next);return true;}catch(e){setFatal(e instanceof Error?e.message:'The idle refund could not be saved.');return true;}}
 function dispatch(command:Command){if(fatal)return false;try{let next=transition(current.current,command);if(next===current.current)return false;const timedOut=!!current.current.run&&next.result?.kind==='idle';/* Settle and return to camp in one save; preserve timeout results. */if(command.type==='extract'&&next.result?.kind==='extracted')next=transition(next,{type:'clearResult'});return commit(next)&&!timedOut;}catch(e){setError(e instanceof Error?e.message:'The simulated action failed.');return false;}}
 function fundWallet(){if(fatal||selected===null)return false;try{return commit(topUpWallet(current.current,String(selected)));}catch(e){setError(e instanceof Error?e.message:'Wallet top-up failed.');return false;}}
 function request(command:Command){
  if(confirming.current||fatal||checkIdle())return;
  if(command.type!=='advance'){dispatch(command);return;}
  confirming.current=true;
  setConfirmation(command);
 }
 function select(id:bigint){if(current.current.run&&BigInt(current.current.run.friend)!==id){setError('Finish or abandon the current expedition before changing Friends.');return;}setSelected(id);setError('');}
 function reset(){try{const next=initialState(),raw=serialize(next);localStorage.setItem(KEY,raw);saved.current=raw;current.current=next;setState(next);setFatal('');setError('');setConfirmation(null);confirming.current=false;}catch{setFatal('Local storage is unavailable. Enable it, then retry.');}}
 return <GameFrame key={fatal?'recovery':state.result?.kind==='idle'?'idle-result':'play'} friendPickerRequest={friendPickerRequest} selectionMode={fatal?'host':'picker'} friends={FRIEND_OPTIONS} selectedFriendId={selected} onSelectFriend={select} renderFriendArtwork={friend=><span className="rf-friend-artwork"><FriendAvatar id={friend.id} sprites={sampleFriendSprites(friend.id)!}/></span>} mode="preview" wallet={{balance:selected?state.wallets[String(selected)]:undefined}} onMenuChange={setPaused} connection={<p className="offline-note">Offline canonical samples. No wallet, ownership checks, contracts or transactions.</p>}>
  {selected&&<DeepDig soundMuted={soundMuted} onSoundMutedChange={rememberSound} sprites={sampleFriendSprites(selected)!} friendId={selected} paused={paused||!!fatal||!!confirmation} state={state} now={now} dispatch={dispatch} request={request} reset={reset} topUp={fundWallet} openFriendSelector={()=>setFriendPickerRequest(value=>value+1)} error={error}/>}
  {confirmation&&state.run&&<DescendConfirmation run={state.run} onCancel={()=>{confirming.current=false;setConfirmation(null);}} onConfirm={()=>{if(!confirming.current)return;confirming.current=false;dispatch(confirmation);setConfirmation(null);}}/>}
  {resetSave?<GameMenu title="Reset saved simulation?" footer={<><button onClick={()=>setResetSave(false)}>Cancel reset</button><button onClick={()=>{reset();setResetSave(false);}}>Confirm reset</button></>}><p>This clears both sample wallets, pools, history and any expedition.</p></GameMenu>:fatal&&<GameMenu title="Local save needs attention" footer={<><button onClick={()=>location.reload()}>Retry / reload</button><button onClick={()=>{setResetSave(true);}}>Reset damaged save</button></>}><p role="alert">{fatal}</p><p>The game is paused; no further simulated RF has been spent.</p></GameMenu>}
 </GameFrame>;
}
createRoot(document.getElementById('root')!).render(<App/>);
