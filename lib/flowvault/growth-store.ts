// Growth storage (D1): tips, votes, uses, invites and the points ledger. Points rows are unique per (account, kind,
// ref), so retries and double clicks never credit twice. Accounts are NEAR account ids proven by sign-in.
import { database } from "./store";
import { POINTS, TIPS_PER_DAY, inviteCode, type Tip, type TipAction } from "./growth";

const TABLES = [
  "CREATE TABLE IF NOT EXISTS growth_tips (id TEXT PRIMARY KEY, author TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS growth_marks (tip_id TEXT NOT NULL, account TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tip_id, account, kind))",
  "CREATE TABLE IF NOT EXISTS growth_points (account TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, points INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account, kind, ref))",
  "CREATE TABLE IF NOT EXISTS growth_codes (code TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE)",
  "CREATE TABLE IF NOT EXISTS growth_invites (account TEXT PRIMARY KEY, referrer TEXT NOT NULL, at INTEGER NOT NULL)",
];
async function db() { const d = await database(); for (const t of TABLES) await d.prepare(t).run(); return d; }
const credit = async (d: Awaited<ReturnType<typeof db>>, account: string, kind: string, ref: string, points: number) =>
  d.prepare("INSERT OR IGNORE INTO growth_points (account, kind, ref, points, at) VALUES (?,?,?,?,?)").bind(account, kind, ref, points, Date.now()).run();

export async function myCode(account: string) {
  const d = await db(), code = await inviteCode(account);
  await d.prepare("INSERT OR IGNORE INTO growth_codes (code, account) VALUES (?,?)").bind(code, account).run();
  return code;
}
export async function summary(account: string) {
  const d = await db();
  const [points, invited, by] = await Promise.all([
    d.prepare("SELECT COALESCE(SUM(points),0) AS n FROM growth_points WHERE account=?").bind(account).first<{ n: number }>(),
    d.prepare("SELECT COUNT(*) AS n FROM growth_invites WHERE referrer=?").bind(account).first<{ n: number }>(),
    d.prepare("SELECT referrer FROM growth_invites WHERE account=?").bind(account).first<{ referrer: string }>(),
  ]);
  return { code: await myCode(account), points: Number(points?.n ?? 0), invited: Number(invited?.n ?? 0), invitedBy: by?.referrer ?? null };
}
export async function listTips(viewer: string | null, limit = 40): Promise<Tip[]> {
  const d = await db();
  const rows = await d.prepare(`SELECT t.id, t.author, t.title, t.detail, t.action, t.created_at,
      (SELECT COUNT(*) FROM growth_marks m WHERE m.tip_id=t.id AND m.kind='vote') AS votes,
      (SELECT COUNT(*) FROM growth_marks m WHERE m.tip_id=t.id AND m.kind='used') AS used,
      (SELECT COUNT(*) FROM growth_marks m WHERE m.tip_id=t.id AND m.kind='vote' AND m.account=?) AS voted
    FROM growth_tips t WHERE t.hidden=0 AND t.created_at > ? ORDER BY t.created_at DESC LIMIT ?`).bind(viewer ?? "", Date.now() - 7 * 86_400_000, limit).all<{ id: string; author: string; title: string; detail: string; action: string; created_at: number; votes: number; used: number; voted: number }>();
  return rows.results.map((r) => ({ id: r.id, author: r.author, title: r.title, detail: r.detail, action: JSON.parse(r.action) as TipAction, createdAt: new Date(r.created_at).toISOString(), votes: Number(r.votes), used: Number(r.used), mine: r.author === viewer, voted: Number(r.voted) > 0 }));
}
export async function postTip(author: string, t: { title: string; detail: string; action: TipAction }) {
  const d = await db();
  const today = await d.prepare("SELECT COUNT(*) AS n FROM growth_tips WHERE author=? AND created_at > ?").bind(author, Date.now() - 86_400_000).first<{ n: number }>();
  if (Number(today?.n ?? 0) >= TIPS_PER_DAY) throw new Error(`You can share ${TIPS_PER_DAY} tips a day.`);
  const id = crypto.randomUUID();
  await d.prepare("INSERT INTO growth_tips (id, author, title, detail, action, created_at) VALUES (?,?,?,?,?,?)").bind(id, author, t.title.trim(), t.detail.trim(), JSON.stringify(t.action), Date.now()).run();
  await credit(d, author, "tip", id, POINTS.tip);
  return id;
}
/** An upvote, or a "used" (someone opened the tip's action). Credits the author once per person; never your own. */
export async function markTip(account: string, tipId: string, kind: "vote" | "used") {
  const d = await db();
  const tip = await d.prepare("SELECT author FROM growth_tips WHERE id=? AND hidden=0").bind(tipId).first<{ author: string }>();
  if (!tip) throw new Error("That tip isn't available.");
  if (tip.author === account) return { credited: false };
  const r = await d.prepare("INSERT OR IGNORE INTO growth_marks (tip_id, account, kind, at) VALUES (?,?,?,?)").bind(tipId, account, kind, Date.now()).run();
  if ((r.meta?.changes ?? 0) > 0) await credit(d, tip.author, kind, tipId + ":" + account, kind === "vote" ? POINTS.upvote : POINTS.used);
  return { credited: (r.meta?.changes ?? 0) > 0 };
}
/** Use someone's invite code: once per account, never your own. Credits both sides. */
export async function applyInvite(account: string, code: string) {
  const d = await db();
  const owner = await d.prepare("SELECT account FROM growth_codes WHERE code=?").bind(code.toLowerCase()).first<{ account: string }>();
  if (!owner) throw new Error("That invite code isn't known.");
  if (owner.account === account) throw new Error("That's your own invite code.");
  const r = await d.prepare("INSERT OR IGNORE INTO growth_invites (account, referrer, at) VALUES (?,?,?)").bind(account, owner.account, Date.now()).run();
  if ((r.meta?.changes ?? 0) === 0) return { ok: false, reason: "This account already used an invite." };
  await credit(d, owner.account, "invite", account, POINTS.invite);
  await credit(d, account, "welcome", owner.account, POINTS.welcome);
  return { ok: true };
}
