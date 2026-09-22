// Internal automation only: production build, stock identity gate, mocked wallet/RPC.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { buildGame, createGameServer } from '@rarefriends/friendsdk/build';
import { FAMILIES_REGISTRY_ABI } from '@rarefriends/friendsdk/sprites';
import { installFixture } from './browser-fixture.mjs';
const source = await readFile('games/deep-dig/canonical-sprites.ts', 'utf8');
const frames = id => [...source.split(`"${id}": decodeGenerationSprites`)[1].split(']),')[0].matchAll(/0x[0-9a-f]+n/g)].map(([v]) => BigInt(v.slice(0,-1)));
function artworkCall(call) {
  const { functionName, args } = decodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, data: call.data });
  const id = functionName === 'frames' ? args[1] : Number(args[0]);
  assert([7730, 3412].includes(id));
  const result = functionName === 'familyOf' ? (id === 7730 ? 5 : 0) : functionName === 'seedOf' ? id : frames(id);
  return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName, result });
}

// Compare builds in the same browser at the same CSS viewport and pixel density.
// This catches CSS drift; it does not emulate Windows font rasterization.
import { buildDeepDig } from './deep-dig.mjs';
const temporary = await mkdtemp(join(tmpdir(), 'deep-dig-style-'));
const builds = [await buildDeepDig(), await buildGame('games/deep-dig', { outdir: join(temporary, 'build') })];
const servers = builds.map(b => createGameServer(b.outdir));
await Promise.all(servers.map(s => new Promise((ok,no) => {s.once('error',no);s.listen(0,'127.0.0.1',ok);}))); 
const origins = servers.map(s => `http://127.0.0.1:${s.address().port}`);
const browser = await chromium.launch({headless:true});
const styles = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','padding','gap','color','backgroundColor','border','boxShadow'];
async function snapshot(scope, selectors, geometry = true) {
 return scope.locator('.rf-game-frame').first().evaluate((frame,{selectors,styles,geometry})=>{
  const base=frame.getBoundingClientRect(), out={};
  for(const selector of selectors) {
   const el=frame.matches(selector)?frame:frame.querySelector(selector);if(!el)throw Error(`Missing ${selector}`);
   const r=el.getBoundingClientRect(),s=getComputedStyle(el);
   out[selector]=Object.fromEntries(styles.map(key=>[key,s[key]]));
   if(geometry)Object.assign(out[selector],{x:r.x-base.x-frame.clientLeft,y:r.y-base.y-frame.clientTop,width:r.width,height:r.height});
  }
  return out;
 },{selectors,styles,geometry});
}
function same(a,b,label) {
 for(const selector of Object.keys(a))for(const [key,value] of Object.entries(a[selector])) {
  const actual=b[selector][key];
  if(typeof value==='number')assert(Math.abs(actual-value)<.1,`${label} ${selector}.${key}: ${value} vs ${actual}`);
  else assert.equal(actual,value,`${label} ${selector}.${key}`);
 }
}
try {
 for(const [width,height,deviceScaleFactor] of [[1100,820,1],[900,800,1.25],[750,650,1.5],[844,390,2]]) {
  const pages=[],metrics=[];
  for(let i=0;i<2;i++) {
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor,reducedMotion:'reduce'});pages.push(page);
   if(i)await installFixture(page,origins[i],{artworkCall});
   await page.goto(origins[i]);
   if(i)await page.getByRole('button',{name:/^Connect (wallet|Browser wallet)$/}).click();
   await page.getByRole('button',{name:/^Friend #7730\b/}).click();
   const game=i?page.frameLocator('iframe'):page;
   await game.locator('.dig').waitFor();
   await game.locator('body').evaluate(async()=>{await document.fonts.ready;});
   const result={
    page:await page.locator('body').evaluate(body=>({body:{background:getComputedStyle(body).backgroundColor},html:{background:getComputedStyle(document.documentElement).backgroundColor}})),
    frame:await snapshot(page,['.rf-game-frame','.rf-frame-toolbar']),
    toolbar:await snapshot(page,['.rf-frame-toolbar button'],false),
    game:await snapshot(game,['.dig','.dig-top h1','.mine-board','.tile','.dig-panel','.level-budgets','.stake-picker','.stake-options button','.expedition-actions','.expedition-actions button','.footer-help'])
   };
   await game.getByRole('button',{name:/^Enter mine/}).click();
   result.movement=await snapshot(game,['.walking-controls']);
   await game.getByRole('button',{name:/^Extract & finish/}).click();
   result.extraction=await snapshot(game,['.rf-frame-menu','.rf-frame-menu-heading','.rf-frame-menu-body','.rf-frame-menu-footer','.result-number']);
   await game.getByRole('button',{name:'Keep digging',exact:true}).click();
   await game.getByRole('button',{name:'Open settings',exact:true}).click();
   await game.getByRole('button',{name:'Choose Friend',exact:true}).click();
   await page.getByRole('dialog',{name:'Choose your Friend',exact:true}).waitFor();
   result.pickerTheme=await snapshot(page,['.rf-frame-scrim','.rf-frame-menu','.rf-frame-menu-heading','.rf-frame-menu-body'],false);
   metrics.push(result);
  }
  for(const section of Object.keys(metrics[0]))same(metrics[0][section],metrics[1][section],`${width} ${section}`);
  console.log(`PASS ${width}×${height} @${deviceScaleFactor}x: shared frame/theme, board, typography, spacing, actions and extraction dialog.`);
  await Promise.all(pages.map(p=>p.close()));
 }
} finally {
 await browser.close();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));await rm(temporary,{recursive:true,force:true});
}
