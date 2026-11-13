# FlowVault build conventions

Read README.md, docs/pitch.md, docs/PRODUCT.md and docs/COMPETITOR_GAPS.md: these are the canonical product direction and build priorities. docs/ignore/ holds set-aside drafts (UPGRADES.md and the v2 pitch/PRD); do not treat them as active scope. This is a new local build backed by the linked research; older research-only restrictions were superseded by the user's explicit build instruction, and the user subsequently requested wallet connection and usable operations. Implementing owner-initiated wallet signing is in scope. The agent must not sign, spend funds, deploy or publish on the user’s behalf.

- Keep financial amounts in bigint base units; floats are for formatting only.
- Keep example data and live evidence separate, including accounts, proposals and rates.
- A local review/fingerprint is not a wallet signature, onchain mandate or finalized operation.
- Fail closed when identity, decimals, health, fees, availability or withdrawal terms are unknown.
- Use same-net-payout comparisons, protect the reserve, consider unreserved cash, and separate refundable buffer from fees.
- Preserve local D1 revision checks, idempotency and account/mandate/source fencing.
- Do not inherit upstream keys, personal accounts, partner fee recipients or demo deployments.
- Run npm test, npm run typecheck, npm run build after relevant changes. npm run smoke requires the local dev server and reads public mainnet data.

- Dated obligations are implemented. Preserve the conservative legacy cash guard during migration and reserve-plus-horizon obligations thereafter. Personal and example workspaces have separate records; Judge mode must never mutate the personal source. Fictional USDT equivalence is allowed only in example scope; live unknown FX, health, fees or valuation must block execution.
