// Public research: short explainers anyone can read on the Research page before connecting a wallet. Education,
// not advice: they describe how the venues and FlowVault's own checks work, and quote live figures only where the
// page fills them in from public rate reads ({usdc} and {linear}), never a promised return.

export interface PublicPost {
  id: string;
  kicker: string;
  title: string;
  summary: string;
  minutes: number;
  /** Which live figure the card shows next to the title, if any. */
  live?: "usdc" | "linear";
  body: { h?: string; p: string }[];
}

export const PUBLIC_POSTS: PublicPost[] = [
  {
    id: "stablecoin-yield",
    kicker: "Yield",
    title: "Where stablecoin yield on Rhea comes from",
    summary: "Supplying USDC earns what borrowers pay. The rate moves with how much of the pool is borrowed.",
    minutes: 3,
    live: "usdc",
    body: [
      { p: "When you supply USDC to Rhea's lending market, it joins a pool that others borrow from against collateral. The interest borrowers pay is shared with suppliers, so the supply rate is paid out of real borrowing demand, not new tokens printed for the occasion." },
      { h: "Why the rate moves", p: "The rate follows utilization: the share of the pool that is borrowed right now. When most of the pool is lent out, borrowing gets more expensive and suppliers earn more; when deposits pile up, the rate falls. A rate you see today is a reading, not a promise. Today's live USDC supply rate: {usdc}." },
      { h: "What can go wrong", p: "Your deposit depends on the market's contracts working as intended. At very high utilization, withdrawals can wait until borrowers repay or new deposits arrive. And a high rate on a small pool can drop sharply after a single large deposit." },
      { h: "How FlowVault handles it", p: "FlowVault only proposes supplying money you don't need soon: what sits above your reserve and your dated payments. Every proposal shows its hazard scan and waits for your own approval in your wallet." },
    ],
  },
  {
    id: "liquid-staking",
    kicker: "Staking",
    title: "Liquid staking NEAR with LiNEAR, plainly",
    summary: "Stake NEAR, hold LiNEAR, keep earning staking rewards and stay able to move.",
    minutes: 3,
    live: "linear",
    body: [
      { p: "Staking NEAR helps secure the network and earns staking rewards. Staking directly with a validator locks the NEAR; unstaking takes a few days. Liquid staking hands you a token, LiNEAR, that represents your staked NEAR and its growing rewards." },
      { h: "What you get", p: "LiNEAR earns the staking rate (live today: {linear}) while staying a normal token: you can swap it back to NEAR when there's liquidity, or unstake through the protocol, which takes about 2–3 days." },
      { h: "What to watch", p: "Swapping out early happens at the market price, which can sit slightly below the NEAR the LiNEAR represents. The protocol's contracts and its validator set are part of the risk. FlowVault keeps 0.5 NEAR aside for fees so an account is never left unable to pay for its next transaction." },
    ],
  },
  {
    id: "reserve-first",
    kicker: "Planning",
    title: "Set your reserve before you chase yield",
    summary: "Decide what must stay ready, put dates on what you owe, and only then put the rest to work.",
    minutes: 2,
    body: [
      { p: "Most losses in on-chain money aren't from bad assets; they come from needing cash at the wrong moment: a payment is due, funds are locked or a withdrawal queue is long, and something gets sold at a bad price." },
      { h: "A simple order of operations", p: "First a reserve you never deploy. Then the payments you already know are coming, with their dates. Only what's left over is surplus, and surplus is what can earn. FlowVault's weekly sweep follows exactly this order and proposes moving only the surplus, for your approval." },
      { h: "Revisit it", p: "A reserve that made sense last quarter may not now. Changing it is one setting, and every plan and proposal recalculates from it." },
    ],
  },
  {
    id: "hazard-scan",
    kicker: "Safety",
    title: "Reading a hazard scan before you sign",
    summary: "The checks FlowVault runs on every proposal, and what each one protects you from.",
    minutes: 2,
    body: [
      { p: "Every approval in FlowVault carries a hazard scan: the list of checks that ran before the proposal reached you. It reads 'all clear' only when every line passes; otherwise it says how many need resolving and why." },
      { h: "The core checks", p: "A per-action cap and what's left of today's limit after this action; whether the asset may be used at all and isn't one you protected; whether the venue is one you approved; whether the funds go to your own account; whether the contract calls are on the allowlist; and whether network and moving costs fit your budget." },
      { h: "Checks per action", p: "Swaps add slippage and quote freshness; cross-chain moves add delivery and refund paths; lending adds your health after the action and any new debt; staking adds a verified contract and a gas reserve. FlowVault never signs: your wallet does, after you've read this." },
    ],
  },
];
