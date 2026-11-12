/** Product progress, not a claim of funded performance or production deployment. */
type Status = 'built' | 'backend' | 'next' | 'planned';
type Milestone = {
  title: string;
  journey: string;
  exit: string;
  status: Status;
  linkLabel?: string;
  action?: 'goPolicy' | 'goStrategies' | 'goCalendar' | 'goActivityClose';
};
const milestones: Milestone[] = [
  {
    title: 'One portfolio, dated obligations and personal rules',
    journey: 'NEAR, Base and Arbitrum reads; shared valuations, reserve and holdback; protected assets, permissions and policy caps.',
    exit: 'Broaden verified coverage to more wallets, chains and exchanges.',
    status: 'built', linkLabel: 'Open policy', action: 'goPolicy',
  },
  {
    title: 'Saved plans and Ask FlowVault',
    journey: 'Structured assistant proposals, funding choices, dependent steps, owner review and approvals, persistent journals and recovery.',
    exit: 'Rehearse the complete journeys with the owner’s funded wallet.',
    status: 'built', linkLabel: 'Open activity', action: 'goActivityClose',
  },
  {
    title: 'Rhea lending and cash access',
    journey: 'USDC supply and withdrawal; LiNEAR/rNEAR collateral, USDC borrowing, repayment and collateral release with health checks.',
    exit: 'Record real entry, repayment and exit evidence, with costs and health reconciled.',
    status: 'built', linkLabel: 'Open strategies', action: 'goStrategies',
  },
  {
    title: 'Exact-output cross-chain payments',
    journey: 'NEAR USDC to Base/Arbitrum USDC, BNB USDT and Ethereum USDC/USDT. Paid only after exact destination receipt proof.',
    exit: 'Owner-funded payout and refund/recovery rehearsal; scheduled dates still require owner initiation.',
    status: 'built', linkLabel: 'Open calendar', action: 'goCalendar',
  },
  {
    title: 'Staking with a real way back',
    journey: 'LiNEAR and native-validator entry, delayed unstake, epoch wait and claim through owner-signed journals and finalized receipts.',
    exit: 'Verify the full epoch-wait journey with funds. Instant exits need a verified swap quote.',
    status: 'built', linkLabel: 'Open strategies', action: 'goStrategies',
  },
  {
    title: 'Statement, recurring obligations and alerts',
    journey: 'Journal-derived accounting, actual fees, CSV statement, recurring payment instances and persistent alerts that can propose plans.',
    exit: 'Validate accounting against funded receipts and exercise the hosted monitoring schedule.',
    status: 'built', linkLabel: 'Open activity', action: 'goActivityClose',
  },
  {
    title: 'Individual strategy templates',
    journey: 'Rhea USDC and LiNEAR strategy specifications with entry/exit steps, cost limits, monitoring, accounting and shutdown rules.',
    exit: 'Run owner-funded pilots and measure net results before accepting pooled deposits.',
    status: 'built', linkLabel: 'Open strategies', action: 'goStrategies',
  },
  {
    title: 'On-chain policy authority',
    journey: 'Non-custodial policy contract and backend for plans, agents, proposals, caps, allowlists and owner approvals.',
    exit: 'Owner deployment and configured contract verification. Current deployment status is “not deployed”.',
    status: 'backend', linkLabel: 'Open policy', action: 'goPolicy',
  },
  {
    title: 'Funded demonstration and security review',
    journey: 'Supply → exit → payout; staking → unstake → claim; borrow → repay. Capture real costs, receipts and recovery outcomes.',
    exit: 'Complete the owner’s funded rehearsal, review security and publish only verified evidence.',
    status: 'next',
  },
  {
    title: 'Research, discovery and pooled strategies',
    journey: 'Protocol research reports, manually tested opportunities and a marketplace of approved strategies.',
    exit: 'Evidence-backed pilots, custody and share accounting, fee/NAV rules and verified redemption.',
    status: 'planned',
  },
  {
    title: 'Protective automation, exchanges and perps',
    journey: 'Scoped incident responses, capital rotation and exchange/perpetual adapters built on the existing policy and plan system.',
    exit: 'Revocable mandates, incident drills, venue adapters and reconciled margin exposure.',
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
  return milestones.map((m, i) => {
    const action = m.action ? v[m.action] : undefined;
    return { ...m, ...styles[m.status], n: String(i + 1).padStart(2, '0'), hasLink: typeof action === 'function', onLink: typeof action === 'function' ? () => action() : undefined };
  });
}
export const roadmapNext = [
  { t: 'Deploy and verify policy authority', d: 'The contract and backend are built. Owner deployment, configured contract checks and a rehearsed approval flow come next.' },
  { t: 'Chain Signatures and external accounts', d: 'Extend the account to exchange balances and additional signing networks, with explicit ownership, risk and recovery rules.' },
  { t: 'Receive into the plan', d: 'Incoming payments fill the reserve first; allocating the surplus needs verified accounting and an approved action plan.' },
];
