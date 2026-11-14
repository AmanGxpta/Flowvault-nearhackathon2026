// Growth, pure rules: community tips, points and invites. People share "today this is happening here" as a tip that
// points at something FlowVault can do (a token to swap into, a Rhea market, staking); others upvote it or act on it,
// and the author earns points. Every account has an invite code; an invite credits both sides once. Points are a
// record of contribution, not money. A share of fees is a separate, explicit setting (off by default) and nothing
// here pays anything out.

export const POINTS = { tip: 10, upvote: 2, used: 5, invite: 25, welcome: 25 } as const;
/** At most this many tips per account per UTC day. */
export const TIPS_PER_DAY = 3;

export type TipAction = { kind: "swap"; to: string; symbol: string } | { kind: "supply"; tokenId: string; symbol: string } | { kind: "stake" };
export interface Tip { id: string; author: string; title: string; detail: string; action: TipAction; createdAt: string; votes: number; used: number; mine?: boolean; voted?: boolean }

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|io|xyz|net|org|app|gg|fi|finance|link|co|me|so|ai)\b|t\.me\/|discord\.gg)/i;
/** A tip's text, checked: plain words only, no links (tips point at actions inside FlowVault, never off-site). */
export function checkTip(t: { title: string; detail: string; action: TipAction }): string | null {
  const title = t.title.trim(), detail = t.detail.trim();
  if (title.length < 8 || title.length > 90) return "Give the tip a title of 8 to 90 characters.";
  if (detail.length > 280) return "Keep the detail under 280 characters.";
  if (LINK.test(title) || LINK.test(detail)) return "Tips can't contain links. Point it at a token, market or staking in FlowVault instead.";
  if (t.action.kind === "swap" && !/^[a-z0-9_-]{2,30}:[A-Za-z0-9._-]{2,90}$/.test(t.action.to)) return "Choose the token the tip is about.";
  if (t.action.kind === "supply" && !/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(t.action.tokenId)) return "Choose the Rhea market the tip is about.";
  return null;
}

/** A short, stable invite code for an account (8 characters, no lookalikes). */
export async function inviteCode(account: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("flowvault-invite:" + account.toLowerCase())));
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(bytes.slice(0, 8), (b) => alphabet[b % alphabet.length]).join("");
}

/** Fee share for invites, from the server setting (basis points, 0–5000). 0 means off. */
export function feeShareBps(setting: string | null | undefined) {
  const n = Number(setting ?? "0");
  return Number.isInteger(n) && n >= 0 && n <= 5000 ? n : 0;
}
export function feeShareText(bps: number) {
  return bps === 0 ? "Fee share is off: FlowVault charges no fee today, so there's nothing to share." : `${bps / 100}% of FlowVault's fee on transactions by people you invite is recorded for you. Payouts aren't automatic.`;
}

/** Rank tips: votes and uses, decaying with age (a day halves it), newest first on ties. */
export function rankTips(tips: Tip[], now = Date.now()) {
  const score = (t: Tip) => (1 + t.votes * 2 + t.used * 3) / 2 ** ((now - Date.parse(t.createdAt)) / 86_400_000);
  return [...tips].sort((a, b) => score(b) - score(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
