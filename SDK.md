# FriendSDK integration

Deep Dig uses FriendSDK v0.1.4, based on upstream commit `ca3bf183b809ecf22d87c63d88ce03969a3f8da2` from [spokesz/friendsdk](https://github.com/spokesz/friendsdk). SDK source remains under [Apache-2.0](LICENSES/Apache-2.0.txt); artwork permissions and provenance are retained in NOTICE.md and assets/.

The runtime source in `src/` and shared assets in `assets/` are included because this game extends the upstream runtime. Local extensions provide paged owned-Friend cards, an in-game menu shortcut to the trusted selector, reuse of selected canonical artwork, and a host-stored sound preference. Fresh eligibility checks and the opaque sandbox remain intact. These changes are not claimed to be features of the unmodified release.

The package keeps the `@rarefriends/friendsdk` name for local self-referencing imports and is marked private to prevent accidental npm publication. `npm run build` compiles the included runtime; Deep Dig's dedicated runners build the game. The upstream SDK's example games, Solidity sources, deployment utilities and unrelated checks are omitted from this source release. No real-value actions are enabled by Deep Dig.

For reference, see the upstream [API](https://github.com/spokesz/friendsdk/blob/ca3bf183b809ecf22d87c63d88ce03969a3f8da2/API.md) and [runtime guide](https://github.com/spokesz/friendsdk/blob/ca3bf183b809ecf22d87c63d88ce03969a3f8da2/HOST_INTEGRATION.md). Our [submission notes](games/deep-dig/SUBMISSION.md) explain the custom pool and persistence limitations.

The v0.1.4 update includes v0.1.3 owner-filtered history pagination from the canonical first Transfer block. Default preview builds use the official read-only client and compile out dormant transfer, approval and signing paths. A regression test checks both generated bundles. The paged gallery, artwork reuse, sound preference and custom simulated economy remain local extensions; offline save keys are unchanged.
