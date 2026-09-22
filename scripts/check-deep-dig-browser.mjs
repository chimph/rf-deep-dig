import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { buildDeepDig } from './deep-dig.mjs';
import { createGameServer } from './dev-game.mjs';

// These are isolated UI fixtures. Hidden save
// data is used only to route reproducibly to safe ground, an orb, and a mine.
const built = await buildDeepDig(), server = createGameServer(built.outdir);
await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`, KEY = 'deep-dig.offline.v4';
const RF = 10n ** 18n, amount = loot => loot.reduce((n, l) => n + BigInt(l.amount.$rf), 0n);
const directionKey = delta => ({ '-10': 'ArrowUp', '10': 'ArrowDown', '-1': 'ArrowLeft', '1': 'ArrowRight' }[delta]);
const adjacent = i => [i - 10, i + 10, ...(i % 10 ? [i - 1] : []), ...(i % 10 < 9 ? [i + 1] : [])].filter(j => j >= 0 && j < 80);
const globalPot = s => amount(s.run?.future ?? []) + BigInt(s.pool.$rf) + amount(s.run?.bag ?? []) + amount(s.run?.caches.filter(c => !c.opened).flatMap(c => c.loot) ?? []);
const parseShownRF = text => { const match = text.trim().match(/^(\d+)(?:\.(\d{1,18}))?\s*RF$/); assert.ok(match, `RF display is numeric: ${text}`); return BigInt(match[1]) * RF + BigInt((match[2] ?? '').padEnd(18, '0')); };
const total = s => Object.values(s.wallets).reduce((n, v) => n + BigInt(v.$rf), 0n) + amount(s.run?.future ?? []) + BigInt(s.pool.$rf) + amount(s.run?.bag ?? []) + amount(s.run?.caches.filter(c => !c.opened).flatMap(c => c.loot) ?? []);
async function checkLevelRewards(page, payouts) {
  if (!payouts) {
    const s = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)), KEY), r=s?.run;
    const stake=r?.stake?BigInt(r.stake.$rf)/RF:1n;
    payouts=[524n,728n,1152n].map((base,i)=>{
      const value=r?.depth===i+1?amount(r.caches.filter(c=>c.kind==='ordinary').flatMap(c=>c.loot))+BigInt(r.hazards.filter(h=>!h).length)*r.caches.filter(c=>c.kind==='mystery').reduce((max,c)=>amount(c.loot)>max?amount(c.loot):max,0n):base*RF/100n*stake;
      return `${Number(value/(RF/100n))/100} RF`;
    });
  }
  const panel = page.locator('.level-rewards'), table = page.getByRole('table', { name: 'Maximum rewards per level' });
  assert.equal(await panel.count(), 1);
  assert.equal(await page.locator('.global-pot,[data-testid="pool"]').count(), 0, 'global pot display is removed');
  assert.doesNotMatch(await page.locator('.dig').innerText(), /GLOBAL POT/i);
  assert.equal(await table.count(), 1);
  assert.deepEqual((await table.locator('thead th').allTextContents()).map(text => text.trim()), ['Level', 'Up to'], 'reward table has no pot-share column');
  assert.equal(await table.locator('caption').count(), 0);
  assert.doesNotMatch(await panel.innerText(), /%|pot size/i, 'level rewards contain no pot percentages or explanation');
  assert.equal(parseShownRF(await page.getByTestId('level-budget-total').locator('td').innerText()), payouts.reduce((n, value) => n + parseShownRF(value), 0n), 'total adds the displayed level maximums at the selected stake');
  for (let i = 0; i < payouts.length; i++) {
    const row = page.getByTestId(`level-budget-${i + 1}`);
    assert.equal(await row.locator('td').count(), 1);
    const payout = await row.locator('td').evaluate(node => {
      const copy = node.cloneNode(true); copy.querySelectorAll('.pool-shortfall').forEach(warning => warning.remove()); return copy.textContent.trim();
    });
    assert.equal(parseShownRF(payout), parseShownRF(payouts[i]), `depth ${i + 1} retains its exact RF maximum`);
  }
}
function route(run, goal) {
  const queue = [run.position], previous = new Map([[run.position, null]]);
  for (const from of queue) {
    if (from === goal) break;
    for (const next of adjacent(from)) if (!previous.has(next) && !run.cells[next].flagged && (!run.cells[next].mystery || (run.cells[next].revealed && !run.cells[next].mine))) { previous.set(next, from); queue.push(next); }
  }
  assert.ok(previous.has(goal), `ordinary ground ${goal} must be reachable`);
  const path = []; for (let cell = goal; previous.get(cell) !== null; cell = previous.get(cell)) path.unshift(cell);
  return path;
}
await mkdir('work/deep-dig-checks', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [width, height, touch] of [[1100, 820, false], [844, 390, true], [390, 844, true]].filter(([w]) => !process.env.DEEP_DIG_CHECK_WIDTH || w === Number(process.env.DEEP_DIG_CHECK_WIDTH))) {
    const portrait = width <= 600 && height > width;
    const directionKey = delta => (portrait ? { '-10': 'ArrowLeft', '10': 'ArrowRight', '-1': 'ArrowUp', '1': 'ArrowDown' } : { '-10': 'ArrowUp', '10': 'ArrowDown', '-1': 'ArrowLeft', '1': 'ArrowRight' })[delta];
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.addInitScript(() => { let seed = 734; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; Object.defineProperty(window, 'ethereum', { get() { throw Error('Offline game accessed wallet'); } }); });
    const button = name => page.getByRole('button', { name, exact: true });
    const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
    const tile = i => page.getByTestId(`cell-${i}`);
    // The ledger is still checked although it is no longer displayed. Fresh
    // contexts do not persist their initial 1,000,000 RF pool until the first action.
    const ledgerPot = async () => { const saved = await state(); return saved ? globalPot(saved) : 1_000_000n * RF; };
    const checkPot = async expected => assert.equal(await ledgerPot(), expected, 'internal pool, reserves and carried haul retain the expected total');
    const tap = async i => { if (touch) await tile(i).tap(); else await tile(i).click(); };
    const unchanged = async before => assert.deepEqual(await state(), before);
    const artwork = selector => page.locator(selector).evaluate(canvas => canvas.toDataURL());
    const pickup = async reduced => {
      // This effect lives for only 600 ms. Resolve the current connected element
      // and read its computed styles in one browser task, so an expiry between
      // locator resolution and evaluation cannot produce detached-node styles.
      const handle = await page.waitForFunction(() => {
        const node = document.querySelector('.friend-tile svg.pickup-shimmer');
        if (!node?.isConnected) return false;
        const rays = [...node.querySelectorAll('.shimmer-ray')];
        const animations = rays.map(ray => getComputedStyle(ray).animationName);
        if (!rays.length || animations.some(name => !name)) return false;
        return { hidden: node.getAttribute('aria-hidden'), lines: node.querySelectorAll('line').length, reduced: node.classList.contains('reduced'), animations };
      }, undefined, { timeout: 2000 });
      const snapshot = await handle.jsonValue(); await handle.dispose();
      assert.equal(snapshot.hidden, 'true');
      assert.equal(snapshot.lines, 8, 'pickup uses eight simple rays');
      assert.equal(snapshot.reduced, reduced);
      assert.equal(snapshot.animations.length, 8, 'every visible ray has a computed animation style');
      assert.ok(snapshot.animations.every(name => name === (reduced ? 'none' : 'rf-pickup-ray')), `motion preference governs the rays: ${snapshot.animations}`);
    };
    const walkTo = async target => { for (const cell of route((await state()).run, target)) await tap(cell); assert.equal((await state()).run.position, target); };
    const approach = async target => { const r = (await state()).run; const side = adjacent(target).find(i => !r.cells[i].mystery && !r.cells[i].flagged); assert.notEqual(side, undefined); await walkTo(side); };
    const enter = async () => { const before = await ledgerPot(); await button('Enter mine 1 sim RF ↘').click(); assert.equal(await button('Confirm preview').count(),0); await page.waitForFunction(() => document.querySelector('.mine-board')?.dataset.paused === 'false'); await checkPot(before + RF); };
    const extract = async () => {
      const before = await state(), haul = amount(before.run.bag), expected = globalPot(before) - haul;
      await page.getByRole('button', { name: /^Extract & finish/ }).click();
      assert.equal(await page.getByTestId('extraction-haul').innerText(), `${Number(haul / (RF / 100n)) / 100} SIM RF TO BANK`);
      await button('Keep digging').click();
      assert.deepEqual(await state(), before, 'cancelling extraction leaves the run and balances unchanged');
      await page.getByRole('button', { name: /^Extract & finish/ }).click();
      await page.screenshot({ path: `work/deep-dig-checks/extract-${width}.png`, fullPage: true });
      await button('Extract and return to camp').click();
      await page.locator('.camp-card').waitFor();
      const after = await state();
      assert.equal(after.run, null); assert.equal(after.result, null, 'extraction returns directly to camp');
      assert.equal(BigInt(after.wallets[before.run.friend].$rf), BigInt(before.wallets[before.run.friend].$rf) + haul);
      assert.equal(await page.getByRole('dialog').count(), 0, 'no second acknowledgement');
      await checkPot(expected);
      await page.reload(); await page.getByRole('button', { name: /^Friend #7730/ }).click();
      assert.deepEqual(await state(), after, 'banking and returning to camp persist together');
    };
    const outcomeReady = async () => page.waitForFunction(() => document.querySelector('.mine-board')?.dataset.outcomeReady === 'true');
    const orbPlayContinues = async (cell, before, label) => {
      const prize = amount(before.run.caches.find(cache => cache.cell === cell).loot);
      const after = await state();
      assert.equal(after.run.position, cell);
      assert.match(await page.locator('.board-counter').innerText(),new RegExp(`ORBS FOUND: ${after.run.cells.filter(c=>c.mystery&&c.revealed&&!c.mine).length}/5`));
      assert.equal(amount(after.run.bag), amount(before.run.bag) + prize, `${label} credits its exact reward once`);
      assert.equal(await page.locator('.mine-board').getAttribute('data-paused'), 'false', `${label} does not pause movement`);
      assert.equal(await page.locator('.rf-frame-menu,.reveal-hit-area').count(), 0, `${label} creates no popup or acknowledgement overlay`);
      await pickup(true);
      // Return to the already visited approach tile immediately, without waiting
      // for the orb visual to finish, then revisit the orb to check one-time credit.
      for (const next of [before.run.position, cell]) {
        const from = (await state()).run.position;
        if (touch) await tap(next); else await page.keyboard.press(directionKey(next - from));
        const moved = await state();
        assert.equal(moved.run.position, next, `${label} permits immediate ${touch ? 'touch' : 'keyboard'} movement`);
        assert.deepEqual(moved.run.bag, after.run.bag, `${label} cannot pay twice when revisited`);
        assert.equal(await page.locator('.rf-frame-menu,.reveal-hit-area').count(), 0);
      }
      await page.waitForFunction(() => document.querySelector('.mine-board')?.dataset.outcome !== 'orb');
      assert.equal(await page.locator('.rf-frame-menu,.reveal-hit-area').count(), 0, `${label} has no delayed popup`);
      assert.equal(await page.locator('.mine-board').getAttribute('data-paused'), 'false');
      assert.equal(total(await state()), 1_000_040n * RF);
    };
    const flag = async i => {
      if (!touch) return tile(i).click({ button: 'right' });
      await tile(i).scrollIntoViewIfNeeded();
      const box = await tile(i).boundingBox(), session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await page.waitForTimeout(530);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    };
    const bounds = async () => assert.deepEqual(await page.evaluate(() => {
      const frame = document.querySelector('.rf-game-frame').getBoundingClientRect(), bad = [];
      const portrait = matchMedia('(max-width:600px) and (orientation:portrait)').matches;
      if (!portrait && Math.abs(frame.width / frame.height - 1.5) > .01) bad.push('frame ratio');
      for (const node of document.querySelectorAll('.mine-board,.dig-panel,.status,.board-tools,.walking-controls,.rf-frame-menu')) { const b = node.getBoundingClientRect(); if (b.left < frame.left - 1 || b.right > frame.right + 1 || b.top < frame.top - 1 || b.bottom > frame.bottom + 1) bad.push(node.className); }
      const box = selector => document.querySelector(selector)?.getBoundingClientRect();
      const action = box('.expedition-actions'), status = box('.status'), toolbar = box('.rf-frame-toolbar'), movement = box('.walking-controls'), board = box('.mine-board');
      const heading = box('.dig-top'), panel = box('.dig-panel');
      if (board && heading && Math.abs(board.left-heading.left)>1) bad.push('grid is not aligned with title');
      if (!portrait && board && panel && (Math.abs(board.top-panel.top)>1 || Math.abs(board.bottom-panel.bottom)>1)) bad.push('panel is not aligned with grid');
      if (!portrait && board && panel && Math.abs((panel.left-board.right)-(board.left-frame.left))>2) bad.push('uneven board gutter');
      if (portrait && board && panel && board.bottom+10 > panel.top) bad.push('portrait info overlaps board');
      if (portrait && board && Math.abs(board.width/board.height-.8)>.01) bad.push('portrait grid ratio');
      if (portrait && movement && panel && Math.abs(movement.top-panel.top)>1) bad.push('direction pad not beside info');
      if (movement && toolbar && movement.bottom > toolbar.top+1) bad.push('movement overlaps toolbar');
      if (document.querySelector('.deeper')) {
        const rewards = box('.reward-summary');
        if (portrait && action && rewards && (action.top < rewards.bottom || action.top - rewards.bottom > 32)) bad.push('run actions are not beneath rewards');
        if (!portrait && action) {
          const bottomTile = Math.max(...[...document.querySelectorAll('.mine-board .tile')].map(node => node.getBoundingClientRect().bottom));
          if (Math.abs(action.bottom-bottomTile)>1) bad.push('run actions are not aligned with bottom row tiles');
        }
        const buttons = [...document.querySelectorAll('.expedition-actions button')].map(node => node.getBoundingClientRect());
        if (buttons.length === 2 && (Math.abs(buttons[0].top-buttons[1].top)>1 || Math.abs(buttons[0].bottom-buttons[1].bottom)>1)) bad.push('run actions are not aligned');
      } else if (!portrait && board && action) {
        const bottomTile = Math.max(...[...document.querySelectorAll('.mine-board .tile')].map(node => node.getBoundingClientRect().bottom));
        if (Math.abs(action.bottom-bottomTile)>1) bad.push('entry/result action is not aligned with bottom row tiles');
      }
      const depth = box('.board-depth-title');
      if (depth && board && ((portrait ? depth.bottom > board.top || board.top-depth.bottom > 18 : depth.top < board.bottom) || depth.left < board.left || Math.abs(depth.right-board.right)>1)) bad.push('depth/stake does not fit at the board right edge');
      if (portrait && depth && panel && depth.bottom > panel.top) bad.push('depth/stake overlaps info panel');
      if (depth && heading && depth.top < heading.bottom) bad.push('depth/stake overlaps header');
      if (action && status && action.bottom > status.top) bad.push('actions overlap status');
      if (movement && status && movement.right > status.left && movement.bottom > status.top) bad.push('movement overlaps status');
      if (board && movement && board.bottom > movement.top) bad.push('board overlaps movement');
      if (status && toolbar && status.bottom > toolbar.top + 1) bad.push('status overlaps toolbar');
      for (const selector of ['.dig-panel', '.dig-top', '.header-account', '.reward-summary', '.entry-controls', '.level-rewards', '.level-budgets tbody']) {
        const container = document.querySelector(selector); if (!container) { bad.push(`missing ${selector}`); continue; }
        const parent = container.getBoundingClientRect(), visible = [...container.children].map(node => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.height > 0);
        for (const { node, rect } of visible) if (rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.top < parent.top - 1 || rect.bottom > parent.bottom + 1) bad.push(`${selector} overflows ${node.className || node.tagName}`);
        for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i].rect, b = visible[j].rect;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5) bad.push(`${selector} children overlap: ${visible[i].node.className || visible[i].node.tagName} / ${visible[j].node.className || visible[j].node.tagName}`);
        }
      }
      const avatar = document.querySelector('.friend-tile .friend-token'), occupied = document.querySelector('.tile.friend-tile');
      if (avatar && occupied) {
        const a = avatar.getBoundingClientRect(), t = occupied.getBoundingClientRect(), clue = occupied.querySelector('.clue')?.getBoundingClientRect();
        if (Math.abs(a.width - a.height) > .1) bad.push('Friend artwork is not square');
        if (a.left < t.left || a.right > t.right || a.top < t.top || a.bottom > t.bottom) bad.push('full Friend square leaves tile');
        if (clue && Math.min(a.right, clue.right) > Math.max(a.left, clue.left) && Math.min(a.bottom, clue.bottom) > Math.max(a.top, clue.top)) bad.push('clue overlaps full Friend square');
      }
      if (document.documentElement.scrollWidth > innerWidth) bad.push('horizontal scroll'); return bad;
    }), []);

    await page.goto(origin); await page.getByRole('button', { name: /^Friend #7730/ }).click(); await bounds();
    assert.equal(await page.evaluate(async () => {
      const faces = await document.fonts.load('400 24px "Silkscreen"');
      return faces.length === 1 && faces[0].status === 'loaded';
    }), true, 'bundled pixel font loads under the offline CSP');
    assert.equal(await page.locator('.dig-top h1').innerText(), 'DEEP DIG', 'title is real text');
    assert.equal(await page.locator('.camp-card h2').innerText(), 'DIG DEEP.\nEXTRACT ORBS.');
    await page.screenshot({path:`work/deep-dig-checks/camp-font-${width}.png`,fullPage:true});
    await checkLevelRewards(page);
    assert.equal(await page.locator('.dig-top [data-testid="balance"]').count(),1);
    assert.deepEqual(await page.locator('.stake-options button').allTextContents(), ['1','2','5','10','20','50','80','100']);
    assert.equal(await page.locator('.footer-help').innerText(), 'How to play');
    assert.match(await page.locator('.header-wallet').innerText(),/Wallet/);
    assert.doesNotMatch(await page.locator('.dig').innerText(),/BASE CAMP|BANKED/);
    for (const amount of [50,80,100]) { assert.equal(await button(`Stake ${amount} RF`).isVisible(), true); assert.equal(await button(`Stake ${amount} RF`).isEnabled(), false); }
    await button('Stake 5 RF').click();
    await checkLevelRewards(page,['26.2 RF','36.4 RF','57.6 RF']);
    assert.match(await page.getByTestId('reward-offer').innerText(),/Each orb\s+5 RF/);
    assert.match(await page.getByTestId('reward-offer').innerText(),/0\.05–0\.15 RF/);
    assert.equal(await page.getByTestId('balance').textContent(),'20 RF');
    await page.locator('.rf-game-frame').screenshot({path:resolve(`work/deep-dig-checks/stakes-${width}.png`)});
    await button('Stake 1 RF').click();
    const canonicalFace = await artwork('.identity-art .friend-avatar');
    assert.equal(await page.locator('.pickup-shimmer').count(), 0);
    await enter(); assert.equal(await page.getByTestId('balance').textContent(), '19 RF');
    await checkPot(1_000_001n * RF);
    const committed=await state(),mines=committed.run.hazards.filter(Boolean).length;
    assert.equal(mines,5);assert.equal(committed.run.hazards.length,10);assert.match(await page.locator('.board-counter').innerText(),/ORBS FOUND: 0\/5/);assert.doesNotMatch(await page.getByTestId('reward-offer').innerText(),/%|odds/i);
    assert.equal(await page.locator('.stake-picker').count(),0);
    assert.equal(amount(committed.run.future),1880n*RF/100n);
    await checkLevelRewards(page);
    assert.equal(await page.locator('.mine-board').getAttribute('data-placing'),'true');
    assert.equal(await page.locator('.mine-board').evaluate(board => {
      const canonical=document.querySelector('.identity-art canvas').toDataURL();
      return getComputedStyle(board.querySelector('.tile')).cursor.includes(canonical);
    }),true,'placement cursor uses exactly the selected canonical Friend image');
    await tile(34).focus(); await page.keyboard.press(directionKey(1));
    assert.equal(await page.locator('.placement-preview .friend-avatar').count(),1);
    await page.locator('.rf-game-frame').screenshot({path:resolve(`work/deep-dig-checks/placement-${width}.png`)});
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.mine-board').getAttribute('data-placing'),'false');
    assert.equal(await page.locator('.placement-preview').count(),0);
    assert.doesNotMatch(await tile(35).evaluate(node=>getComputedStyle(node).cursor),/data:image/);
    let s = await state(); assert.equal(s.run.position, 35); assert.equal(s.run.cells[35].adjacent, 0); assert.equal(total(s), 1_000_040n * RF);
    assert.ok(s.run.cells.filter(c => c.revealed).length > 1);
    if (portrait) {
      const savedBoard=await state();
      assert.match(await tile(35).getAttribute('aria-label'),/Row 6, column 4/);
      await page.setViewportSize({width:844,height:390});
      await page.waitForFunction(()=>document.querySelector('.dig').dataset.layout==='landscape');
      await unchanged(savedBoard);await bounds();
      assert.match(await tile(35).getAttribute('aria-label'),/Row 4, column 6/);
      await page.setViewportSize({width,height});
      await page.waitForFunction(()=>document.querySelector('.dig').dataset.layout==='portrait');
      await unchanged(savedBoard);await bounds();
    }

    const initialFind = s.run.caches.find(c => c.kind === 'ordinary' && !c.opened && amount(c.loot) > 0n && s.run.cells[c.cell].revealed);
    assert.ok(initialFind, 'seed exposes a ground find without collecting it');
    assert.match(await tile(initialFind.cell).getAttribute('aria-label'), /RF on ground/);
    assert.equal(s.run.caches.filter(c => c.opened).length, 1, 'flood reveals without collecting other cells');
    assert.equal(await artwork('.friend-tile .friend-avatar'), canonicalFace);
    if (amount(s.run.bag) === 0n) assert.equal(await page.locator('.pickup-shimmer').count(), 0, 'flood-only reveals do not shimmer');

    const remote = s.run.cells.findIndex((_, i) => i !== s.run.position && !adjacent(s.run.position).includes(i));
    await tap(remote); await unchanged(s); assert.match(await page.locator('.status').innerText(), /one square at a time/);
    const safeStep = adjacent(s.run.position).find(i => !s.run.cells[i].mystery);
    const delta = safeStep - s.run.position, key = { ArrowUp: 'w', ArrowDown: 's', ArrowLeft: 'a', ArrowRight: 'd' }[directionKey(delta)];
    await page.keyboard.press(key); assert.equal((await state()).run.position, safeStep);
    assert.equal(await artwork('.friend-tile .friend-avatar'), canonicalFace, 'movement never changes the canonical face');
    // A held key cannot automatically walk into further unknown tiles.
    s = await state(); const safeNext = adjacent(s.run.position).find(i => !s.run.cells[i].mystery), nextDelta = safeNext - s.run.position;
    const heldKey = directionKey(nextDelta);
    await page.keyboard.down(heldKey); const oneStep = await state(); await page.keyboard.down(heldKey); await page.keyboard.up(heldKey); await unchanged(oneStep);
    s = await state(); const padTarget = adjacent(s.run.position).find(i => !s.run.cells[i].mystery);
    const padName = 'Move ' + directionKey(padTarget - s.run.position).replace('Arrow','').toLowerCase();
    assert.equal(await button(padName).isVisible(),touch,'direction buttons appear only for touch input');
    const fromBox=await tile(s.run.position).boundingBox(),toBox=await tile(padTarget).boundingBox();
    const visualDirection=Math.abs(toBox.x-fromBox.x)>Math.abs(toBox.y-fromBox.y)?(toBox.x>fromBox.x?'right':'left'):(toBox.y>fromBox.y?'down':'up');
    assert.equal(padName,'Move '+visualDirection,'pad follows visible board direction');
    if (touch) await button(padName).tap(); else await page.keyboard.press(directionKey(padTarget - s.run.position)); assert.equal((await state()).run.position, padTarget);
    assert.equal(await page.locator('.tile.covered .ground-find').count(), 0, 'covered tiles expose no loot markers');
    const findBefore = (await state()).run.caches.find(c => c.cell === initialFind.cell);
    if (!findBefore.opened) { const previousHaul = amount((await state()).run.bag); await walkTo(initialFind.cell); assert.ok(amount((await state()).run.bag) >= previousHaul + amount(initialFind.loot)); }
    assert.equal((await state()).run.caches.find(c => c.cell === initialFind.cell).opened, true);
    assert.match(await tile(initialFind.cell).getAttribute('aria-label'), /ground find collected/);

    // Visible RF piles shimmer only when walked onto; reduced motion is static.
    s = await state();
    const shimmerFind = s.run.caches.find(c => c.kind === 'ordinary' && !c.opened && amount(c.loot) > 0n);
    assert.ok(shimmerFind);
    const findPath = route(s.run, shimmerFind.cell);
    for (const cell of findPath.slice(0, -1)) await tap(cell);
    const beforeFind = await state();
    await tap(shimmerFind.cell);
    await pickup(true);
    assert.equal(amount((await state()).run.bag), amount(beforeFind.run.bag) + amount(shimmerFind.loot));
    await checkPot(globalPot(beforeFind));
    if (touch) {
      // A render when the 600ms pickup expires must not cancel a 450ms long press.
      const overlapBefore = await state(), overlapSource = overlapBefore.run.cells.findIndex(c => !c.revealed && !c.flagged);
      assert.ok(overlapSource >= 0);
      const overlapSession = await context.newCDPSession(page), overlapBox = await tile(overlapSource).boundingBox();
      const overlapPoint = { x: overlapBox.x + overlapBox.width / 2, y: overlapBox.y + overlapBox.height / 2 };
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.pickup-shimmer').count(), 1, 'long press begins before pickup expiry');
      await overlapSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [overlapPoint] });
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.pickup-shimmer').count(), 0, 'pickup expires during the pending long press');
      await unchanged(overlapBefore);
      await page.waitForTimeout(180);
      const overlapHeld = await state();
      assert.equal(overlapHeld.run.cells[overlapSource].flagged, true, 'long press survives pickup-expiry render');
      assert.equal(overlapHeld.run.position, overlapBefore.run.position);
      assert.deepEqual(overlapHeld.run.bag, overlapBefore.run.bag);
      assert.deepEqual(overlapHeld.run.cells.map(c => c.revealed), overlapBefore.run.cells.map(c => c.revealed));
      await overlapSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(80); await unchanged(overlapHeld);
      assert.equal(await page.getByRole('heading', { name: 'Risk opening this flag?' }).count(), 0, 'release after overlapping shimmer still suppresses click');
      await flag(overlapSource); await overlapSession.detach();
    }
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.pickup-shimmer').count(), 0, 'pickup effect finishes');
    assert.equal(await artwork('.friend-tile .friend-avatar'), canonicalFace, 'artwork remains fixed over time');
    const revisit = beforeFind.run.position;
    await tap(revisit); await tap(shimmerFind.cell);
    assert.equal(amount((await state()).run.bag), amount(beforeFind.run.bag) + amount(shimmerFind.loot));
    assert.equal(await page.locator('.pickup-shimmer').count(), 0, 'revisiting collected ground does not shimmer');
    if (!touch) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      s = await state();
      const animatedFind = s.run.caches.find(c => c.kind === 'ordinary' && !c.opened && amount(c.loot) > 0n);
      assert.ok(animatedFind);
      const animatedPath = route(s.run, animatedFind.cell);
      for (const cell of animatedPath.slice(0, -1)) await tap(cell);
      await tap(animatedFind.cell); await pickup(false);
      await page.locator('.rf-game-frame').screenshot({ path: resolve('work/deep-dig-checks/shimmer.png'), animations: 'allow' });
      await page.waitForTimeout(650); assert.equal(await page.locator('.pickup-shimmer').count(), 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }

    s = await state(); const source = s.run.cells.findIndex(c => c.mystery && !c.mine); assert.ok(source >= 0);
    await flag(source); assert.equal((await state()).run.cells[source].flagged, true);
    if (!adjacent((await state()).run.position).includes(source)) { const flagged = await state(); await tap(source); await unchanged(flagged); assert.equal(await page.getByRole('heading', { name: 'Risk opening this flag?' }).count(), 0); }
    await approach(source); s = await state(); await tap(source); await page.getByRole('heading', { name: 'Risk opening this flag?' }).waitFor();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('e'); await page.keyboard.press('f'); await unchanged(s); await bounds(); await button('Keep flagged').click(); await unchanged(s);
    await flag(source); assert.equal((await state()).run.cells[source].flagged, false);

    // F arms one directional flag action without moving into that neighbour.
    const flagBefore = await state(), flagKey = directionKey(source - flagBefore.run.position);
    await page.keyboard.down('f'); await page.keyboard.down('f'); await page.keyboard.up('f');
    const expectedTargets = adjacent(flagBefore.run.position).filter(i => !flagBefore.run.cells[i].revealed);
    assert.deepEqual(await page.locator('.tile.flag-target').evaluateAll(nodes => nodes.map(node => Number(node.dataset.testid.slice(5))).sort((a,b) => a-b)), expectedTargets.sort((a,b) => a-b));
    if (width !== 390) await page.locator('.rf-game-frame').screenshot({ path: resolve(`work/deep-dig-checks/flag-target-${width}.png`) });
    const revealedSide = adjacent(flagBefore.run.position).find(i => flagBefore.run.cells[i].revealed);
    assert.notEqual(revealedSide, undefined);
    await page.keyboard.press(directionKey(revealedSide - flagBefore.run.position));
    await unchanged(flagBefore); assert.ok(await page.locator('.tile.flag-target').count() > 0, 'invalid revealed neighbour leaves flag action armed');
    await page.keyboard.down(flagKey);
    const keyedFlag = await state();
    assert.equal(keyedFlag.run.cells[source].flagged, true);
    assert.equal(keyedFlag.run.position, flagBefore.run.position);
    assert.deepEqual(keyedFlag.run.bag, flagBefore.run.bag);
    assert.deepEqual(keyedFlag.run.cells.map(c => c.revealed), flagBefore.run.cells.map(c => c.revealed));
    assert.equal(await page.locator('.tile.flag-target').count(), 0, 'successful flag exits one-shot mode');
    await page.keyboard.down(flagKey); await page.keyboard.up(flagKey); await unchanged(keyedFlag);
    assert.equal(await page.getByRole('heading', { name: 'Risk opening this flag?' }).count(), 0, 'held-key repeat cannot walk after flagging');
    if (touch) {
      const flagToggle = button('Flag a direction');
      await flagToggle.tap();
      assert.equal(await flagToggle.getAttribute('aria-pressed'), 'true');
      await flagToggle.tap();
      assert.equal(await flagToggle.getAttribute('aria-pressed'), 'false');
      await unchanged(keyedFlag);
      await flagToggle.tap();
      const eligibleDirections = expectedTargets.map(i => directionKey(i - flagBefore.run.position).replace('Arrow', '').toLowerCase()).sort();
      assert.deepEqual(await page.locator('.direction-pad [data-can-flag=true]').evaluateAll(nodes => nodes.map(n => n.dataset.direction).sort()), eligibleDirections, 'only usable flag directions highlight');
      assert.deepEqual(await page.locator('.direction-pad [data-direction]:not(:disabled)').evaluateAll(nodes => nodes.map(n => n.dataset.direction).sort()), eligibleDirections, 'unusable flag arrows are disabled');
      assert.equal(await page.locator('.touch-hint').count(), 0);
      assert.equal(await page.locator('.direction-pad [data-direction]').first().evaluate(n => getComputedStyle(n).borderWidth), '0px');
      await page.screenshot({path:`work/deep-dig-checks/mobile-flag-${width}.png`,fullPage:true});
      if (portrait) {
        const pad = await page.locator('.direction-pad').boundingBox(), centre = await flagToggle.boundingBox();
        assert.ok(Math.abs(centre.x + centre.width / 2 - pad.x - pad.width / 2) < 1);
        assert.ok(Math.abs(centre.y + centre.height / 2 - pad.y - pad.height / 2) < 1);
        assert.equal(centre.width, 52);
        const rewards = await page.locator('.reward-summary').boundingBox();
        assert.ok(rewards.y >= pad.y + pad.height, 'reward details sit below the enlarged controls');
      }
      const flagName = 'Flag ' + directionKey(source - flagBefore.run.position).replace('Arrow','').toLowerCase();
      await button(flagName).tap();
      assert.equal(await flagToggle.getAttribute('aria-pressed'), 'false', 'unflag returns to movement');
      await flagToggle.tap(); await button(flagName).tap();
      assert.equal((await state()).run.cells[source].flagged, true, 'touch centre button places a flag');
      assert.deepEqual((await state()).run.bag, flagBefore.run.bag);
      assert.deepEqual((await state()).run.cells.map(c => c.revealed), flagBefore.run.cells.map(c => c.revealed));
      await flagToggle.tap(); await button(flagName).tap();
      assert.equal(await flagToggle.getAttribute('aria-pressed'), 'false');
    } else {
      await page.keyboard.press('f');
      await page.keyboard.press({ ArrowUp: 'w', ArrowDown: 's', ArrowLeft: 'a', ArrowRight: 'd' }[flagKey]);
    }
    assert.equal((await state()).run.cells[source].flagged, false);
    assert.equal((await state()).run.position, flagBefore.run.position);
    await page.keyboard.press('f'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.tile.flag-target').count(), 0, 'Escape cancels flag targeting');
    await page.keyboard.press(directionKey(revealedSide - flagBefore.run.position));
    assert.equal((await state()).run.position, revealedSide, 'ordinary walking resumes after cancellation');
    await tap(flagBefore.run.position);
    await page.keyboard.press('f'); await page.keyboard.press('f');
    assert.equal(await page.locator('.tile.flag-target').count(), 0, 'F cancels flag targeting too');

    if (touch) {
      const session = await context.newCDPSession(page), box = await tile(source).boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const before = await state();
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await page.waitForTimeout(530);
      const held = await state(); assert.equal(held.run.cells[source].flagged, true); assert.equal(held.run.position, before.run.position); assert.deepEqual(held.run.bag, before.run.bag);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(80); await unchanged(held);
      assert.equal(await page.getByRole('heading', { name: 'Risk opening this flag?' }).count(), 0, 'long press must not trigger walking on release');
      await flag(source);
      const dragBefore = await state(); await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 12, y: point.y }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await unchanged(dragBefore); await session.detach();
    }
    s = await state(); await button('Open settings').click(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('e'); await page.keyboard.press('f'); await unchanged(s);
    assert.equal(await page.getByLabel('Reduce motion').count(), 0);
    assert.equal(await button('Sound on').getAttribute('aria-pressed'),'true', 'new offline games default sound on');
    assert.equal(await button('Sound on').locator('svg').count(), 1);
    await button('Sound on').click(); await button('Close Expedition settings').click();
    await page.reload(); await page.locator('.mine-board').waitFor(); await button('Open settings').click();
    assert.equal(await button('Sound off').getAttribute('aria-pressed'),'false', 'saved mute survives reload');
    await button('Sound off').click(); await bounds(); await button('Close Expedition settings').click();
    await page.reload(); await page.locator('.mine-board').waitFor(); await unchanged(s);
    await button('Open settings').click(); assert.equal(await button('Sound on').getAttribute('aria-pressed'),'true'); await button('Close Expedition settings').click();
    assert.equal(await page.locator('.pickup-shimmer').count(), 0, 'loading carried RF is not a new pickup');
    assert.equal(await artwork('.friend-tile .friend-avatar'), canonicalFace);
    await page.screenshot({ path: resolve(`work/deep-dig-checks/game-${width}.png`) });
    await page.locator('.rf-game-frame').screenshot({ path: resolve(`work/deep-dig-checks/frame-${width}.png`) }); await bounds();
    // Extract a partial haul without any orb or full-board requirement.
    s = await state(); const partialHaul = amount(s.run.bag); assert.ok(partialHaul > 0n); assert.ok(s.run.cells.every(c => !c.mystery || !c.revealed)); assert.ok(s.run.cells.some(c => !c.mystery && !c.revealed));
    await extract(); s = await state(); assert.equal(s.run, null); assert.equal(BigInt(s.wallets['7730'].$rf), 19n * RF + partialHaul); assert.equal(total(s), 1_000_040n * RF);

    // Real UI movement routes to a known fixture orb, then a known fixture mine.
    await enter(); await tap(34); s = await state(); const orb = s.run.cells.findIndex(c => c.mystery && !c.mine), mine = s.run.cells.findIndex(c => c.mine); assert.ok(orb >= 0 && mine >= 0);
    await approach(orb); await flag(orb); const beforeOrb = await state(), potBeforeOrb = await ledgerPot(); await tap(orb); await button('Risk this tile').click();
    await orbPlayContinues(orb, beforeOrb, 'first orb');
    assert.match(await tile(orb).getAttribute('aria-label'), /orb recovered/);
    await checkPot(potBeforeOrb); assert.equal(await artwork('.friend-tile .friend-avatar'), canonicalFace);
    await page.locator('.rf-game-frame').screenshot({ path: resolve(`work/deep-dig-checks/first-orb-${width}.png`) });
    await bounds();

    const extraOrb = (await state()).run.cells.findIndex((c, i) => i !== orb && c.mystery && !c.mine);
    assert.ok(extraOrb >= 0, 'fixture includes a later orb');
    await approach(extraOrb); await flag(extraOrb); const beforeExtraOrb = await state(); await tap(extraOrb); await button('Risk this tile').click();
    await orbPlayContinues(extraOrb, beforeExtraOrb, 'later orb');

    const untouched = (await state()).run.cells;
    const unopenedMine = untouched.findIndex((c, i) => c.mystery && c.mine && !c.revealed && i !== mine);
    const unopenedOrb = untouched.findIndex(c => c.mystery && !c.mine && !c.revealed);
    assert.ok(unopenedMine >= 0 && unopenedOrb >= 0, 'fixture retains both hidden outcomes after two recovered orbs');
    await flag(unopenedMine); await flag(unopenedOrb);
    await approach(mine); await flag(mine); const beforeMine = await state(), endangered = amount(beforeMine.run.bag);
    if (!touch) await page.emulateMedia({ reducedMotion: 'no-preference' });
    await tap(mine); await button('Risk this tile').click();
    assert.equal(await page.getByRole('heading', { name: 'Mine hit. Haul lost.' }).count(), 0, 'mine burst precedes popup');
    await page.locator('.mine-burst').waitFor();
    assert.equal(await page.locator('.mine-burst line').count(), 8);
    assert.equal(await artwork('.friend-tile .friend-avatar'), canonicalFace);
    const mineMotion = await page.locator('.mine-burst .blast-ray').first().evaluate(n => getComputedStyle(n).animationName);
    assert.equal(mineMotion === 'none', touch, 'mine effect respects reduced motion');
    s = await state(); assert.equal(s.wallets['7730'].$rf, beforeMine.wallets['7730'].$rf); assert.equal(amount(s.lost), endangered); assert.equal(total(s), 1_000_040n * RF);
    await checkPot(globalPot(beforeMine)); await bounds();
    assert.match(await page.locator('.depth-title').innerText(), /DEPTH 01/);
    assert.equal(await page.locator('.lost-haul').count(), 1);
    assert.equal(await page.getByTestId('entry-loss').innerText(),`+ ${Number(BigInt(s.result.stake.$rf)/RF)} RF entry`);
    assert.equal(parseShownRF(await page.getByTestId('bag').innerText()),endangered,'entry is displayed separately, never added to the haul or charged again');
    assert.equal(await page.getByRole('button', { name: 'Enter mine 1 sim RF ↘', exact: true }).count(), 0, 'failed board is not replaced by camp controls');
    await page.keyboard.down('ArrowRight'); await unchanged(s);
    const unopenedSources = s.result.cells.flatMap((c, i) => c.mystery && !c.revealed ? [i] : []);
    const recoveredOrbs = s.result.cells.filter(c => c.mystery && c.revealed && !c.mine).length;
    assert.equal(await page.locator('.tile.mine-hit').count(), 1, 'only the mine actually hit is red');
    assert.equal(await tile(mine).getAttribute('data-state'), 'mine');
    assert.equal(await page.locator('.tile.mine-hit.treasure-tile').count(), 0);
    assert.equal(await page.locator('.tile .treasure.mystery').count(), recoveredOrbs);
    const sourcesShown = await page.locator('.tile.source-unopened').evaluateAll(nodes => nodes.map(n => ({
      cell: Number(n.dataset.testid.slice(5)), state: n.dataset.state,
      label: n.getAttribute('aria-label').split(': ')[1], symbol: n.querySelector('[data-icon]')?.getAttribute('data-icon') ?? n.textContent,
      mineMark: !!n.querySelector('.mine-mark'), flagMark: !!n.querySelector('.flag-mark')
    })));
    assert.deepEqual(sourcesShown, unopenedSources.map(cell => ({ cell, state: 'source', label: 'unopened resonance source, orb or mine', symbol: 'source', mineMark: false, flagMark: false })), 'all unopened sources look identical, including flags and both hidden outcomes');
    assert.equal(await page.locator('.board-legend,.title-pick').count(),0);
    await page.locator('.rf-game-frame').screenshot({ path: resolve(`work/deep-dig-checks/mine-reveal-${width}.png`), animations: 'allow' });
    await outcomeReady(); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
    await page.getByRole('dialog', { name: 'YOU HIT A MINE.' }).waitFor();
    await unchanged(s); await bounds();
    assert.equal(await page.locator('.reveal-hit-area,.reveal-continue').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'View result', exact: true }).count(), 0);
    assert.equal(await page.locator('.status').innerText(), '');
    assert.equal(await page.locator('.rf-frame-menu').count(), 0, 'mine uses the on-board card rather than a result menu');
    assert.equal(await page.locator('.mine-result-card').evaluate(node => {
      const card=node.getBoundingClientRect(), board=document.querySelector('.mine-board').getBoundingClientRect();
      return card.left>=board.left && card.right<=board.right && card.top>=board.top && card.bottom<=board.bottom;
    }),true,'mine card fits inside the board');
    if (!touch) {
      await page.reload(); await page.getByRole('button', { name: /^Friend #7730/ }).click(); await unchanged(s);
      await page.getByRole('dialog', { name: 'YOU HIT A MINE.' }).waitFor();
    }
    await page.locator('.rf-game-frame').screenshot({ path: resolve(`work/deep-dig-checks/mine-result-${width}.png`) });
    await button('Try again').click();
    const retried=await state();
    assert.equal(retried.run,null,'try again returns to stake selection without starting or charging');
    assert.deepEqual(retried.wallets,s.wallets,'try again does not charge');
    assert.equal(retried.pool.$rf,s.pool.$rf,'try again does not change the pool');
    assert.equal(await page.locator('.stake-options button').count(),8);
    if (!touch) await page.emulateMedia({ reducedMotion: 'reduce' });

    // Full progression in one viewport; the same independent outcome seed works
    // for each viewport, and all walking stays on connected ordinary ground.
    if (!touch) {
      await enter(); await tap(34);
      for (let depth = 1; depth <= 3; depth++) {
        for (let i = 0; i < 80; i++) { const run = (await state()).run; if (!run.cells[i].mystery && !run.cells[i].revealed) await walkTo(i); }
        s = await state(); assert.equal(s.run.cells.filter(c => c.revealed && !c.mystery).length, 80 - s.run.mysteryCount);
        if (depth === 1) {
          const edge = s.run.cells.findIndex((c, i) => !c.mystery && (i < 10 || i >= 70 || i % 10 === 0 || i % 10 === 9));
          assert.ok(edge >= 0); await walkTo(edge);
          const edgeBefore = await state(), outward = edge < 10 ? 'ArrowUp' : edge >= 70 ? 'ArrowDown' : edge % 10 === 0 ? 'ArrowLeft' : 'ArrowRight';
          await page.keyboard.press('f'); await page.keyboard.press(outward); await unchanged(edgeBefore);
          assert.equal(await page.locator('.mine-board').getAttribute('data-flag-direction'), 'true', 'off-board direction leaves flag action armed');
          await page.keyboard.press('Escape'); assert.equal(await page.locator('.mine-board').getAttribute('data-flag-direction'), 'false');
        }
        if (depth < 3) {
          assert.equal(await button('Go deeper Recover 1 orb').isDisabled(), true);
          const win = s.run.cells.findIndex(c => c.mystery && !c.mine); assert.ok(win >= 0); await approach(win); await flag(win); await tap(win); await button('Risk this tile').click();
          assert.equal(await page.locator('.rf-frame-menu,.reveal-hit-area').count(), 0, 'orb unlocks descent without a guidance popup');
          assert.equal(await button('Go deeper Higher rewards ↘').isEnabled(), true);
          const carried = (await state()).run.bag, bank = (await state()).wallets['7730'], potBeforeDescent = await ledgerPot(); await button('Go deeper Higher rewards ↘').click(); await button('Confirm preview').click();
          s = await state(); assert.equal(s.run.depth, depth + 1); assert.deepEqual(s.run.bag, carried); assert.deepEqual(s.wallets['7730'], bank); assert.equal(total(s), 1_000_040n * RF); await checkPot(potBeforeDescent); await tap(34);
        }
      }
      assert.equal(await button('Deepest level Extract to finish').isDisabled(), true);
      const finalOrb = (await state()).run.cells.findIndex(c => c.mystery && !c.mine); assert.ok(finalOrb >= 0);
      await approach(finalOrb); await flag(finalOrb); await tap(finalOrb); await button('Risk this tile').click();
      assert.equal(await page.locator('.rf-frame-menu,.reveal-hit-area').count(), 0, 'deepest-level orb does not interrupt extraction');
      await extract();
    }
    await button('How to play ?').click(); assert.doesNotMatch(await page.locator('.rf-frame-menu').innerText(),/\d+%.*(?:orb|mine)|odds/i); assert.match(await page.locator('.rf-frame-menu').innerText(), /first square is safe/); assert.match(await page.locator('.rf-frame-menu').innerText(), /8 surrounding tiles/); assert.doesNotMatch(await page.locator('.rf-frame-menu').innerText(), /global pot|percentages|% of pot/i); await bounds(); await button('Close How to play').click();
    assert.equal(await page.locator('.log-button').count(),0);
    await button('Open settings').click();
    assert.equal(await page.getByRole('button',{name:/Expedition log/}).count(),0);
    await bounds();await button('Close Expedition settings').click();
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(`PASS ${width}×${height}: keyboard/touch walking, no remote digging, flood versus collection, square canonical face without clue overlap, RF pickup shimmer, uninterrupted first/later orbs with one-time rewards, automatic on-board mine retry card, F directional flagging/cancellation/repeat handling, flagging${touch ? '/long-press/drag cancellation' : ''}, risk cancellation/win/loss, partial extraction, persistence, menu pause, conservation, internal pool accounting, RF-only level maximums without global-pot or percentage UI, panel bounds/overlap and zero wallet/external requests${touch ? '' : ', three-depth progression'}.`);
    await context.close();
  }

  {
    const context=await browser.newContext(),page=await context.newPage();await page.goto(origin);
    await page.getByRole('button',{name:/^Friend #7730/}).click();await page.getByRole('button',{name:'Stake 5 RF',exact:true}).click();
    await page.getByRole('button',{name:'Enter mine 5 sim RF ↘',exact:true}).click();
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
    assert.equal(BigInt(saved.run.stake.$rf),5n*RF);assert.equal(BigInt(saved.wallets['7730'].$rf),15n*RF);
    assert.equal(amount(saved.run.future)+amount(saved.run.caches.flatMap(c=>c.loot)),12020n*RF/100n);
    assert.equal(await page.locator('.pool-shortfall').count(),0);
    await checkLevelRewards(page);await page.reload();await page.locator('.dig').waitFor();
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY),saved);
    await checkLevelRewards(page);assert.match(await page.locator('.run-stake').innerText(),/5 RF stake/);
    await page.getByRole('button',{name:/^Extract & finish/}).click();await page.getByRole('button',{name:'Extract and return to camp',exact:true}).click();
    assert.equal(await page.locator('.pool-shortfall').count(),0,'a settled run must not show funding-shortfall warnings');
    const ended=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);assert.equal(total(ended),1_000_040n*RF);assert.equal(globalPot(ended),1_000_005n*RF);
    ended.pool.$rf=(BigInt(ended.pool.$rf)+BigInt(ended.wallets['7730'].$rf)).toString();ended.wallets['7730'].$rf='0';ended.result=null;
    await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:KEY,raw:JSON.stringify(ended)});await page.reload();await page.getByRole('button',{name:/^Friend #7730/}).click();
    assert.match(await page.locator('.stake-picker').innerText(),/Not enough RF in wallet/);assert.equal(await page.locator('.pool-shortfall').count(),0);
    assert.equal(await page.getByRole('button',{name:'Enter mine 1 sim RF ↘',exact:true}).isDisabled(),true);
    await context.close();console.log('PASS selected stake: 5 RF debit, scaled rewards, three-level backing, reload, exact release and correct empty-wallet messaging.');
  }

  {
    // Isolated low-pool fixture: maxima stay visible with inline funding warnings.
    const context = await browser.newContext(), page = await context.newPage(); await page.goto(origin);
    const rf = n => ({ $rf: (BigInt(n) * RF).toString() });
    const low = { version: 4, poolSeeded: true, revision: 0, serial: 0, wallets: { '7730': rf(70), '3412': rf(20) }, pool: rf(10), lost: [], run: null, result: null, history: ['Low pool UI fixture.'] };
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: KEY, raw: JSON.stringify(low) }); await page.reload();
    await page.getByRole('button', { name: /^Friend #7730/ }).click();
    const readLow = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
    assert.equal(globalPot(await readLow()), 10n * RF);
    await checkLevelRewards(page);
    for (const depth of [1,2,3]) { const row=page.getByTestId(`level-budget-${depth}`);assert.equal(await row.getAttribute('data-funded'),'false');assert.match(await row.locator('.pool-shortfall').innerText(),/Pool too low/); }
    assert.equal(await page.getByRole('button',{name:'Enter mine 1 sim RF ↘',exact:true}).isDisabled(),true);
    assert.deepEqual(await readLow(),low,'funding refusal must not debit, refill or alter the save');
    await context.close();console.log('PASS low-pool UI: prevents entry before any charge; no automatic refill.');
  }

  {
    const context = await browser.newContext(), page = await context.newPage(); await page.goto(origin);
    await page.getByRole('button', { name: /^Friend #7730/ }).click();
    await page.getByRole('button', { name: 'Enter mine 1 sim RF ↘', exact: true }).click();
    const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
    const old = structuredClone(original),r=old.run;
    old.pool.$rf=(BigInt(old.pool.$rf)+amount(r.future)+amount(r.caches.flatMap(c=>c.loot))).toString();
    delete r.future;delete r.stake;delete r.layout;r.mysteryCount=8;r.hazards=r.hazards.slice(0,8);
    const ground=[...Array(4).fill(RF/100n),...Array(4).fill(RF/50n),...Array(4).fill(3n*RF/100n),...Array(60).fill(0n)];
    r.caches=Array.from({length:80},(_,id)=>{const value=id<8?80n*RF/100n:ground[id-8];return{id,kind:id<8?'mystery':'ordinary',cell:null,opened:false,loot:value?[{name:'Legacy reward',amount:{$rf:value.toString()}}]:[]};});
    old.pool.$rf=(BigInt(old.pool.$rf)-amount(r.caches.flatMap(c=>c.loot))).toString();
    await page.evaluate(({ key, old }) => localStorage.setItem(key, JSON.stringify(old)), { key: KEY, old }); await page.reload();
    await page.locator('.dig').waitFor();
    assert.match(await page.getByTestId('reward-offer').innerText(), /0\.8 RF/);
    await checkLevelRewards(page);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY), old, 'reload preserves the old board, balances and reserved prizes');
    await page.getByRole('button', { name: /^Extract & finish/ }).click();
    await page.getByRole('button', { name: 'Extract and return to camp', exact: true }).click();
    await page.getByRole('button', { name: 'Enter mine 1 sim RF ↘', exact: true }).click();
    assert.match(await page.getByTestId('reward-offer').innerText(), /Each orb\s+1 RF/);
    await checkLevelRewards(page);
    assert.equal(total(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)), 1_000_040n * RF);
    await context.close(); console.log('PASS saved v4 reward compatibility: old boards quote backed 0.80 RF prizes; new boards quote 1 RF without resetting balances.');
  }
  {
    const context = await browser.newContext(), page = await context.newPage(); await page.goto(origin); await page.evaluate(key => localStorage.setItem(key, 'broken'), KEY); await page.reload();
    await page.getByRole('heading', { name: 'Local save needs attention' }).waitFor(); await page.getByRole('button', { name: 'Reset damaged save', exact: true }).click(); await page.getByRole('button', { name: 'Confirm reset', exact: true }).click(); await page.getByRole('heading', { name: 'Choose your Friend', exact: true }).waitFor(); await context.close(); console.log('PASS corrupt-save recovery.');
  }
  for (const version of [1, 2, 3]) {
    const context = await browser.newContext(), page = await context.newPage(); await page.goto(origin);
    const rf = n => ({ $rf: (BigInt(n) * RF).toString() });
    const raw = JSON.stringify({ version, revision: 4, serial: 1, wallets: { '7730': rf(19), '3412': rf(20) }, pool: rf(version < 3 ? 54 : 55), lost: [{ amount: rf(1), name: 'Past loss', owner: '7730', run: 1 }], run: { friend: '7730', bag: [{ amount: rf(2), name: 'Carried old reward' }], [version === 1 ? 'nodes' : 'caches']: [{ opened: false, loot: [{ amount: rf(4), name: 'Reserved old reward' }] }] } });
    await page.evaluate(({ version, raw }) => localStorage.setItem(`deep-dig.offline.v${version}`, raw), { version, raw }); await page.reload(); await page.getByRole('button', { name: /^Friend #7730/ }).click();
    assert.equal(await page.getByTestId('balance').textContent(), '21 RF'); assert.equal(await page.locator('.status').innerText(), ''); await checkLevelRewards(page);
    await page.getByRole('button', { name: 'Enter mine 1 sim RF ↘', exact: true }).click();
    const migrated = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY); assert.equal(migrated.version, 4); assert.equal(total(migrated), 1_000_041n * RF); assert.equal(globalPot(migrated), 1_000_001n * RF, 'one-time top-up preserves wallets, then entry adds 1 RF'); assert.equal(await page.evaluate(v => localStorage.getItem(`deep-dig.offline.v${v}`), version), raw); await checkLevelRewards(page);
    await context.close(); console.log(`PASS v${version}→v4 migration: banks active haul, returns reserves, preserves balances/provenance and original save.`);
  }
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) { console.error((await page.locator('body').innerText()).slice(-4000)); console.error(await page.locator('.dig-panel > *, .walking-controls, .status').evaluateAll(nodes => nodes.map(n => ({ class: n.className, y: n.getBoundingClientRect().y, h: n.getBoundingClientRect().height })))); console.error(await page.locator('.friend-tile, .friend-tile .clue, .friend-token, .friend-token canvas').evaluateAll(nodes => nodes.map(n => ({ class: n.className, box: n.getBoundingClientRect().toJSON(), font: getComputedStyle(n).fontSize })))); await page.screenshot({ path: resolve('work/deep-dig-checks/failure.png') }); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(ok => server.close(ok)); await built.close(); }
