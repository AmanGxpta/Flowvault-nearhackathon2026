# FlowVault policy coordination contract

An undeployed, single-owner NEAR contract instance. It stores a versioned plan, registered agents, bounded proposals, owner decisions and NEP-297 outcome records. It does not hold investment capital, receive fungible tokens, grant wallet access, call Rhea/1Click or execute a payment. Owner calls require exactly 1 yoctoNEAR and schedule that authentication yocto back to the owner; the deployed account still needs the owner's operational NEAR for storage/gas. A failed refund could leave one authentication yocto; this is not an asset-custody vault.

One instance has one owner; there is no factory or multi-tenant registration. The contract account's key initializes it atomically at deployment; subsequent owner methods require the configured owner as predecessor. No deployment or funded transaction has been run by the coding agent.

```sh
cargo test --locked --manifest-path contracts/policy/Cargo.toml
cargo build --locked --manifest-path contracts/policy/Cargo.toml --target wasm32-unknown-unknown --release
```

Dependencies are pinned in Cargo.toml and Cargo.lock. `near-sdk = 5.30.1`. WASM: `contracts/policy/target/wasm32-unknown-unknown/release/flowvault_policy.wasm`. The WASM compiles locally; a testnet/sandbox execution and external review remain separate checks. This local build is not a reproducible-container or audited build.

Owner-run deployment, after creating/funding your own **testnet** contract account and placing its full-access key in your OS keychain:

```sh
POLICY_CONTRACT_ID='<your-contract>.testnet' \
POLICY_OWNER_ID='<your-owner>.testnet' \
  bash contracts/policy/scripts/deploy-testnet.sh
```

The script runs tests/build, then invokes near-cli-rs deployment + `new` atomically, signing as the contract account using your keychain. It accepts only `.testnet` accounts and has no private-key arguments, generated accounts, inherited demo accounts or mainnet fallback. The agent only syntax-checks it; running it is the owner's deployment action. Install near-cli-rs yourself. The script does not create accounts, configure rules/agents, connect the app or publish a site.

Methods and JSON contracts are defined in `src/lib.rs`. Unit tests cover the proposal/approval lifecycle, malformed rules, caps, daily totals across plan/day changes, protected assets, revocation, expiry, caller checks, outcome record labels, pagination/resource bounds and NEP-297 logs.

Reserve and dated obligations are stored as plan evidence; the contract does **not** independently query balances/health or check quote costs. Those checks remain in the backend and owner wallet. Proposals describe an action, not executable arguments or a token allowance. An approval grants no transaction authority; recorded success is explicitly `unverified_record`. The app's live journal/payment proof is still finalized RPC evidence. No claim is made that the app currently reads a deployed policy contract or that function-call keys are provisioned.

Pending proposals reserve daily capacity. Rejecting a pending proposal releases its same-day reservation; approving keeps it counted. Failed/reported outcomes do not release an approved budget. Changing plan does not reset the day's usage. Next UTC day resets the active counter; prior-day or expired pending proposals cannot be approved. Revoke an agent to prevent new proposals, pending approvals and future agent outcome submissions. Keep agent function-call keys restricted to `propose` (and, only if desired, `record_outcome`) on this contract, with a gas allowance; key creation/revocation is owner-managed.

Resource bounds: 20 agents, 50 obligations, 30 venues, 50 recipient/method/protected-asset entries, 1000 retained proposals, 50 rows per view page. The deployment account funds bounded storage. After 1000 proposals this prototype refuses new ones; no silent audit-history deletion. It needs a storage/retention design before production scale.

Reference interfaces: [NEAR SDK 5.30.1](https://docs.rs/near-sdk/5.30.1/near_sdk/), [NEP-297](https://github.com/near/NEPs/blob/master/neps/nep-0297.md), [near-cli-rs deployment guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md).

The settlement `asset_id` is immutable after the first plan, so the daily budget cannot change units midstream (`SETTLEMENT_ASSET_IMMUTABLE`). Changing caps still requires a new version and preserves the current day's total.
