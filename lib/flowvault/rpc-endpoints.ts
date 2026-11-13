// Public mainnet endpoints listed at https://docs.near.org/api/rpc/providers (checked 2026-11-12).
// No keys or send capability are configured. The deprecated near.org endpoint returned 429.
export const NEAR_READ_PROVIDERS = [
  "https://free.rpc.fastnear.com",
  "https://near.drpc.org",
  // Last resort: the official endpoint is slower and rate-limited, but answered on 13 Nov 2026 when the
  // free providers above throttled bursts of portfolio + staking reads.
  "https://rpc.mainnet.near.org",
];
