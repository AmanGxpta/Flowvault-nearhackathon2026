#!/usr/bin/env bash
# Owner-run only. Codex does not execute this script or read keychain credentials.
set -euo pipefail
: "${POLICY_CONTRACT_ID:?Set your already-created contract account ending .testnet}"
: "${POLICY_OWNER_ID:?Set your owner account ending .testnet}"
[[ "$POLICY_CONTRACT_ID" =~ ^[a-z0-9._-]+\.testnet$ ]] || { echo 'Testnet contract account required.' >&2; exit 1; }
[[ "$POLICY_OWNER_ID" =~ ^[a-z0-9._-]+\.testnet$ ]] || { echo 'Testnet owner account required.' >&2; exit 1; }
command -v near >/dev/null || { echo 'Install near-cli-rs first.' >&2; exit 1; }
POLICY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cargo test --locked --manifest-path "$POLICY_ROOT/Cargo.toml"
cargo build --locked --manifest-path "$POLICY_ROOT/Cargo.toml" --target wasm32-unknown-unknown --release
POLICY_WASM="$POLICY_ROOT/target/wasm32-unknown-unknown/release/flowvault_policy.wasm"
shasum -a 256 "$POLICY_WASM"
POLICY_INIT_ARGS="{\"owner_id\":\"$POLICY_OWNER_ID\"}"
# Signs with the contract account's full-access key in your OS keychain, initializes atomically.
# The runtime contract thereafter accepts owner policy calls; it has no token custody/execution path.
near contract deploy "$POLICY_CONTRACT_ID" use-file "$POLICY_WASM" \
  with-init-call new json-args "$POLICY_INIT_ARGS" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send
