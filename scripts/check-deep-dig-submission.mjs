// Internal automation only: production build, stock identity gate, mocked wallet/RPC.
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { buildGame, createGameServer } from '@rarefriends/friendsdk/build';
import { FAMILIES_REGISTRY_ABI } from '@rarefriends/friendsdk/sprites';
import { installFixture, assertBounds, OWNER, SECOND_OWNER } from './browser-fixture.mjs';
const source = await readFile('games/deep-dig/canonical-sprites.ts', 'utf8');
const frames = id => [...source.split(`"${id}": decodeGenerationSprites`)[1].split(']),')[0].matchAll(/0x[0-9a-f]+n/g)].map(([v]) => BigInt(v.slice(0,-1)));
function artworkCall(call) {
  const { functionName, args } = decodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, data: call.data });
  const id = functionName === 'frames' ? args[1] : Number(args[0]);
  assert([7730, 3412].includes(id));
  const result = functionName === 'familyOf' ? (id === 7730 ? 5 : 0) : functionName === 'seedOf' ? id : frames(id);
  return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName, result });
}
const temporary = await mkdtemp(join(tmpdir(), 'deep-dig-submission-'));
const built = await buildGame('games/deep-dig', { outdir: join(temporary, 'build') });
const server = createGameServer(built.outdir);
await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('work/deep-dig-submission', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [width, height, touch] of [[1100, 820, false], [390, 844, true], [844, 390, true], [390, 844, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error' && /font|content security|content-security/i.test(message.text())) errors.push(message.text()); });
    const fixture = await installFixture(page, origin, { artworkCall });
    const game = page.frameLocator('iframe');
    const button = name => game.getByRole('button', { name: ['Enter mine', 'Extract & finish'].includes(name) ? new RegExp('^' + name) : name, exact: true });
    await page.goto(origin);
    await page.evaluate(() => localStorage.setItem('deep-dig.offline.v4', 'offline-save-sentinel'));
    assert.equal(await page.locator('iframe').count(), 0, 'disconnected cannot play');
    await page.getByRole('button', { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole('button', { name: /^Friend #7730\b/ }).click();
    await game.locator('.dig').waitFor();
    await page.locator('.rf-runtime-status').waitFor({ state: 'hidden' });
    assert(fixture.ownerReads >= 2, 'fresh eligibility after discovery');
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await game.locator('.header-account small').filter({hasText:'Session only'}).count(),0);
    const footer = await game.locator('.session-note').evaluate(note=>{
      const n=note.getBoundingClientRect(),h=document.querySelector('.footer-help').getBoundingClientRect();
      return {left:n.right<=h.left,aligned:Math.abs(n.bottom-h.bottom)<3};
    });
    assert.deepEqual(footer,{left:true,aligned:true});
    const cog=await game.locator('.settings-button').evaluate(b=>({border:getComputedStyle(b).borderWidth,background:getComputedStyle(b).backgroundColor}));
    assert.deepEqual(cog,{border:'0px',background:'rgba(0, 0, 0, 0)'});
    assert.deepEqual(await game.locator('body').evaluate(() => {
      const forbidden = fn => { try { fn(); return false; } catch { return true; } };
      return [forbidden(() => parent.document), forbidden(() => localStorage.getItem('deep-dig.offline.v4'))];
    }), [true, true], 'sandbox cannot access parent or saves');
    assert.equal((await game.getByTestId('balance').innerText()).replace(/\s/g,''), '20RF');
    assert.equal(await game.locator('.tile').count(), 80);
    assert.equal(await game.locator('.stake-options button').count(), 8);
    assert.equal(await game.locator('body').evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px Silkscreen') && [...document.fonts].some(font => font.family === 'Silkscreen' && font.status === 'loaded');
    }), true, 'the original Silkscreen font loads inside the unchanged SDK CSP');
    const art7730 = await game.locator('.identity-art canvas').evaluate(c => c.toDataURL());
    await button('Enter mine')[touch ? 'tap' : 'click']();
    assert.equal((await game.getByTestId('balance').innerText()).replace(/\s/g,''), '19RF');
    assert.equal(await game.locator('.direction-pad').isVisible(), touch && width === 390, 'landscape placement makes room for the start prompt');
    assert.equal(await game.locator('.touch-start-hint').count(), touch ? 1 : 0);
    if (touch) {
      assert.equal(await game.locator('.touch-start-hint').innerText(), 'Tap to start');
      const prompt = await game.locator('.touch-start-hint').boundingBox(), board = await game.locator('.mine-board').boundingBox();
      assert.ok(Math.abs(prompt.x - board.x) < 1 && prompt.y >= board.y + board.height && prompt.y - board.y - board.height < 15, 'prompt sits beneath the bottom-left of the grid');
      await page.screenshot({path:`work/deep-dig-submission/tap-to-start-${width}.png`,fullPage:true});
    }
    assert.equal(await game.locator('.keyboard-hint').isVisible(), !touch, 'desktop keeps the original keyboard hint');
    assert.equal(await game.locator('.flag-toggle').isDisabled(), true, 'place your Friend before flagging');
    await game.getByTestId('cell-34')[touch ? 'tap' : 'click']();
    assert.equal(await game.locator('.touch-start-hint').count(), 0, 'first tile dismisses the start prompt');
    assert.equal(await game.locator('.direction-pad').isVisible(), touch, 'movement controls are ready after placement');
    if (touch) {
      await button('Flag a direction').tap();
      assert.equal(await button('Flag a direction').getAttribute('aria-pressed'), 'true');
      await button('Flag a direction').tap();
      assert.equal(await button('Flag a direction').getAttribute('aria-pressed'), 'false');
    }
    if (touch) await button('Move right').tap();
    else await game.getByTestId('cell-34').press('ArrowRight');
    assert.equal(await game.locator('.friend-tile').getAttribute('data-testid'), width === 390 ? 'cell-44' : 'cell-35', 'directions follow the displayed board');
    if (touch) {
      await game.locator('.dig-top h1').hover();
      await game.locator('.dig[data-touch-controls="false"]').waitFor();
      assert.equal(await game.locator('.direction-pad').isVisible(), false, 'actual mouse overrides a browser reporting coarse primary input');
      await game.locator('.dig-top h1').tap();
      await game.locator('.dig[data-touch-controls="true"]').waitFor();
      assert.equal(await game.locator('.direction-pad').isVisible(), true, 'touch restores the pad without changing the board');
    }
    const count = await game.locator('.tile.revealed').count(); assert(count >= 9);
    // Host menu pauses child; keyboard cannot advance a tile under the overlay.
    assert.equal(await page.getByRole('button', { name: 'Open Friend wallet', exact: true }).isVisible(), false);
    await button('Open settings').click(); await button('Choose Friend').click();
    await game.locator('.mine-board[data-paused="true"]').waitFor();
    await page.locator('.rf-friend-artwork[data-artwork-status=ready]').waitFor();
    assert.equal(await page.getByRole('button', { name: /^Friend #7730/ }).count(), 1);
    await page.locator('.rf-frame-menu').screenshot({ path: `work/deep-dig-submission/friends-${width}.png` });
    await page.keyboard.press('ArrowRight');
    assert.equal(await game.locator('.tile.revealed').count(), count);
    await page.getByRole('button', { name: 'Close Choose your Friend' }).click();
    await button('Extract & finish').click();
    const haul = Number((await game.getByTestId('extraction-haul').innerText()).split(' ')[0]);
    await button('Keep digging').click();
    assert.equal((await game.getByTestId('balance').innerText()).replace(/\s/g,''), '19RF');
    await button('Extract & finish').click();
    await page.locator('.rf-game-frame').screenshot({ path: `work/deep-dig-submission/extract-${width}${touch ? '' : '-mouse'}.png` });
    await button('Extract and return to camp').click();
    await game.locator('.camp-card').waitFor();
    assert.equal(await game.getByRole('dialog').count(), 0, 'one extraction screen returns straight to camp');
    assert.equal((await game.getByTestId('balance').innerText()).replace(/\s/g,''), `${19 + haul}RF`);
    await button('Enter mine')[touch ? 'tap' : 'click']();
    if (width === 390) await game.getByTestId('cell-34').scrollIntoViewIfNeeded();
    await page.locator('.rf-game-frame').screenshot({ path: `work/deep-dig-submission/${width}${touch ? "" : "-mouse"}-game.png` });
    await assertBounds(page);
    // Real runtime removes old session and pending confirmations on identity changes.
    await button('Extract & finish').click();
    await page.evaluate(owner => window.__friendWalletTest.accounts([owner]), SECOND_OWNER);
    await page.getByRole('button', { name: /^Friend #3412\b/ }).click();
    await game.locator('[data-session-friend="3412"] .dig').waitFor();
    assert.equal(await game.getByRole('dialog', { name: 'Extract your haul?' }).count(), 0);
    assert.equal((await game.getByTestId('balance').innerText()).replace(/\s/g,''), '20RF');
    const art3412 = await game.locator('.identity-art canvas').evaluate(c => c.toDataURL());
    assert.notEqual(art7730, art3412, 'selected artwork changes with Friend');
    await page.evaluate(() => window.__friendWalletTest.chain('0x1'));
    await page.locator('iframe').waitFor({ state: 'detached' });
    await page.evaluate(() => window.__friendWalletTest.chain('0x1237'));
    await page.getByRole('button', { name: /^Friend #3412\b/ }).click();
    await game.locator('.dig').waitFor();
    await button('Enter mine')[touch ? 'tap' : 'click']();
    await page.clock.install(); await page.clock.fastForward(600001);
    await game.getByRole('dialog', { name: 'Entry returned after inactivity.' }).waitFor();
    assert.equal((await game.getByTestId('balance').innerText()).replace(/\s/g,''), '20RF');
    await page.clock.resume();
    await page.evaluate(() => window.__friendWalletTest.disconnect());
    await page.locator('iframe').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => localStorage.getItem('deep-dig.offline.v4')), 'offline-save-sentinel');
    assert.deepEqual(errors.concat(fixture.errors), []);
    assert((await page.evaluate(() => window.__friendWalletTest.state.requests)).every(m => ['eth_accounts','eth_requestAccounts','eth_chainId','wallet_switchEthereumChain'].includes(m)));
    console.log(`PASS ${width}×${height} ${touch ? "touch" : "mouse"}: original font, input controls, artwork, gameplay, extraction, idle refund, sandbox, pause, identity invalidation, offline isolation; no signing.`);
    await context.close();
  }
  const context = await browser.newContext(), page = await context.newPage();
  page.setDefaultTimeout(15000);
  let artFailure = true;
  const fixture = await installFixture(page, origin, { artworkCall: call => {
    const { functionName } = decodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, data: call.data });
    return artFailure && functionName === 'familyOf' ? encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName, result: 255 }) : artworkCall(call);
  }});
  const game = page.frameLocator('iframe');
  const connect = async () => {
    await page.getByRole('button', { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole('button', { name: /^Friend #7730\b/ }).click();
  };
  await page.goto(origin); await connect();
  await game.getByRole('dialog', { name: 'Friend unavailable' }).waitFor();
  assert.equal(await game.locator('.dig').count(), 0, 'no sample fallback on artwork failure');
  await game.getByRole('button', { name: 'Choose Friend', exact: true }).click();
  await page.getByRole('dialog', { name: 'Choose your Friend', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close Choose your Friend' }).click();
  artFailure = false;
  await game.getByRole('button', { name: 'Retry artwork' }).click();
  await game.locator('.dig').waitFor();
  await game.getByRole('button', { name: /^Enter mine/ }).click();
  assert.match(await game.getByTestId('balance').innerText(), /19/);
  await game.getByRole('button',{name:'Open settings',exact:true}).click();
  assert.equal(await game.getByRole('button',{name:'Sound on',exact:true}).getAttribute('aria-pressed'),'true', 'new sessions default sound on');
  await game.getByRole('button',{name:'Sound on',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('friendsdk.sound-muted:Deep Dig')==='true');
  await page.reload(); await connect(); await game.locator('.dig').waitFor();
  await game.getByRole('button',{name:'Open settings',exact:true}).click();
  assert.equal(await game.getByRole('button',{name:'Sound off',exact:true}).getAttribute('aria-pressed'),'false');
  await game.getByRole('button',{name:'Sound off',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('friendsdk.sound-muted:Deep Dig')==='false');
  await page.reload(); await connect(); await game.locator('.dig').waitFor();
  await game.getByRole('button',{name:'Open settings',exact:true}).click();
  assert.equal(await game.getByRole('button',{name:'Sound on',exact:true}).getAttribute('aria-pressed'),'true');
  await game.getByRole('button',{name:'Close Expedition settings',exact:true}).click();
  assert.match(await game.getByTestId('balance').innerText(), /20/);
  assert.equal(await game.locator('.dig').getAttribute('data-depth'), '0');
  assert.deepEqual(fixture.errors, []);
  console.log('PASS artwork failure/retry, sound defaults on and remembers mute/unmute across refresh, game session still resets.');
  await context.close();
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(ok => server.close(ok)); await built.close(); await rm(temporary, { recursive: true, force: true });
}
