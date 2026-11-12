# Third-party material and baseline disclosure

## Runtime scaffold

The initial project was generated with the installed Sites plugin's `project-setup.mjs`, Vinext starter, version 1.1.6. The supplied scripts, connector plumbing, Cloudflare worker integration and dependency declarations are scaffold material. No Site was registered or published. Dependencies are pinned by package-lock.json; their original licenses remain in installed packages.

## Reviewed implementation references

- [NearAnyStake](https://github.com/ultratestbro/nearanystake), `src/lib/staking.ts`: inspected as the reuse map's first staking reference. Its @anywalletkit modules and protection checks are not copied or presented as enabled here. Observed upstream license in the research: Apache-2.0.
- [Allpilot](https://github.com/zincshbar-lab/allpilot), `src/lib/lending.ts`: inspected to cross-check Rhea call shapes and lending inner-decimal distinctions (and, for Engines E2, the `execute_with_pyth` Borrow/Withdraw/DecreaseCollateral and `ft_transfer_call` IncreaseCollateral/Repay formats, also checked against finalized mainnet transactions). No module or wallet wrapper was copied. Observed upstream license in the research: MIT.
- [Rhea cross-chain SDK](https://github.com/rhea-finance/cross-chain-sdk) and [Burrow SDK](https://github.com/rhea-finance/burrow-sdk-python): API/schema references retained in the source research. No upstream SDK execution or signing authority is assumed.
- [NEAR RPC](https://docs.near.org/api/rpc/contracts) and [1Click](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request): public interface documentation. Integration code in lib/flowvault is newly authored.

Exact bytes of the two inspected source references are identified in docs/reference-provenance.json using SHA-256 and Git blob hashes. Moving branch links are not claimed to pin an imported commit. The initial milestone imported no third-party product modules; the wallet SDK additions are disclosed below. If modules are adopted later, pin the imported commit/blobs and preserve all source notices and licenses.

The earlier Chainlink FlowVault is conceptual background only; none of its contracts, deployment addresses, keys or execution code was imported. Rhea's official protocol/token addresses are integration targets, not our deployments. No fee-recipient address or personal/demo account from a competitor is embedded.

Fonts are Google Fonts DM Sans and Manrope, loaded from the public font service; fallback system fonts work without it. Interface icons are lucide-react. Neither font service nor the icon package receives wallet credentials.

## Wallet integration — November 11, 2026

Installed `@near-wallet-selector/core`, `modal-ui` and `my-near-wallet` at **10.1.4** from the NEAR Wallet Selector project (MIT OR Apache-2.0). Original SDK code/notices remain in the packages; exact transitive versions and integrity hashes are in package-lock.json. Wallet UI and signing transport are supplied SDK capabilities, not FlowVault inventions. No competitor wallet wrapper was imported.

`buffer@6.0.3` (MIT) provides browser Buffer for transaction encoding. `util@0.12.5` (MIT) supplies browser `util.format` required by transitive wallet SDK validation; Vite aliases it in the client environment only. The SDK retains upstream dynamic-code warnings (`js-sha256` and validation dependencies); no claim of a completed security audit is made. Wallet modules are dynamically loaded on the client. No `contractId` or `createAccessKeyFor` is requested during connection, and FlowVault introduces no application signing-key storage.

Implementation references: [Wallet Selector API](https://github.com/near/wallet-selector/tree/main/packages/core/docs/api), [modal UI](https://github.com/near/wallet-selector/tree/main/packages/modal-ui) and [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions). Implemented against installed 10.1.4 typings/source, including native-action conversion, with SDK-native actions used for signing.

## Withdrawal integration — November 11, 2026

Inspected the Unlicense-licensed [ref-finance/burrowland contract source at 2110c7047f2d72a9189abcbaad5eafb4e4a87f9e](https://github.com/ref-finance/burrowland/tree/2110c7047f2d72a9189abcbaad5eafb4e4a87f9e). No product module was copied. Exact reviewed bytes and commit/blob/SHA-256 identifiers are in `docs/reference-provenance.json`.

- `contracts/contract/src/actions.rs`: `execute` requires one yocto and acts for its predecessor. `asset_amount_to_shares` compares `max_amount` directly with pool balances; `internal_withdraw` divides the resulting inner amount by `10^extra_decimals` for the native FT transfer. `max_amount` therefore uses **token decimals + extra decimals**, not six-decimal native units. Shares rounding may deliver less than the requested cap; the adapter never confirms a short payout as an exact exit.
- `asset.rs`: available inner liquidity is `supplied.balance + reserved + prot_fee - borrowed.balance - margin_debt.balance - margin_pending_debt`. Every field is required. The adapter additionally caps availability by actual USDC `ft_balance_of(Rhea)` converted to inner units.
- `fungible_token.rs` / `events.rs`: transfer callbacks emit `withdraw_succeeded` or `withdraw_failed`. A failure restores a lending deposit; successful `execute` alone does not establish cash payout. Reconciliation requires a successful native-USDC receipt emitting NEP-141 `ft_transfer` for the exact native amount from Rhea to the signer; Rhea failure/refund evidence vetoes success.
- `account.rs` / `account_view.rs`: `get_account` exposes a regular position, while `get_account_all_positions` exposes the position map and lock state. Withdrawal checks every position and refuses any collateral/debt, without assuming account health.

The finalized public observation in `docs/withdraw-reference/live-usdc-config.json` reports USDC metadata decimals **6**, live extra decimals **12**, `can_withdraw: true` and mode `Running` at blocks **224056040–224056041**. Thus `12.345678 USDC` caps inner withdrawal at `12345678000000000000`, while the required token payout event must say `12345678`. This snapshot is historical evidence only. Preparation and handoff each refresh all withdrawal views at one finalized block.

The reviewed revision is a protocol source reference; source-to-current-deployed-bytecode equivalence has not been established. No transaction was signed/submitted for this milestone. Fixture receipts are synthetic reproductions of the pinned source’s event schemas, not claimed mainnet transaction captures.

## Meteor registration and quote scenarios — November 11, 2026

Added `@near-wallet-selector/meteor-wallet` pinned to **10.1.4**, matching the other selector packages, from [NEAR Wallet Selector](https://github.com/near/wallet-selector/tree/main/packages/meteor-wallet) (MIT OR Apache-2.0). The module is registered beside MyNearWallet and included in the browser dependency pre-bundle. Both `signSupply` and `signWithdraw` use the same mainnet/active-account/wallet-account guard immediately before signing; wallet transaction payloads retain the explicit signer ID. No wallet was connected or transaction submitted by the agent for this change.

Its pinned transitive `@meteorwallet/sdk@1.0.24` contains `console.log(accessKey)` in both distributed ESM/CJS bundles. `scripts/patch-meteor-sdk.mjs` removes **only that logging statement**, preserves other code and notices, and checks the package version and full original/patched SHA-256 hashes from `scripts/vendor/meteor-sdk-patch.json`. The patch is idempotent, runs after install and before dev/build, and refuses changed/unreviewed bytes. The transitive package metadata does not declare a license field; no existing notice was removed. Meteor’s SDK manages browser connection state, including a generated connection key; the earlier MyNearWallet-only statement about application signing-key storage must not be read as a claim that third-party wallet SDKs never use browser storage. FlowVault’s backend receives no signing key.

The Arbitrum/Base **example** route parameters in `lib/flowvault/example-quote.ts` are newly authored, explicitly fictional scenario data. They are not measured network fees, a live price feed, or evidence that either destination is cheaper. Successful live 1Click quotes retain their upstream prices and exact-output/dry request semantics. Friendly error mapping keeps exact upstream text in the quote API’s `debug` response field; it does not add a fee recipient or initiate a transfer.

## Internal mechanics reference review — 12 November 2026

Cloned and inspected NearAnyStake at `9d2493618cb7a3d3361615d54da6906eafb8ff35` (Apache-2.0), AllPilot at `2a796e5665b675bf2ae7255400af5809ec87d6be` (MIT), and ASGARD at `16db5462e03d614fe41ea1681f29ae788b8f50d3` (no license, ideas only, **zero code copied**). File hashes/links are in `docs/reference-provenance.json`. AllPilot's Rhea/guard/AI wiring and ASGARD's portfolio/Hyperliquid reading approach were reviewed; no float health math, collateral-on default, accounts, private configuration, keys or fee recipients were inherited.

Installed published Apache-2.0 SDKs `@anywalletkit/protocol-staking-native-near@0.2.0` and `@anywalletkit/protocol-staking-liquid-near@0.1.1`, the read-only reuse path found in NearAnyStake. `staking-reads.ts` supplies only an account identity and explicit public RPCs, uses SDK position/epoch/LiNEAR/rNEAR reads, and serializes bigint amounts. No SDK write/signing method is called. SDK notices remain in node_modules; package-lock records exact dependency integrity. The full upstream app wrapper/history/gas UI was not copied. Read-only countdowns preserve SDK uncertainty; no claim of a guaranteed withdrawal time is added.

Native USDC addresses for NEAR/Base/Arbitrum are independently checked against [Circle's contract directory](https://developers.circle.com/stablecoins/usdc-contract-addresses). EVM readers verify chain ID, finalized block and six-decimal precision. ASGARD code was not used to implement them.

## Pay-on-a-date adaptation — 12 November 2026

`lib/flowvault/payments.ts`, `payment-service.ts`, `payment-guards.ts` and the payment APIs adapt NearAnyStake's field-by-field quote echo, owner refund binding, deposit cutoff, signed-response retention and provider-phase patterns from commit `9d2493618cb7a3d3361615d54da6906eafb8ff35`, `src/lib/oneclick/{quote,status,client,types}.ts` (Apache-2.0). Our specialization uses **EXACT_OUTPUT**, native USDC from NEAR to Circle-native USDC on Base/Arbitrum, and independent finalized ERC-20 destination proof. The upstream implementation uses EXACT_INPUT. Its accounts, fee recipient, keys, referral/deployment configuration and signing wrapper were not imported. Upstream license is retained at `vendor/licenses/NearAnyStake-Apache-2.0.txt`. AllPilot's reference license is retained alongside it; ASGARD remains ideas only, no code copied.

No provider fee recipient is hardcoded. A positive provider appFee requires the owner's explicit `policy.providerFeeRecipients` approval and is bounded by `maxProviderFeeBps` (default 25). This intentionally refuses unapproved newly returned recipients. The provider signature is retained for evidence, **not cryptographically verified**; all request fields, funding bounds, destination and refunds are independently checked. Official ERC-20 Transfer receipt shape, Circle's published native addresses and NEAR NEP-141 events are interface references; our verifier is newly authored.

## Judge replay schemas — 12 November 2026

`lib/flowvault/replay-fixtures/*.json` derive **response shapes** from NearAnyStake's `src/lib/__fixtures__/oneclick/status-{success,refunded,incomplete,failed,pending-expired}.json`, pinned at `9d2493618cb7a3d3361615d54da6906eafb8ff35` (Apache-2.0). Upstream includes both recorded responses and explicitly schema-derived variants; we preserve that distinction in the API. Original accounts, hashes, correlation identifiers, signatures, fee recipients and amounts are scrubbed. Protocol type/status enums remain. Source and derived SHA-256 values are recorded in `docs/reference-provenance.json`; license retained in `vendor/licenses/`. The simulated NEAR receipt variants are authored fixtures matching RPC/NEP-141 shapes, not claimed recordings of FlowVault transactions. No ASGARD code is used.

## Rust policy contract dependency — 12 November 2026

The newly authored `contracts/policy` uses `near-sdk = 5.30.1` (MIT OR Apache-2.0), source repository `near/near-sdk-rs`, published crate VCS commit `bacd081a0bd648d840b814dab7677e1f3330afbb`, path `near-sdk`. Cargo.lock pins the crate checksums and transitive dependencies; original notices remain in the installed crates. The contract's receiver/method allowlist idea references the already-attributed AllPilot Pilot Guard; none of its source is copied into Rust. SDK/NEP-297/near-cli-rs documentation is cited in the contract README. No deploy key, contract ID or funded account is embedded; the owner supplies their own testnet accounts to the script.

## Fonts (redesigned interface)

- **DM Sans** and **DM Mono** (Google Fonts, SIL Open Font License 1.1), as embedded in the design bundle
  `docs/design/FlowVault.html`. Self-hosted from `public/fonts/` (latin and latin-ext subsets) and declared in
  `app/fv.css`. No Google Fonts request is made at runtime.

## Ask FlowVault and design integration — 12 November 2026

The assistant references AllPilot's MIT `src/lib/agent.ts` at the already-pinned `2a796e5665b675bf2ae7255400af5809ec87d6be` for NEAR AI Cloud's compatible endpoint and deterministic no-key fallback. The new implementation uses plain fetch, a strict intent schema, no tools, no signing/execution code, and sends no stored financial/account data. Its prompt and engine-only rendering are newly authored; no upstream persona, account, key, fee recipient or collateral default was copied. Official NEAR AI quickstart, compatibility and verification docs were checked; this implementation makes no attestation/signature/E2EE verification claim.

The installed Apache-2.0 staking modules (`native-near@0.2.0`, `liquid-near@0.1.1`, pinned in package-lock.json) now also supply read-only rate/pool checks and `quoteStake` unsigned planning, with the app's own strict payload validation and 0.5 NEAR exit reserve. SDK `stake`/send/write methods are never invoked. No new SDK, partner fee recipient or module default treasury is used in a transaction; the app permits only a single exact `deposit_and_stake` to the approved receiver. USD-cap enforcement remains gated rather than treating native NEAR units as dollars.

`docs/design/FlowVault.html` is the user's supplied design reference. Demo values/names/offsets are authored fictional fixtures matching that brief; copied sample account strings from the bundled page are not used as live sources. No frontend or bundled design file was modified.

## Submission licensing and source audit — 12 November 2026

The owner selected MIT for FlowVault-authored material; see root `LICENSE`. Existing third-party licences remain applicable. Root `NOTICE` preserves NearAnyStake Apache-2.0 attribution and identifies our modified/adapted modules and fixtures; the complete upstream licence remains in `vendor/licenses/NearAnyStake-Apache-2.0.txt`. The pinned upstream checkout has no separate NOTICE file to reproduce. AllPilot's MIT licence remains in `vendor/licenses/AllPilot-MIT.txt`.

ASGARD is unlicensed and **no ASGARD code was copied**. An authored-tree case-insensitive grep plus exact-file and normalized 20-line source-window comparison against pinned commit `16db5462e03d614fe41ea1681f29ae788b8f50d3` found only documentation/ignore references and no source matches. Method, scope and limitations are in `docs/SUBMISSION_AUDIT.md`; the scratch clone stays outside this repository.

Submission tooling uses Gitleaks v8.30.1 (MIT, standalone outside the checkout), Mermaid 11.12.0 (MIT) and jsdom 26.1.0 (MIT, external validation installation); no new runtime package was imported. `docs/readiness/oneclick-dry-observation.json` is a sanitized, freshly observed public 1Click dry-quote summary, not a funded recording or third-party code import.

Public RPC endpoint selection was checked against NEAR's official provider directory on 12 November (`https://docs.near.org/api/rpc/providers`); newly authored read transport/SDK configuration shares public FASTNEAR and dRPC after observed 429s. No provider SDK, key, account configuration or source code was imported for this change. The existing payment source inventory was moved into `lib/flowvault/payment-inventory.ts` to test its independence from portfolio/staking display adapters; it retains the previously attributed payment patterns and introduces no new upstream code.

## Expanded payout interfaces — 12 November 2026

Newly authored BNB/Ethereum configuration and receipt verification use the live 1Click `/v0/tokens` catalog and dry EXACT_OUTPUT responses, Circle's published USDC addresses, and public BSC/Ethereum JSON-RPC chain/decimals/finalized reads. No external implementation or dependency was copied/installed. Existing NearAnyStake attribution for quote echo/status retention remains applicable. BNB's cataloged USDT is Binance-Peg at 0x55d398326f99059ff775485246999027b3197955 (18 decimals, `bnb-...omdep.near` asset), not Ethereum's six-decimal Tether contract. Sanitized observations and hashes are recorded in reference-provenance. Rhea eligibility was read directly at block 224152862; demo valuation/health/capacity remain labelled illustrative.

## Phase 4 Aave v3 (13 Nov 2026)
- Imported deployed pool/provider/oracle, supported underlying addresses and eMode ID/label metadata from [bgd-labs/aave-address-book](https://github.com/bgd-labs/aave-address-book), MIT; exact revision recorded in docs/AAVE_MARKETS.md. Derived metadata is in lib/flowvault/aave-markets.ts; upstream SPDX MIT retained here. No upstream keys/accounts, fee recipients or deployments imported.
- Aave call/event signatures and reserve bit layout verified against official Aave docs and [aave-dao/aave-v3-origin](https://github.com/aave-dao/aave-v3-origin) public interfaces (MIT interface SPDX). FlowVault implementation is original; no protocol contract source copied.

## Phase 4 Solana transfers — Stream A (13 Nov 2026)
- `@solana/kit` 8.6.0 (MIT, Anza; published 28 Oct 2026), `@solana-program/token` 0.18.0 and `@solana-program/memo` 0.16.0 (Apache-2.0, Solana Program Library clients). Pinned exact, no install scripts. Used for the RPC client (genesis check, jsonParsed USDC account reads, blockhash, finalized signature status/fees) and to build the one SPL `TransferChecked` (+ idempotent associated-token-account create, + optional memo) that the owner's Solana wallet signs through Wallet Standard `solana:signAndSendTransaction`. The memo uses the canonical SPL Memo v2 program (`MemoSq4g…`, exported as `LEGACY_MEMO_PROGRAM_ADDRESS_V3`), not the package's newer default deployment.
- No keys, endpoints or fee recipients inherited. The default RPC is the keyless public endpoint already used for Solana reads; `SOLANA_RPC_URL` overrides it.
