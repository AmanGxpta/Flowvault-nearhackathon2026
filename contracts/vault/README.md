# FlowVault vault — local, undeployed

Contract/interface: [vault-interface.md](../../docs/handoff/vault-interface.md). One immutable native-USDC underlying (6 decimals), standard NEP-141 shares (18), fixed virtual offsets, full-width U256 conversions. Every monetary value is an integer; JSON uses decimal strings.

Current sub-step implements custody receipt, prepaid request storage, queued deposits outside NAV, share settlement, stale-bounded owner/curator NAV attestations, performance fee dilution with an upward-only HWM/loss recovery, fee split, share metadata/storage/transfer standard and pure/view pricing. Redemptions/claims, administrative shutdown and typed bounded Rhea operations are in the next sub-steps; do not deploy this partial build.

```sh
cargo test --locked --manifest-path contracts/vault/Cargo.toml
cargo build --locked --manifest-path contracts/vault/Cargo.toml --target wasm32-unknown-unknown --release
```

Pinned near-sdk/near-contract-standards 5.30.1; uint 0.9.5 provides full-width arithmetic. Lockfile is committed; target artifacts are ignored. A local compile/unit test is not an audit, a sandbox transaction, an owner-funded mainnet operation or a reproducible-container build. No deployment script is supplied or run. Reports are trusted valuations, not independently verified proof; owner upgrades and the deployment account's actual full-access keys must be disclosed and checked before publication.
