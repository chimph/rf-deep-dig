# Deep Dig source-release checks

All gameplay and RF remain simulated. Browser tests use isolated origins and mocked wallet/RPC fixtures; the delivered preview retains real ownership checks and has no playable mock bypass.

## Reproduce

```sh
npm ci
npm test
npm run typecheck
npm run check:games
npx playwright install chromium
npm run check:deep-dig:submission
npm run check:deep-dig:picker
npm run check:deep-dig:browser
npm run check:deep-dig:idle
npm run check:deep-dig:styles
npm run build:deep-dig:submission
```

The focused source package omits upstream example games and contract tooling. `npm test` runs the retained Deep Dig and runtime identity, artwork, wallet, bridge and sound-preference tests. Game validation's fixed-table output concerns SDK compatibility metadata, not a complete expedition.

## Latest source-package verification

The cleaned source package passed an offline clean dependency install, all 87 retained unit tests, runtime/game typechecks, game validation, and the wallet-connected build. Wallet preview, paged picker, offline save/migration, idle-refund and style-parity browser checks also passed in isolated Chromium sessions. The game README screenshot was refreshed from those UI checks. These are local automated results, not a claim of a hosted actual-wallet playthrough.

## Verification scope

- Engine/board/audio checks cover legal movement, flags, once-only collection, extraction, mines, reservations, refunds, conservation, audio routing and save migration.
- Wallet preview browser checks cover desktop mouse, narrow mouse, portrait and landscape touch, selected artwork, entry/extraction, idle settlement, session invalidation and sandbox isolation. Sound preference survives reload; simulated gameplay does not.
- The 73-Friend gallery fixture covers eight-at-a-time loading, cached artwork, fresh eligibility and account changes during pending reads.
- Offline browser checks cover existing saves/migrations and error recovery without touching the user's original browser origin.
- Idle checks cover warning, continuation, expiry, one-time refund, reload and stale confirmations.
- Style checks compare the two builds in one Chromium browser across viewport sizes and pixel densities; they do not claim physical Windows/Brave or every mobile-wallet combination was tested.

## Remaining manual checks

Record an actual eligible-wallet playthrough on the hosted preview, including selecting the builder's NFT, entry, extraction and reconnect. Automated mocked tests do not replace that check. No signature, funding or real transaction is required.

The public release uses a fresh history with the approved `chimph` alias and GitHub noreply email. The release excludes private project notes and analysis; only the cleaned source was published. The approved public contact is [@intocryptoast on X](https://x.com/intocryptoast).

Publication of this simulated preview is separate from a Vibeathon submission and from any future approved real-RF release. No live settlement, shared production ledger or owner-withdrawal enforcement is implemented.

## Previous repository hosted preview verification

Public URL: https://chimph.github.io/deep-dig/ (HTTPS enforced).

[Full source CI](https://github.com/chimph/deep-dig/actions/runs/35667675903) and the [manual preview deployment](https://github.com/chimph/deep-dig/actions/runs/35667696022) passed for source commit `75c60879cfb984cc3822f8e2d451b0a81c65dab6`.

All nine hosted static assets matched the verified local build byte-for-byte. On desktop (1100px) and portrait touch (390px), the actual unmodified hosted page showed the missing-wallet gate without mounting gameplay. Separate isolated browser contexts using internal wallet/RPC fixtures verified artwork, fonts, fresh eligibility reads, sandbox restrictions, entry, extraction and cancellation on network changes against the hosted bundle, with no signing requests. Screenshots were reviewed. These mocked gameplay checks do not claim to verify the builder's real wallet.

The Pages workflow is manual-only and publishes only the simulated wallet build. Pushes and pull requests run checks without deploying. Subsequent documentation-only changes do not change the deployed game assets.

## RF Deep Dig repository transition

The new repository starts from the previously verified source at `2d5466a118cb93bf1f5c6160424cb98e9a2a25ec`, with licensing, contact and repository documentation changes. Historical hosted results above refer to the old repository and URL; they do not establish a deployment for this new repository. No gameplay, build scripts or browser-save keys changed in this transition.
