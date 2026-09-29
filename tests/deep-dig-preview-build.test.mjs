import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGame } from '../scripts/dev-game.mjs';

test('published Deep Dig preview excludes transaction and signing capabilities from both bundles', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'deep-dig-readonly-'));
  try {
    await buildGame('games/deep-dig', { outdir });
    const forbidden = ['eth_sendTransaction', 'wallet_sendTransaction', 'writeContract',
      'eth_signTypedData_v4', 'personal_sign', 'eth_sendRawTransaction', 'sendRawTransaction',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function transfer(address to, uint256 value) returns (bool)'];
    for (const file of ['runtime.js', 'game.js']) {
      const source = await readFile(join(outdir, file), 'utf8');
      for (const marker of forbidden) assert(!source.includes(marker), `${file} must exclude ${marker}`);
    }
    const runtime = await readFile(join(outdir, 'runtime.js'), 'utf8');
    for (const marker of ['eth_requestAccounts', 'eth_getLogs', 'eth_call']) {
      assert(runtime.includes(marker), `preview retains ${marker} for connection and public reads`);
    }
  } finally { await rm(outdir, { recursive: true, force: true }); }
});
