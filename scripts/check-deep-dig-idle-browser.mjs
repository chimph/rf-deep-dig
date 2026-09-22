/** Isolated browser origins and fake wall clocks. Never reads the user's local save. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {buildDeepDig} from './deep-dig.mjs';
import {createGameServer} from './dev-game.mjs';
const built=await buildDeepDig(),server=createGameServer(built.outdir);
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
const origin=`http://127.0.0.1:${server.address().port}`,KEY='deep-dig.offline.v4',RF=10n**18n,START=2_000_000;
await mkdir('work/deep-dig-checks',{recursive:true});
const browser=await chromium.launch({headless:true});
function path(r,target){const q=[r.position],prev=new Map([[r.position,null]]);for(const i of q)for(const j of [i-10,i+10,...(i%10?[i-1]:[]),...(i%10<9?[i+1]:[])].filter(j=>j>=0&&j<80))if(!prev.has(j)&&!r.cells[j].mystery){prev.set(j,i);q.push(j);}const result=[];assert.ok(prev.has(target));for(let i=target;i!==r.position;i=prev.get(i))result.unshift(i);return result;}
try{
 for(const [width,height,touch] of [[1100,820,false],[390,844,true]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(start=>{Date.now=()=>Number(sessionStorage.getItem('idle-check-clock')??start);let n=734;Math.random=()=>{n=(n*1664525+1013904223)>>>0;return n/2**32;};},START);
  const button=name=>page.getByRole('button',{name,exact:true}),state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  const clock=async time=>{await page.evaluate(t=>{sessionStorage.setItem('idle-check-clock',String(t));window.dispatchEvent(new Event('focus'));},time);};
  const enter=async()=>{await button('Stake 5 RF').click();await button('Enter mine 5 sim RF ↘').click();};
  await page.goto(origin);await page.getByRole('button',{name:/^Friend #7730/}).click();await enter();
  await page.getByTestId('cell-34').click();
  let s=await state();const find=s.run.caches.find(c=>c.kind==='ordinary'&&c.loot.length&&!c.opened);
  for(const i of path(s.run,find.cell))await page.getByTestId(`cell-${i}`).click();
  s=await state();const carried=s.run.bag.reduce((n,l)=>n+BigInt(l.amount.$rf),0n);assert.ok(carried>0n);
  await clock(START+539999);assert.equal(await page.getByRole('heading',{name:'Still digging?'}).count(),0);
  await clock(START+540000);await page.getByRole('heading',{name:'Still digging?'}).waitFor();assert.equal(await page.getByTestId('idle-countdown').innerText(),'1:00');
  await page.screenshot({path:`work/deep-dig-checks/idle-warning-${width}.png`,fullPage:true});
  await button('Continue playing').click();let after=await state();assert.equal(after.run.lastActivityAt,START+540000);assert.deepEqual(after.run.bag,s.run.bag);
  await clock(START+1_080_000);await page.getByRole('heading',{name:'Still digging?'}).waitFor();
  await page.getByRole('button',{name:/^Extract [\d.]+ RF$/}).click();await page.getByRole('heading',{name:'Extract your haul?'}).waitFor();
  await clock(START+1_140_000);await page.getByRole('heading',{name:'Entry returned after inactivity.'}).waitFor();
  after=await state();assert.equal(after.run,null);assert.equal(after.result.kind,'idle');assert.equal(after.result.amount.$rf,String(5n*RF));assert.equal(after.result.discarded.$rf,String(carried));assert.equal(after.wallets['7730'].$rf,String(20n*RF));
  assert.equal(await button('Extract and return to camp').count(),0,'expiry closes a stale payout confirmation');
  await clock(START+1_200_000);assert.deepEqual(await state(),after,'a second timer cannot refund again');
  await page.reload();await page.getByRole('heading',{name:'Entry returned after inactivity.'}).waitFor();assert.deepEqual(await state(),after);
  await page.screenshot({path:`work/deep-dig-checks/idle-result-${width}.png`,fullPage:true});
  await button('Return to camp').click();await enter();s=await state();const entered=s.run.lastActivityAt;
  await clock(entered+550000);await page.reload();await page.getByRole('heading',{name:'Still digging?'}).waitFor();assert.equal((await state()).run.lastActivityAt,entered,'reload is not activity');
  // Emulate closing the page: advance persisted clock without firing an active-page timer.
  await page.evaluate(t=>sessionStorage.setItem('idle-check-clock',String(t)),entered+601000);await page.reload();
  await page.getByRole('heading',{name:'Entry returned after inactivity.'}).waitFor();assert.equal((await state()).wallets['7730'].$rf,String(20n*RF));
  await button('Return to camp').click();await enter();s=await state();
  await button('Open settings').click();await clock(s.run.lastActivityAt+600000);await page.getByRole('heading',{name:'Entry returned after inactivity.'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Expedition settings'}).count(),0);
  // A save written before the timeout update keeps all value and gets one grace window.
  await button('Return to camp').click();await enter();s=await state();delete s.run.lastActivityAt;
  await page.evaluate(({key,saved})=>localStorage.setItem(key,JSON.stringify(saved)),{key:KEY,saved:s});await page.reload();await page.getByRole('button',{name:/^Extract & finish/}).waitFor();
  const upgraded=await state();assert.equal(typeof upgraded.run.lastActivityAt,'number');assert.deepEqual(upgraded.run.caches,s.run.caches);assert.deepEqual(upgraded.wallets,s.wallets);
  await page.reload();assert.equal((await state()).run.lastActivityAt,upgraded.run.lastActivityAt);
  assert.deepEqual(errors,[]);console.log(`PASS ${width}×${height}: warning, continuation, exact refund, discarded haul, stale confirmation, one-time settlement, reload/closed-page expiry, open-menu expiry, legacy grace.`);
  await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
