"use client";
// Perpetuals on Hyperliquid (Stream C). Reads each proven Ethereum account's Hyperliquid margin account; lets the
// owner approve a FlowVault agent (signed in their own Ethereum wallet), create a perps mandate naming it, and
// place or close orders that FlowVault's agent signs only after the mandate's checks pass. Unrealized gains are
// shown but never counted as money you can spend. Withdrawals are signed by the master wallet.
import { useCallback, useEffect, useState } from "react";
import { api, type Scope } from "./live";
import { evmChainId, signTypedData, useMultiWallets } from "@/lib/flowvault/wallets";

type Check = { id: string; ok: boolean | null; detail: string };
interface Pos { coin: string; szi: string; entryPx: string | null; markPx: string | null; notionalUsdcRaw: string; unrealizedPnlUsdcRaw: string; liquidationPx: string | null; leverage: { type: string; value: number }; marginUsedUsdcRaw: string }
interface Snapshot { accountValueUsdcRaw: string; withdrawableUsdcRaw: string; marginUsedUsdcRaw: string; unrealizedPnlUsdcRaw: string; realizedEquityUsdcRaw: string; positions: Pos[]; capturedAt: string }
interface Link { master: string; agentAddress: string; status: string; validUntil: number; note?: string }
interface Order { cloid: string; intent: { coin: string; isBuy: boolean; size: string; reduceOnly: boolean; kind: string }; state: string; error?: string; checks: Check[]; createdAt: string }
interface Account { master: string; snapshot: Snapshot | null; link: Link | null; orders: Order[]; error: string | null }
interface State { source: string; agentsAvailable: boolean; accounts: Account[]; deposit: { note: string } }
interface MandateLite { id: string; state: string; title: string; frozen: unknown; authority: { kind: string }; scope: { accounts: string[] } }

const u = (raw: string) => {
  const n = BigInt(raw);
  const neg = n < 0n;
  const a = neg ? -n : n;
  return (neg ? "−" : "") + (a / 1000000n).toLocaleString("en-US") + "." + (a % 1000000n).toString().padStart(6, "0").slice(0, 2);
};
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const btn: React.CSSProperties = { padding: "7px 12px", borderRadius: "9px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", fontWeight: 500, cursor: "pointer" };
const muted: React.CSSProperties = { color: "var(--fvc-5B6458)", fontSize: "12.5px", lineHeight: 1.45 };
const input: React.CSSProperties = { padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", minWidth: 0 };

export function PerpsCard({ scope }: { scope: Scope }) {
  const [st, setSt] = useState<State | null>(null);
  const [mandates, setMandates] = useState<MandateLite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [form, setForm] = useState({ coin: "ETH", side: "buy", size: "0.01", leverage: "2", kind: "market", price: "" });
  const { sessions } = useMultiWallets();

  const read = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api("/api/perps", undefined, "GET", scope), api("/api/mandates", undefined, "GET", scope)]);
      setSt(p);
      setMandates((m.mandates ?? []).filter((x: MandateLite) => x.authority.kind === "hyperliquid_agent"));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [scope]);
  useEffect(() => {
    void read();
  }, [read]);

  const run = async (label: string, f: () => Promise<string | void>) => {
    setBusy(label);
    setNote(null);
    try {
      const msg = await f();
      if (msg) setNote(msg);
      await read();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const walletFor = (master: string) => sessions.find((s) => s.chain === "evm" && s.address.toLowerCase() === master);

  const approve = (master: string) =>
    run("approve", async () => {
      const w = walletFor(master);
      if (!w) throw new Error("Connect this Ethereum wallet in this browser first (wallet menu).");
      const chainId = await evmChainId(w);
      const start = await api("/api/perps", { action: "link_start", master, chainId }, "POST", scope);
      const signature = await signTypedData(w, start.typedData);
      const done = await api("/api/perps", { action: "link_finish", master, signature }, "POST", scope);
      return done.link.status === "verified" ? "Agent approved and confirmed on Hyperliquid. It can trade, not withdraw." : "Submitted; Hyperliquid hasn't listed the agent yet. Check again in a moment.";
    });
  const revoke = (master: string) =>
    run("revoke", async () => {
      const w = walletFor(master);
      const chainId = w ? await evmChainId(w) : 42161;
      const r = await api("/api/perps", { action: "revoke", master, chainId }, "POST", scope);
      if (w) {
        const signature = await signTypedData(w, r.deregister.typedData).catch(() => null);
        if (signature) {
          await api("/api/perps", { action: "relay", master, userAction: r.deregister.action, signature }, "POST", scope);
          return "Key deleted from FlowVault and the agent replaced on Hyperliquid.";
        }
      }
      return "Key deleted from FlowVault. " + r.deregister.note;
    });
  const withdraw = (master: string, amount: string) =>
    run("withdraw", async () => {
      const w = walletFor(master);
      if (!w) throw new Error("Connect this Ethereum wallet in this browser first.");
      const chainId = await evmChainId(w);
      const p = await api("/api/perps", { action: "withdraw_prepare", master, amount, chainId }, "POST", scope);
      const signature = await signTypedData(w, p.typedData);
      const r = await api("/api/perps", { action: "relay", master, userAction: p.action, signature }, "POST", scope);
      return r.response?.status === "ok" ? `Withdrawal accepted: you receive ${p.youReceiveUsdc} USDC. ${p.note}` : "Hyperliquid refused: " + JSON.stringify(r.response);
    });
  const order = (mandateId: string, master: string, close?: string) =>
    run("order", async () => {
      const key = crypto.randomUUID();
      const r = close
        ? await api("/api/perps", { action: "close", mandateId, master, coin: close, key }, "POST", scope)
        : await api("/api/perps", { action: "order", mandateId, master, coin: form.coin, isBuy: form.side === "buy", size: form.size, kind: form.kind, ...(form.kind === "limit" && form.price ? { price: form.price } : {}), reduceOnly: false, leverage: Number(form.leverage), key }, "POST", scope);
      const o: Order = r.order;
      const failed = o.checks.filter((c) => c.ok !== true);
      return `${o.intent.coin} ${o.intent.isBuy ? "buy" : "sell"} ${o.intent.size}: ${o.state}.` + (o.error ? " " + o.error : "") + (failed.length ? " Failed: " + failed.map((c) => c.detail).join(" ") : "");
    });

  if (st && st.source !== "live") return null;
  return (
    <section aria-label="Perpetuals" style={{ borderRadius: "18px", padding: "20px", background: "var(--fvb-FFFFFF)", border: "1px solid var(--fvb-E3E6DB)", marginTop: "16px" }}>
      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Perpetuals on Hyperliquid</h3>
      <p style={{ ...muted, margin: "4px 0 10px" }}>
        Margin you keep on Hyperliquid is not spendable cash, and unrealized gains never count as money you have. A FlowVault agent can trade inside a mandate you sign; only your own wallet can withdraw.
      </p>
      {err ? <p role="alert" style={muted}>Couldn’t read perpetuals: {err}</p> : null}
      {note ? <p role="status" style={{ ...muted, color: "var(--fvc-1E2A22)" }}>{note}</p> : null}
      {st && !st.accounts.length ? <p style={muted}>Connect and prove an Ethereum wallet to see its Hyperliquid account.</p> : null}
      {st && !st.agentsAvailable ? <p style={{ ...muted, color: "var(--fvc-8A5F25)" }}>Agent trading is off on this server (no agent-key secret configured). You can still see balances and withdraw.</p> : null}
      {st?.accounts.map((a) => {
        const s = a.snapshot;
        const m = mandates.find((x) => x.scope.accounts.includes("evm:" + a.master) && ["active", "approved", "draft", "paused"].includes(x.state));
        const activeM = m && m.state === "active" && !m.frozen ? m : null;
        return (
          <div key={a.master} style={{ borderTop: "1px solid var(--fvb-EEF0E8)", padding: "12px 0 4px", fontSize: "13px" }}>
            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{short(a.master)}</div>
            {a.error ? <div style={{ ...muted, color: "var(--fvc-8A5F25)" }}>Hyperliquid read failed: {a.error}</div> : null}
            {s ? (
              <div style={muted}>
                Account value {u(s.accountValueUsdcRaw)} USDC · counted {u(s.realizedEquityUsdcRaw)} · margin in use {u(s.marginUsedUsdcRaw)} · withdrawable {u(s.withdrawableUsdcRaw)} · unrealized {u(s.unrealizedPnlUsdcRaw)} (not spendable).
              </div>
            ) : null}
            {s?.positions.length ? (
              <ul style={{ ...muted, margin: "6px 0", paddingLeft: "18px" }}>
                {s.positions.map((p) => (
                  <li key={p.coin}>
                    {p.coin} {p.szi.startsWith("-") ? "short" : "long"} {p.szi.replace("-", "")} @ {p.entryPx ?? "—"} · mark {p.markPx ?? "—"} · {p.leverage.value}× {p.leverage.type} · PnL {u(p.unrealizedPnlUsdcRaw)} · liquidation {p.liquidationPx ?? "none"}
                    {activeM ? <button type="button" style={{ ...btn, marginLeft: "8px", padding: "3px 8px" }} disabled={!!busy} onClick={() => void order(activeM.id, a.master, p.coin)}>Close</button> : null}
                  </li>
                ))}
              </ul>
            ) : s ? <div style={muted}>No open positions.</div> : null}
            <div style={{ ...muted, marginTop: "4px" }}>
              Agent: {a.link ? `${short(a.link.agentAddress)} · ${a.link.status}${a.link.status === "verified" ? " until " + new Date(a.link.validUntil).toLocaleDateString() : ""}` : "none"}
              {m ? ` · mandate “${m.title}” ${m.state}${m.frozen ? " (frozen)" : ""} — manage it under Policy › Autonomous mandates` : ""}
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
              {st.agentsAvailable && (!a.link || ["revoked", "expired", "awaiting_master_signature"].includes(a.link.status)) ? (
                <button type="button" style={btn} disabled={!!busy} onClick={() => void approve(a.master)}>{busy === "approve" ? "Waiting for wallet…" : "Approve FlowVault agent…"}</button>
              ) : null}
              {a.link?.status === "verified" && !m ? <button type="button" style={btn} disabled={!!busy} onClick={() => void run("mandate", async () => { await api("/api/perps", { action: "mandate_create", master: a.master }, "POST", scope); return "Draft mandate created. Review and sign it under Policy › Autonomous mandates."; })}>Create perps mandate</button> : null}
              {a.link && a.link.status !== "revoked" ? <button type="button" style={btn} disabled={!!busy} onClick={() => void revoke(a.master)}>Revoke agent</button> : null}
              {s && BigInt(s.withdrawableUsdcRaw) > 1000000n ? (
                <span style={{ display: "inline-flex", gap: "6px" }}>
                  <input aria-label="USDC to withdraw" placeholder="USDC" style={{ ...input, width: "90px" }} value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
                  <button type="button" style={btn} disabled={!!busy || !amount} onClick={() => void withdraw(a.master, amount)}>Withdraw to my address…</button>
                </span>
              ) : null}
              <button type="button" style={btn} disabled={!!busy} onClick={() => void run("sync", async () => { const r = await api("/api/perps", { action: "sync", master: a.master }, "POST", scope); return `${r.entries.length} ledger entries checked.`; })}>Book fills & funding</button>
            </div>
            {activeM ? (
              <form onSubmit={(e) => { e.preventDefault(); void order(activeM.id, a.master); }} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "6px", marginTop: "10px" }}>
                <select aria-label="Market" style={input} value={form.coin} onChange={(e) => setForm({ ...form, coin: e.target.value })}><option>ETH</option><option>BTC</option></select>
                <select aria-label="Side" style={input} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}><option value="buy">Long</option><option value="sell">Short</option></select>
                <input aria-label="Size" style={input} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value.trim() })} />
                <input aria-label="Leverage" style={input} value={form.leverage} onChange={(e) => setForm({ ...form, leverage: e.target.value.trim() })} />
                <select aria-label="Order type" style={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="market">Market (IOC)</option><option value="limit">Limit</option></select>
                {form.kind === "limit" ? <input aria-label="Limit price" placeholder="Price" style={input} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.trim() })} /> : null}
                <button type="submit" style={btn} disabled={!!busy}>{busy === "order" ? "Checking…" : "Check & place"}</button>
              </form>
            ) : null}
            {a.orders.length ? (
              <details style={{ ...muted, marginTop: "6px" }}>
                <summary style={{ cursor: "pointer" }}>Recent orders ({a.orders.length})</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                  {a.orders.map((o) => <li key={o.cloid}>{new Date(o.createdAt).toLocaleString()} · {o.intent.coin} {o.intent.isBuy ? "buy" : "sell"} {o.intent.size}{o.intent.reduceOnly ? " (reduce-only)" : ""} · {o.state}{o.error ? " — " + o.error : ""}</li>)}
                </ul>
              </details>
            ) : null}
          </div>
        );
      })}
      {st ? <p style={{ ...muted, fontSize: "11.5px", marginTop: "8px" }}>{st.deposit.note}</p> : null}
    </section>
  );
}
