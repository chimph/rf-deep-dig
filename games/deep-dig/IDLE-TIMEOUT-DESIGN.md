# Deep Dig — implemented idle cancellation

21 September 2026. Implemented in the local three-level, fixed five-orb/five-mine prototype. All RF is simulated.

## Settlement

After **10 minutes without player activity**, an active run ends automatically. Return **exactly its original entry stake** to the selected Friend's banked balance. Discard the entire unbanked haul into the available pool and release every unused current/future reservation. The buy-in replaces the haul; they are never paid together. The refund is funded from the run's existing backing and settled once.

| Entry stake | Unbanked haul at expiry | Paid back | Haul kept |
| ---: | ---: | ---: | ---: |
| 30 RF | 0 RF | 30 RF | 0 RF |
| 30 RF | 6 RF | 30 RF | 0 RF |
| 30 RF | 80 RF | 30 RF | 0 RF |

Manual extraction remains available before expiry and pays the actual haul, ending the run normally. A mine ends a run immediately; that completed loss can never later qualify for an idle refund. Previously banked winnings are unaffected. Descent never resets or changes the original stake.

## Activity and warning

Start the inactivity clock when the run is accepted. Reset it on an accepted player action: movement, revealing/collecting, placing or removing a flag, descent, or an explicit **Continue playing** acknowledgement. Background requests, animations, page refreshes and reconnecting do not count as activity. The session resumes with its existing deadline.

At nine minutes, show a warning only to that idle player. Example:

> One minute until your run ends. Your 30 RF entry will be returned and your 80 RF unbanked haul will be discarded.

Offer **Continue playing** and **Extract 80 RF**. This is an inactivity warning, not a time limit on an actively played board. When returning after expiry, show the saved cancellation result and exact refunded/discarded amounts.

## Local deadline and persistence

The engine checks the deadline before every gameplay command. The host also checks every second, on focus/visibility changes and on load. At or after the deadline, cancellation wins; a pending extraction or descent cannot later settle as that action. The saved result is idempotent. Expiry closes stale menus and confirmations and shows the entry returned alongside the haul discarded.

Active v4 saves persist `lastActivityAt`. Refreshing preserves it. Older active saves without a timestamp get one fresh ten-minute window on their first upgraded load; the timestamp is saved without rerolling the board or changing RF. This uses the local computer clock, which is editable. Closed or suspended pages settle on reopening/resuming; there is no background service.

## Future shared deadline

A future multiplayer implementation must use its trusted clock and ledger. Check expiry inside the same atomic operation as each gameplay action. At or after the deadline, cancellation wins and the late action is rejected. An action accepted before expiry can extend the deadline or settle the game normally. The timeout worker and requests must share a single idempotent settlement path; no combination of reload, repeated requests, extraction, mine settlement or worker retries may pay twice.

The current local game has no such multiplayer service. These future requirements are not a claim that server timing or transaction races have been tested.

## Reserved backing

The three-level maximum remains **24.04 × stake**, because the timeout pays the stake **instead of** the haul. All three levels are backed before admission. Funds protected for an accepted run cannot be spent on another player's entry. Unused past-floor backing is released during progression while the remaining run stays fully covered. The current run's remaining reserve plus carried haul always covers its entry refund, even when the free pool is zero.

The refund replaces the haul; collected finds cannot be retained as an additional payout after cancellation. The local client is not secure against editing.

One active run per Friend should be enforced by the future shared ledger. This limits that Friend's duplicate reservations; it does not prevent someone using several identities. Idle settlement protects new-entry capacity without changing any accepted player's fully backed descent promise.

## Checks

All 42 engine/geometry tests pass, including refunds below and above the stake, third-floor refunds, zero-free-pool settlement, release of future backing, exact conservation, duplicate calls, mine-loss finality, activity rules, saved deadlines and legacy migration. Desktop and portrait-touch browser tests cover warning timing, Continue playing, stale confirmations, settings, reloads, expired reopening and one-time settlement.


Reproduce from the project directory:

```sh
npm run test:deep-dig
npm run check:deep-dig:idle
```

Earlier reports comparing ten-minute automatic extraction retain their original experimental assumptions. This agreed stake-only refund supersedes automatic extraction as the intended inactivity rule.
