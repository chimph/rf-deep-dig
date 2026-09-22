# Deep Dig: requirements for a live release

The [public preview](https://chimph.github.io/rf-deep-dig/) is already playable with simulated RF. This document proposes the work needed for persistent online play and a later real-RF release. None of the server, randomness protocol or live settlement described here is implemented or approved. Existing gameplay, prices, rewards and the separate offline saves should be preserved.

## Proposed starting architecture

Use the existing game interface with one authoritative TypeScript game service and a managed PostgreSQL database. This is a proposed starting point, not a hosting commitment. Choose the provider, region, operating budget and service owner with Rare Friends before implementation. The static frontend can remain separately hosted; a static site alone cannot keep a board secret or enforce a shared pool.

The service would:

- Own each expedition's hidden board, position, haul, flags, deadline and rules version. The browser sends actions, never authoritative balances or outcomes.
- Validate every movement, flag, collection, descent and extraction. Return only information the player is entitled to see: revealed cells, visible clues, current position and public balances. Never send unrevealed mine/orb assignments, future boards or secret seeds to the client, analytics or public logs.
- Save every accepted action and its result atomically. Action IDs and state revisions make retries safe: refreshes, duplicate requests, multiple tabs and server restarts must not create a second charge, move or payout.
- Resume the same expedition after reconnect. Use server time for the nine-minute warning and ten-minute entry-only idle refund. Define infrastructure-outage handling separately before launch; a failed request must not reroll the board.
- Keep all players' pool reservations and liabilities in one durable ledger. Use database transactions and locking or equivalent conflict handling so simultaneous entries cannot spend the same backing.

Start with a conventional HTTPS action API; add push updates only if needed. Before launch, verify backups can be restored, pending expeditions survive a restart, secrets are access-controlled, and monitoring can stop new entries when the service or backing is unhealthy.

## Randomness and hidden boards

The current browser simulation is inspectable and uses preview randomness. Moving that same state into a browser wallet does not make it suitable for real stakes.

| Approach | What it provides | Limitation / proposed use |
|---|---|---|
| Server cryptographic randomness | Unpredictable draws for players while the server keeps boards private | Players still trust the operator. Suitable for a simulated server prototype; not a claim of independently verifiable fairness. |
| Server commitment and later seed reveal | Lets a player check that a committed seed was not changed during the expedition | A server-only commitment does not prove unbiased seed selection or prevent selective cancellation. It needs an agreed input, timing and failure protocol. |
| Verifiable external randomness plus a reviewed secrecy protocol | Can add independently checkable randomness while keeping hidden cells private | Public randomness alone is insufficient: if it directly determines the board, players can reconstruct it. This requires custom design and review, not just adding an RNG call. |

**Proposed next step:** use server cryptographic randomness for simulated integration testing, and agree the production fairness model with Rare Friends before implementing real-RF play. Review whether their Dice integration can support this game's hidden, multistep boards, including delivery timing, recovery, costs and who pays. Do not assume an RNG subsidy is available. The supplied SDK flow is for its fixed outcome game, not an implemented Deep Dig board service. [SDK capabilities](https://github.com/spokesz/friendsdk/blob/main/HOST_INTEGRATION.md#capabilities)

Any chosen protocol must meet these requirements:

1. Fix the rules version, expedition identity, stake and randomness commitments at an agreed point before accepting the player's paid risk. Define the ordering of admission, entropy requests and first-tile selection explicitly. No replacement draws after observing outcomes.
2. Preserve the safe first tile and its neighbours, connected ordinary ground, five orbs/five mines and twelve finds at each depth. The current layout is derived from a shuffled order after the player chooses a starting cell; commit the inputs and deterministic derivation, rather than pretending a complete board exists before that choice. Source geometry must remain independent of the mine/orb assignment.
3. Use an audited deterministic generator with separate random streams for geometry, source assignments and ground finds. Replace the preview's 0–9999 scaling with unbiased bounded sampling in the server implementation. Node's cryptographic API provides unbiased bounded integers for non-replayable server draws; a replayable committed protocol needs its own reviewed deterministic equivalent. [Node crypto documentation](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback)
4. Keep secret inputs private throughout the expedition. If seeds are revealed for verification, do so only after the expedition is irrevocably finished and cannot expose a future playable depth or another player's board.
5. Specify timeout, withheld-seed, delayed-oracle and dispute handling. A commitment can detect some misconduct after the event; it does not by itself force settlement or prevent the operator from withholding service. Never silently fall back to browser randomness.

## Wallet sessions, persistence and settlement

Keep the official wallet selection, eligibility checks and canonical Friend identity. A backend needs authenticated proof of account control and server-side ownership validation; it cannot trust a Friend ID or an eligibility flag sent by the browser. Agree the authentication method with the runtime maintainers, including expiry, replay protection, account/network changes and NFT transfers. Any future authentication signature belongs in the trusted host, not the game sandbox.

The existing SDK bridge has no general board-action or save API. A small, reviewed extension would need fixed actions such as start, move, flag, descend, extract and resume. Do not expose arbitrary server requests, credentials, signers or withdrawal powers to the child. Browser storage must remain separate from the authoritative service, and offline saves must not become redeemable online balances. [Runtime boundaries](https://github.com/spokesz/friendsdk/blob/main/HOST_INTEGRATION.md#serving-and-sandbox)

Real-RF settlement requires a separate approved contract/transport design for the custom pool and multilevel expedition. A database balance is not a confirmed RF payout. Agree how contracts validate outcomes or trusted attestations, how disputes are handled, and how the database reconciles with confirmed chain state. Resume pending actions by their original IDs and handle duplicate receipts, failures and chain reorganisations without duplicate payouts.

Admission must reserve the full maximum expedition payout. Player balances, unpaid winnings, refunds and active-run backing must remain unavailable for owner withdrawal, with enforcement at the layer holding the funds. Wind-down must stop new entries while preserving settlement and non-expiring claims. See the [proposed pool safeguards](SUBMISSION.md#planned-live-pool-funding-and-owner-withdrawals).

## Decisions and acceptance checks

Before real-RF implementation, agree the randomness/privacy protocol, server and database operator, authenticated session design, SDK extension, settlement trust model, incident policy and production review process. Hosting credentials, exact operational secrets and commercial analysis do not belong in this public plan.

Then demonstrate in a simulated staging environment: no hidden-board leakage; reproducible board verification where promised; unchanged game rules; concurrent reservation safety; no duplicate charges or rewards; reconnect/restart recovery; correct ownership-transfer handling; and deterministic idle/outage settlement. Complete an actual eligible-wallet playthrough and the agreed independent review before a separately authorised real-value launch.

The Vibeathon allows simulated entries and asks builders to explain future integration needs; these live systems are not prerequisites for submitting the current simulated preview. [Submission requirements](https://github.com/spokesz/rarefriends-vibeathon/blob/main/README.md)
