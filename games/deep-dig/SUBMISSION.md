# Deep Dig — Vibeathon submission draft

Status: public simulated preview and clean source published. No Vibeathon submission PR, real-RF funding, signatures, transactions or official production release have been performed.

## Entry details to complete before submission

- Project: **Deep Dig**.
- Builder: **chimph**.
- Contact: **[@intocryptoast on X](https://x.com/intocryptoast)**.
- Suggested category: **Economy Potential**; builder to confirm.
- One sentence: Walk your selected Rare Friend through a resonance minefield, collect simulated RF and decide whether to extract your haul or risk another fully backed depth.
- Source repository: [chimph/rf-deep-dig](https://github.com/chimph/rf-deep-dig).
- Public playable preview: [Deep Dig](https://chimph.github.io/rf-deep-dig/). Wallet connection and an eligible Generations NFT on Robinhood are required; all RF is simulated.
- Stack: React 19, TypeScript, FriendSDK **0.1.2**, based on upstream commit `762d6f58a73ace723f7f82dc1a61bfa036c21edc`, with a local read-only Friend picker extension (menu shortcut, canonical art cards and eight-ID pages).

Licensing: the [licensing map](../../LICENSE) preserves FriendSDK and prior Apache-2.0 permissions. New original Deep Dig material has [evaluation terms](../../LICENSES/Deep-Dig-Evaluation.txt) allowing inspection, private testing and competition judging; these do not grant commercial reuse rights for covered new material. No ownership transfer or exclusivity is offered.

## Run locally

Requires Node.js 22+, npm, and a browser wallet supported by the SDK. From this project root:

```sh
npm ci
npm run dev:deep-dig:submission
```

Open **http://localhost:4175**. Connect a wallet that owns a hardwired Rare Friends Generations NFT (generation ≥ 1) on **Robinhood mainnet, chain 4663**, then select a Friend. The runtime offers a network switch if needed. Connection and ownership/artwork reads require no RF funding, signing or transaction. WalletConnect/native wallet deep links are not supplied by this SDK.

`npm run build:deep-dig:submission` creates `games/deep-dig/.friendsdk/` locally. It does not upload anything. The dedicated Deep Dig runner rejects deployment options and reserves ports 4173/4174 for offline use. The game itself also refuses a chain-mode client.

The preserved offline version runs with `npm run dev:deep-dig` at **http://localhost:4173**. Keep that exact browser/origin to retain its save. It uses sample artwork with no ownership claim and is not the wallet-gated submission preview. Never publish it as the gated entry.

## Play

Choose a stake, enter once, and select your first tile. Arrow keys/WASD walk one cardinal tile; touch supports adjacent tiles and a direction pad. F then a direction flags a neighbor; right-click/450 ms long-press flags any covered tile. A flagged tile requires confirmation to risk. Clues count both orb and mine sources, without distinguishing them. Walk onto revealed finds to collect them.

Reveal all ordinary ground and collect an orb on a level to descend free, carrying the entire haul at risk. Extract at any time to bank collected RF and finish. Any mine loses the unbanked haul. An idle warning appears after nine minutes; after ten, only entry is refunded and the haul is discarded. Settings contains the sound icon, Choose Friend, How to play, abandonment, simulated top-up and confirmed reset. System reduced-motion preferences are respected. UI stays inside the runtime frame; portrait content scrolls internally.

## Exact simulated economy

All amounts use bigint base units: **1 RF = 10^18 units**. The selected Friend starts with **20 simulated RF** and the session pool starts with **1,000,000 simulated RF**. The offline two-sample economy retains its existing saves and separate balances.

Entry options are **1, 2, 5, 10, 20, 50, 80, 100 RF**, paid once for up to three depths. The entry cap is the smaller of clean-rounded wallet funds and `cleanRoundDown(freePool / (24.04 × 500))` in whole RF; disabled choices stay visible. Admission reserves **24.04 × stake** before starting. Future reserves, current uncollected rewards and carried haul cannot share backing.

Every new 80-tile level has exactly **five orbs, five mines and 70 ordinary tiles**. Twelve ordinary tiles pay finds. The first tile and its eight neighbors are ordinary. Connected ground is guaranteed; solving without guesses is not. Source geometry and the fixed outcome split are shuffled separately. Among previously untried sources, the initial chance is 5/10 orb and 5/10 mine; after `k` orbs and no mine, the remaining chance is `(5-k)/(10-k)` orb and `5/(10-k)` mine. These are draws without replacement, not repeated 50/50 rolls. Ground clues do not identify which source is an orb.

Prizes below are multiplied by the selected stake:

| Depth | Ground finds (four of each) | Ground total | Each orb | Maximum level |
|---|---|---:|---:|---:|
| 1 | 0.01 / 0.02 / 0.03 RF | 0.24 RF | 1.00 RF | 5.24 RF |
| 2 | 0.02 / 0.04 / 0.06 RF | 0.48 RF | 1.36 RF | 7.28 RF |
| 3 | 0.03 / 0.06 / 0.09 RF | 0.72 RF | 2.16 RF | 11.52 RF |

A maximum expedition returns 24.04 × stake gross. Descent costs zero. Extraction pays only collected RF; unused backing returns to the pool. Mines and abandonment return haul plus unused backing to the pool. Idle cancellation refunds only the locked entry once, with no additional haul payout. Lost-haul provenance tags describe existing pool money and never create extra funds. Top-up/reset issue simulated funds only and are labeled as such.

Detailed mechanics and save behaviour: [game README](README.md) and [game metadata](game.json).

The top-level `game.json` weighted table describes only the first depth-one source at a 1 RF stake. It exists for SDK definition compatibility. This compatibility table does **not** describe a complete expedition. The `deepDig` metadata and engine define the actual rules above.

## Planned live pool funding and owner withdrawals

For a future approved live release, I plan to personally seed the prize pool with **1,000,000 RF**, with the aim of growing the bankroll through play. Growth is an objective, not a guarantee: player wins can reduce the bankroll, and my seed capital is at risk. There is no fixed developer profit percentage or committed reinvestment rate. I intend to retain discretion over when and how much uncommitted house funding to withdraw, including profits or unused seed capital. Contributions and capital withdrawals would be recorded separately from operating profit.

**Player funds must remain protected from owner withdrawals.** The live implementation must prevent withdrawals of player balances, unpaid winnings or refunds, and the backing for active expeditions' maximum remaining payouts. Withdrawals and new entries must use the same authoritative, atomic accounting so those obligations cannot share backing or be spent twice. A withdrawal may reduce stake limits or stop new entries, but must not reduce an existing expedition's agreed rewards or reserved backing. This protects funds from owner withdrawal; it does not remove the player's normal gameplay risk to their stake or unbanked haul.

If the game winds down, new entries would stop first. Existing expeditions would settle under their agreed rules, and outstanding player claims would remain fully backed and withdrawable without expiry. I could withdraw uncommitted house funds immediately and recover further unused reserves as obligations settle, but could not empty funds still owed or committed to players.

**This is a proposed live operating model, not an implemented or verified real-fund safeguard.** The submission uses only simulated RF and a session-local pool; no real seed has been deposited, no owner withdrawal feature is implemented, and no fixed Rare Friends revenue share has been agreed. Authoritative shared accounting, persistence, withdrawal enforcement and settlement require later implementation, testing and Rare Friends production review before real-value play.

## Integration decision and capability limits

Reviewed upstream release, runtime guide and submission requirements on **2026-09-22** before choosing this approach:

| Area | Implemented | Limitation / decision |
|---|---|---|
| Wallet and eligibility | v0.1.2 `GameHost`/`GameSession` with the documented local picker/artwork extension, fresh `readGenerationEligibility`, owner-filtered discovery, canonical NFT wallet resolution | No custom connector, collection scan, sample fallback or relaxed gate. Official runtime cancels old sessions on account/network/Friend changes. |
| Artwork | The host reuses gallery frames through the verified session handshake; `createFriendReader` remains a fallback if artwork was unavailable. The existing pixel renderer uses front/down idle frame, including SDK Colossus fallback | Public artwork reads are separate from ownership. Failed artwork reads block gameplay and offer retry. |
| Economy | Existing pooled simulation, all three depths reserved at entry, unchanged RF prices/prizes/movement | Stock buy/play/settle/redeem cannot represent selectable stakes, multilevel haul, partial extraction, pooled lost-loot recovery or idle refunds. They are deliberately unused. |
| Runtime balance | `client.read()` completes the standard session handshake | Stock fixed-table balance is unrelated and hidden by `host.css`, with a wallet-menu explanation. The Deep Dig header is the game's simulated balance. No two balances are synchronized or claimed equivalent. |
| Identity of funds | One in-memory balance for the currently verified selected Friend | The bridge provides a token ID, not a durable canonical-wallet ledger. No simulated RF is transferred to any real wallet. Balances are not attached to the owner's address and do not survive transfers/session changes. Durable canonical-wallet accounting remains future work. |
| Persistence | Submission memory only; offline localStorage retained separately | The opaque SDK sandbox has no localStorage/IndexedDB or save bridge. Refresh, disconnect, account/network/Friend change discards the submission session. Only the sound mute preference is stored by the host through a fixed boolean message. No game-save proxy, parent access, permission expansion or migration was added. |
| Shared pool | Existing pooled arithmetic is preserved within a session | There is no global pool shared between users, browser tabs, sessions or devices. No server or atomic multiplayer admission service exists. |
| Trust | Local simulation with conservation checks | Board, RNG, balances and clock are inspectable/editable. Wallet verification does not make outcomes authoritative or prevent cheating. |
| Layout | 960×640 desktop reference with responsive game UI and contained portrait scrolling | Wallet controls stay in the trusted frame; no outside navigation or menus. Phone tests are emulated, not proof of every mobile wallet combination. |
| Live actions | None | A future authoritative ledger, hidden-board service, persistence and separately reviewed outcome/settlement integration are required before any real-value version. No transaction adapters or contracts were implemented. |

Using the fixed-table actions would alter the accepted economy. Adding a save bridge/server would extend the SDK trust boundary and scope. Keeping the simulation inside the standard gated sandbox is the smallest integration that preserves the game, with these limits stated explicitly.

## Assets and verification

Rare Friend artwork: canonical Generations frames via FriendSDK's pinned registry. SDK source is Apache-2.0; SDK artwork permissions are in [NOTICE.md](../../NOTICE.md). Silkscreen is locally bundled under the [SIL Open Font License](fonts/Silkscreen-OFL.txt). Board vectors and effects are local project assets in `pixel-art.tsx` and CSS. No generated replacement Friend artwork is used.

See [SUBMISSION-CHECKS.md](SUBMISSION-CHECKS.md) for exact commands, tested identity failures, screenshots and remaining real-wallet verification.

## Submission readiness

The current [Vibeathon requirements](https://github.com/spokesz/rarefriends-vibeathon/blob/main/README.md) request a PR adding `submissions/deep-dig/README.md`, a source repository, public playable game URL, builder details, controls/economics, credits and check results. Deadline: **September 30, 2026**, exact cutoff/timezone **TBA** at the review date. Simulated purchases and rewards are explicitly allowed. [FriendSDK release notes](https://github.com/spokesz/friendsdk/blob/762d6f58a73ace723f7f82dc1a61bfa036c21edc/CHANGELOG.md) and [runtime limitations](https://github.com/spokesz/friendsdk/blob/762d6f58a73ace723f7f82dc1a61bfa036c21edc/HOST_INTEGRATION.md) informed this integration.

This draft is **not yet submit-ready**: final actual-wallet smoke verification and category confirmation remain outstanding. Public source and the playable preview are available at the links above. Opening the Vibeathon submission PR still requires a separate user request. Official real-RF production publication is a later Rare Friends review.
