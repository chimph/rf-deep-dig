# RF Deep Dig

Walk your Rare Friend through a resonance minefield, collect simulated RF, and decide when to extract or risk another depth.

**All RF is simulated. No real purchases, payouts, signatures or transactions.**

**[Play the public simulated preview](https://chimph.github.io/rf-deep-dig/)** · [Source](https://github.com/chimph/rf-deep-dig)

Builder: **chimph** · Contact: **[@intocryptoast on X](https://x.com/intocryptoast)**.

## Licensing

FriendSDK and previously published Apache-licensed material retain their existing permissions. Only new original Deep Dig material is subject to the [evaluation terms](LICENSES/Deep-Dig-Evaluation.txt): inspection, private testing and judging are allowed; commercial reuse and public hosting of covered new material require permission. These terms do not revoke rights in earlier releases. See the [licensing map](LICENSE).

## Wallet-connected preview

Requires Node.js 22+, npm and a browser wallet holding a Rare Friends Generations NFT (generation 1 or higher) on Robinhood mainnet (chain 4663).

```sh
npm ci
npm run dev:deep-dig:submission
```

Open http://localhost:4175. The official FriendSDK runtime connects the wallet, verifies ownership and loads the selected Friend's canonical artwork. Simulation progress resets on refresh or identity changes; the sound preference is remembered.

Build static hosting files with `npm run build:deep-dig:submission`. Only publish `games/deep-dig/.friendsdk/`; the offline build is not the submission preview.

## Offline version

Run `npm run dev:deep-dig` and open http://localhost:4173. It uses two clearly labelled sample Friends without a wallet. Keep the same browser and origin to preserve its existing save. Wallet preview and offline saves are separate.

## Controls and rules

Move with arrows/WASD or touch. Press F then a direction to flag a neighbour; mobile has a centre flag button. Right-click or long-press flags a covered tile. Pay once per expedition, collect finds and orbs, and extract at any time. Reveal the ordinary ground and recover an orb to descend. A mine ends the run and loses its unbanked haul.

See [full controls, costs and rewards](games/deep-dig/README.md), [submission details](games/deep-dig/SUBMISSION.md) and [verification](games/deep-dig/SUBMISSION-CHECKS.md).

## Checks

```sh
npm test
npm run typecheck
npm run check:games
npx playwright install chromium
npm run check:deep-dig:submission
npm run check:deep-dig:picker
npm run check:deep-dig:browser
npm run check:deep-dig:idle
npm run check:deep-dig:styles
```

## Runtime and credits

Deep Dig uses FriendSDK v0.1.2 with local extensions for the Friend gallery, selected artwork reuse and remembered sound. The source includes the runtime required to reproduce those changes; the upstream SDK's demo games and contract development tools are not required for this preview. See [SDK integration](SDK.md), [license](LICENSE), [asset notices](NOTICE.md) and the [font license](games/deep-dig/fonts/Silkscreen-OFL.txt).
