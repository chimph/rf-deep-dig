// Isolated mocked identity/artwork; never connects a real wallet.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { buildGame, createGameServer } from '@rarefriends/friendsdk/build';
import { FAMILIES_REGISTRY_ABI } from '@rarefriends/friendsdk/sprites';
import { installFixture, SECOND_OWNER } from './browser-fixture.mjs';
const source = await readFile('games/deep-dig/canonical-sprites.ts','utf8');
const sampleFrames = [...source.split('"7730": decodeGenerationSprites')[1].split(']),')[0].matchAll(/0x[0-9a-f]+n/g)].map(([v]) => BigInt(v.slice(0,-1)));
const artworkIds = new Set();
let artworkCalls = 0;
function artworkCall(call) {
 artworkCalls++;
 const { functionName, args } = decodeFunctionData({abi:FAMILIES_REGISTRY_ABI,data:call.data});
 if(functionName==='familyOf')artworkIds.add(String(args[0]));
 return encodeFunctionResult({abi:FAMILIES_REGISTRY_ABI,functionName,result:functionName==='familyOf'?5:functionName==='seedOf'?7730:sampleFrames});
}
const dir=await mkdtemp(join(tmpdir(),'deep-dig-picker-'));
const built=await buildGame('games/deep-dig',{outdir:join(dir,'build')});
const server=createGameServer(built.outdir);
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1100,820],[390,844]]){
  artworkIds.clear(); artworkCalls = 0;
  const context=await browser.newContext({viewport:{width,height},hasTouch:width===390});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await installFixture(page,origin,{artworkCall,ownedIds:Array.from({length:73},(_,i)=>BigInt(7730+i))});
  await page.goto(origin);await page.getByRole('button',{name:/^Connect (wallet|Browser wallet)$/}).click();
  const cards=page.locator('.rf-frame-friends > button');
  await page.waitForFunction(()=>document.querySelectorAll('.rf-friend-artwork[data-artwork-status="ready"]').length===8);
  assert.equal(await cards.count(),8);assert.equal(artworkIds.size,8);assert.equal(fixture.ownerReads,8);
  await page.getByRole('button',{name:'Load more Friends',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.rf-friend-artwork[data-artwork-status="ready"]').length===16);
  await page.locator('.rf-frame-menu').screenshot({path:`work/deep-dig-submission/gallery-${width}.png`});
  const contained=await page.locator('.rf-frame-menu').evaluate(menu=>{const m=menu.getBoundingClientRect(), f=menu.closest('.rf-game-frame').getBoundingClientRect();return m.top>=f.top&&m.bottom<=f.bottom;});
  assert.equal(contained,true,'long gallery and close button stay inside frame');
  assert.equal(await cards.count(),16);assert.equal(artworkIds.size,16);assert.equal(fixture.ownerReads,16);
  assert.equal(await page.getByRole('button',{name:/^Friend #7738/}).count(),1);
  const overflow=await page.locator('.rf-frame-menu-body').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
  // Go beyond the SDK reader's 64-entry LRU, then select an early card.
  for(let total=24;total<=72;total+=8){
   await page.getByRole('button',{name:'Load more Friends',exact:true}).click();
   await page.waitForFunction(total=>document.querySelectorAll('.rf-friend-artwork[data-artwork-status="ready"]').length===total,total);
  }
  const readsBeforeSelection=artworkCalls;
  await page.getByRole('button',{name:/^Friend #7730/}).click();
  const game=page.frameLocator('iframe');await game.locator('.dig').waitFor();
  await game.locator('.mine-board[data-paused="false"]').waitFor();
  assert.equal(artworkCalls,readsBeforeSelection,'selection reuses gallery artwork without another RPC read');
  assert.equal(await game.getByText('Reading canonical artwork for your selected Friend.',{exact:true}).count(),0);
  assert.ok(fixture.ownerReads>72,'selection freshly rechecks eligibility');
  assert.equal(await game.locator('[data-session-friend]').getAttribute('data-session-friend'),'7730');
  assert.equal(await page.getByRole('button',{name:'Open Friend wallet',exact:true}).isVisible(),false);
  await game.getByRole('button',{name:'Open settings',exact:true}).click();
  await game.getByRole('button',{name:'Choose Friend',exact:true}).click();
  await page.getByRole('dialog',{name:'Choose your Friend',exact:true}).waitFor();
  // Pending next-page responses must not repopulate an old account's gallery.
  fixture.mode='loading';fixture.hold=new Promise(resolve=>{fixture.release=resolve;});
  await page.getByRole('button',{name:'Load more Friends',exact:true}).click();
  await page.getByRole('button',{name:'Loading more Friends…',exact:true}).waitFor();
  await page.evaluate(owner=>window.__friendWalletTest.accounts([owner]),SECOND_OWNER);
  assert.equal(await page.locator('iframe').count(),0);
  fixture.mode='eligible';fixture.release();
  await page.getByRole('button',{name:/^Friend #3412/}).waitFor();
  assert.equal(await cards.count(),1);assert.equal(await page.getByRole('button',{name:/^Friend #773/}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(fixture.errors,[]);
  console.log(`PASS ${width}x${height}: artwork + IDs, eight-per-page reads, cached artwork beyond 64 cards, menu access, fresh gate, stale-page cancellation, no overflow/signing.`);
  await context.close();
 }
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
