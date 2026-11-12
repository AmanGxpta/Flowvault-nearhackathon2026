# FlowVault vault — local, undeployed

Contract/interface: [vault-interface.md](../../docs/handoff/vault-interface.md). One immutable native-USDC underlying (6 decimals), standard NEP-141 shares (18), fixed virtual offsets, full-width U256 conversions. Every monetary value is an integer; JSON uses decimal strings.

Implemented: custody receipt, prepaid request storage, queued deposits outside NAV, share settlement, stale-bounded owner/curator NAV attestations, HWM performance fees/loss recovery/split, NEP-141 share storage/transfers, FIFO notice/minimum/liquidity-gated redemption settlement into fixed claims, private nonce-bound claim callbacks (failure restores claim), cancellation/amendment, pause/irreversible shutdown and limits/pruning. Typed bounded Rhea USDC supply/withdrawal, persistent raw authority budgets, reserve/concentration guards, nonce-bound callbacks, reporter-only liquid sync with escrow protection, and disclosed owner upgrade method are implemented. The contract is local and undeployed; owner rehearsal and security review remain outstanding.

```sh
cargo test --locked --manifest-path contracts/vault/Cargo.toml
cargo build --locked --manifest-path contracts/vault/Cargo.toml --target wasm32-unknown-unknown --release
```

Pinned near-sdk/near-contract-standards 5.30.1; uint 0.9.5 provides full-width arithmetic. Lockfile is committed; target artifacts are ignored. A local compile/unit test is not an audit, a sandbox transaction, an owner-funded mainnet operation or a reproducible-container build. No deployment script is supplied or run. Reports are trusted valuations, not independently verified proof; owner upgrades and the deployment account's actual full-access keys must be disclosed and checked before publication.


Operations construct only the configured native-USDC/Rhea calls. There is no arbitrary calldata, borrowing or payout-recipient parameter. Before operating, the owner must register the vault with the underlying token and Rhea, fund operational NEAR, verify actual account/upgrade keys and configure bounded operator policy. Owner provisioning of a scoped function-call key is separate; no key is supplied or provisioned by this project.

`deployed_raw` is a conservative gross resolved-supply allowance counter, not current marked exposure: unused resolver refunds reduce it; withdrawals/NAV reports do not replenish it. Daily/lifetime budgets consume the full authorized attempt and survive policy edits. Position exposure comes from the trusted report. A risk-reducing withdrawal can include reported Rhea yield, but never credits cash on root success: independently verify finalized payout, sync underlying balance (excluding pending deposits/claims), then submit a fresh NAV report. Missing escrow freezes claims. Unknown external outcomes stay locked without a reset ABI; recovery may require a separately reviewed owner code upgrade via the actual full-access keys. These trust and recovery limits must be disclosed by the off-chain integration.
