/** Product progress, not a claim of funded performance or production deployment. Implemented means the capability and
 * its guards are in this build; funded rehearsals, security review and deployment are tracked as their own steps. */
type Status = 'built' | 'backend' | 'next' | 'planned';
type Milestone = {
  title: string;
  journey: string;
  exit: string;
  status: Status;
  linkLabel?: string;
  /** A screen to open (through the view model's navigate). */
  to?: string;
};
export const roadmapUpdated = 'Updated 14 Nov 2026';
const milestones: Milestone[] = [
  {
    title: 'One portfolio across every wallet and chain',
    journey: 'NEAR, Ethereum, Base, Arbitrum and Solana wallets, connected by signing in with each; every EVM chain, DeFi position and NFT through Zerion when it is switched on. Wallet-by-wallet and total views, reserve, holdback, protected assets and policy caps.',
    exit: 'Exchange balances and verified coverage for more protocols.',
    status: 'built', linkLabel: 'Open portfolio', to: 'portfolio',
  },
  {
    title: 'Ask FlowVault',
    journey: 'A conversational agent with interactive cards: swaps, supply, trades, payments and automation drafts built from engine figures, a brief on demand, and choices when a request is open. Every card waits for your own review.',
    exit: 'Move the chat to NEAR AI Cloud (the intent parser already runs there) and rehearse journeys with a funded wallet.',
    status: 'built', linkLabel: 'Open Research', to: 'hub',
  },
  {
    title: 'Swaps and collect-and-send across chains',
    journey: 'NEAR Intents and Rhea / Ref swaps paid from NEAR, Ethereum, Base, Arbitrum, Solana, BNB Chain and Polygon; one-tap swap-then-supply; collect from many holdings and pay a recipient directly; any DexScreener token through LI.FI.',
    exit: 'Owner-funded rehearsal of refunds, partial fills and late approvals.',
    status: 'built', linkLabel: 'Open swap', to: 'swap',
  },
  {
    title: 'Exact-output payments on a date',
    journey: 'NEAR USDC to Base/Arbitrum USDC, BNB USDT and Ethereum USDC/USDT. Paid only after exact destination receipt proof; recurring payments and a dated calendar.',
    exit: 'Owner-funded payout and refund/recovery rehearsal; scheduled dates still require owner initiation.',
    status: 'built', linkLabel: 'Open calendar', to: 'calendar',
  },
  {
    title: 'Lending, borrowing and cash access',
    journey: 'Every Rhea market in-app: supply, withdraw, borrow, repay and collateral release with health checks; LiNEAR/rNEAR collateral; venue-isolated Aave v3 borrowing; approved-asset sales for exact net cash.',
    exit: 'Record real entry, repayment and exit evidence, with costs and health reconciled.',
    status: 'built', linkLabel: 'Open borrow', to: 'credit',
  },
  {
    title: 'Staking with a real way back',
    journey: 'LiNEAR, rNEAR and native validators: stake with what you hold, resumable flows, delayed unstake, epoch wait and claim through owner-signed journals and finalized receipts.',
    exit: 'Verify the full epoch-wait journey with funds. Instant exits need a verified swap quote.',
    status: 'built', linkLabel: 'Open earn', to: 'strategies',
  },
  {
    title: 'Research, automations and approvals',
    journey: 'Research opens the app: public explainers, today’s ideas from your holdings, strategies, live yields and a watchlist saved with your account. Daily briefs, weekly surplus sweeps and alerts run on a schedule and never move funds; every approval shows its hazard scan.',
    exit: 'Verify scheduled runs on the deployed worker and deliver briefs outside the app.',
    status: 'built', linkLabel: 'Open Research', to: 'hub',
  },
  {
    title: 'Perpetuals and spot trading',
    journey: 'Hyperliquid perps with a FlowVault agent that can trade but never withdraw, bounded by a signed, revocable mandate; in-app funding through NEAR Intents; live charts and order book; spot trades with a 0–100 safety score.',
    exit: 'Funded trades reconciled against margin, and incident drills for the agent.',
    status: 'built', linkLabel: 'Open trade', to: 'trade',
  },
  {
    title: 'Statement, recurring obligations and alerts',
    journey: 'Journal-derived accounting, actual fees, CSV statement, recurring payment instances, a notification bell and persistent alerts that can propose plans.',
    exit: 'Validate accounting against funded receipts.',
    status: 'built', linkLabel: 'Open activity', to: 'activity',
  },
  {
    title: 'Community and growth',
    journey: 'Tips from other users that point at an action in FlowVault, upvotes and uses that credit authors, points, invite links and share cards. Points record contribution and aren’t money; fee sharing is off.',
    exit: 'Abuse limits reviewed before any reward is attached to points.',
    status: 'built', linkLabel: 'Open Research', to: 'hub',
  },
  {
    title: 'Strategy templates and pooled vaults',
    journey: 'Rhea USDC and LiNEAR strategy specifications with entry/exit, cost limits and shutdown rules; a vault contract with NAV, high-water performance fees and FIFO redemption, and a publish flow the owner authorizes. Example vault only.',
    exit: 'Owner-funded pilots and net results, then an owner-deployed vault with verified redemption.',
    status: 'backend',
  },
  {
    title: 'On-chain policy authority',
    journey: 'Non-custodial policy contract and backend for plans, agents, proposals, caps, allowlists and owner approvals.',
    exit: 'Owner deployment and configured contract verification. Current deployment status is “not deployed”.',
    status: 'backend', linkLabel: 'Open policy', to: 'policy',
  },
  {
    title: 'Funded demonstration and security review',
    journey: 'Supply → exit → payout; staking → unstake → claim; borrow → repay; a swap, a collect-and-send and a perps round trip. Capture real costs, receipts and recovery outcomes.',
    exit: 'Complete the owner’s funded rehearsal, review security and publish only verified evidence.',
    status: 'next',
  },
  {
    title: 'Protective automation and capital rotation',
    journey: 'Scoped incident responses (step back from a degraded venue) and rotation between approved strategies, built on mandates, automations and the plan system.',
    exit: 'Incident drills, revocation tested end to end and reconciled outcomes.',
    status: 'planned',
  },
  {
    title: 'Cards, institutions and ecosystem programs',
    journey: 'Partner-issued cards, treasury APIs, capital-partner reporting, incentive programs and a policy-bounded speculative sleeve.',
    exit: 'Partner agreements, spend reservations, proven isolation and explicit program rights and eligibility.',
    status: 'planned',
  },
];
const styles = {
  built: { status: 'IMPLEMENTED', stBg: '#E2EAD6', stColor: '#3F6B3C', dotBg: '#4E7A4A', dotColor: '#fff' },
  backend: { status: 'BACKEND READY', stBg: '#E7ECF3', stColor: '#3F5A7A', dotBg: '#E7ECF3', dotColor: '#3F5A7A' },
  next: { status: 'NEXT', stBg: '#F6EBDD', stColor: '#8A5F25', dotBg: '#F6EBDD', dotColor: '#8A5F25' },
  planned: { status: 'PLANNED', stBg: '#EEF0E8', stColor: '#5B6458', dotBg: '#EEF0E8', dotColor: '#5B6458' },
} as const;
export function roadmapRows(v: Record<string, unknown>) {
  const navigate = v.navigate as ((screen: string) => void) | undefined;
  return milestones.map((m, i) => {
    const go = m.to && typeof navigate === 'function' ? () => navigate(m.to!) : undefined;
    return { ...m, ...styles[m.status], n: String(i + 1).padStart(2, '0'), hasLink: !!go, onLink: go };
  });
}
export const roadmapCounts = () => {
  const n = (s: Status) => milestones.filter((m) => m.status === s).length;
  return { built: n('built'), backend: n('backend'), next: n('next'), planned: n('planned') };
};
export const roadmapNext = [
  { t: 'Deploy and verify policy authority', d: 'The contract and backend are built. Owner deployment, configured contract checks and a rehearsed approval flow come next.' },
  { t: 'Ask FlowVault on NEAR AI Cloud', d: 'The intent parser already runs there; the chat follows, with the same cards and the same rule that every action waits for your review.' },
  { t: 'Chain Signatures and external accounts', d: 'Extend the account to exchange balances and additional signing networks, with explicit ownership, risk and recovery rules.' },
  { t: 'Receive into the plan', d: 'Incoming payments fill the reserve first; allocating the surplus needs verified accounting and an approved action plan.' },
];
