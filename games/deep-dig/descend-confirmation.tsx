import { GameMenu } from '@rarefriends/friendsdk/frame';
import { lootRange, maxReserve, money, mysteryReward, runStake, sum, type Run } from './engine.js';

export default function DescendConfirmation({ run, onCancel, onConfirm }: {
  run: Run;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const depth = run.depth + 1;
  const stake = runStake(run);
  const ground = lootRange(depth, stake);
  return <GameMenu title={`Progress to level ${depth}?`} onClose={onCancel}
    footer={<><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="rf-frame-primary" onClick={onConfirm}>Continue</button></>}>
    <p>Higher rewards - no extra entry fee.</p>
    <table className="level-budgets descend-rewards" aria-label="Next level rewards">
      <caption>RF Rewards</caption>
      <thead><tr><th scope="col">Ground finds</th><th scope="col">Each orb</th><th scope="col">Up to</th></tr></thead>
      <tbody><tr className="current-level">
        <td>{money(ground.min)}–{money(ground.max)}</td>
        <td>{money(mysteryReward(depth, stake))}</td>
        <td>{money(maxReserve(depth, stake))}</td>
      </tr></tbody>
    </table>
    <p>Hit a mine and you lose your <strong>{money(sum(run.bag))} RF</strong> haul. Your first move is safe.</p>
  </GameMenu>;
}
