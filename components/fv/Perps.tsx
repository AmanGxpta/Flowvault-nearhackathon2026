"use client";
// Perpetuals on Hyperliquid (Stream C). Reads each proven Ethereum account's Hyperliquid margin account; lets the
// owner approve a FlowVault agent (signed in their own Ethereum wallet), create a perps mandate naming it, and
// place or close orders that FlowVault's agent signs only after the mandate’s checks pass. Unrealized gains are
// shown but never counted as money you can spend. Withdrawals are signed by the master wallet.
import { useCallback, useEffect, useState } from "react";
import { TokenIcon } from "./AssetIdentity";
import { Share2 } from "lucide-react";
import type {AgentMandate} from "@/lib/flowvault/contracts";
import {perpLimitForm,perpLimitUpdate} from "@/lib/flowvault/perps-limits";
import { api, type Scope } from "./live";
import { evmChainId, signTypedData, useMultiWallets } from "@/lib/flowvault/wallets";

type Check = { id: string; ok: boolean | null; detail: string };
interface Pos { coin: string; szi: string; entryPx: string | null; markPx: string | null; notionalUsdcRaw: string; unrealizedPnlUsdcRaw: string; liquidationPx: string | null; leverage: { type: string; value: number }; marginUsedUsdcRaw: string }
interface Snapshot { accountValueUsdcRaw: string; withdrawableUsdcRaw: string; marginUsedUsdcRaw: string; unrealizedPnlUsdcRaw: string; realizedEquityUsdcRaw: string; positions: Pos[]; capturedAt: string }
interface Link { master: string; agentAddress: string; status: string; validUntil: number; note?: string }
interface Order { cloid: string; intent: { coin: string; isBuy: boolean; size: string; reduceOnly: boolean; kind: string }; state: string; error?: string; checks: Check[]; createdAt: string }
interface Account { master: string; snapshot: Snapshot | null; spotUsdcRaw?: string; funded?: boolean; link: Link | null; orders: Order[]; error: string | null }
interface State { source: string; agentsAvailable: boolean; accounts: Account[]; deposit: { token: string; note: string } }
const USDC_ETH = "eth:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
type MandateLite = AgentMandate;

const u = (raw: string) => {
  const n = BigInt(raw);
  const neg = n < 0n;
  const a = neg ? -n : n;
  return (neg ? "−" : "") + (a / 1000000n).toLocaleString("en-US") + "." + (a % 1000000n).toString().padStart(6, "0").slice(0, 2);
};
/** USDC base units → a plain amount with 2 decimals, rounded down (what the spot → perps move signs). */
const cents = (raw: bigint) => { const c = raw / 10000n; return `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`; };
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const btn: React.CSSProperties = { padding: "7px 12px", borderRadius: "9px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", fontWeight: 500, cursor: "pointer" };
const muted: React.CSSProperties = { color: "var(--fvc-5B6458)", fontSize: "12.5px", lineHeight: 1.45 };
const input: React.CSSProperties = { padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", minWidth: 0 };

export function PerpsCard({ scope, onShare, selectedMarket, onMarket, draft, onNavigate }: { scope: Scope; onNavigate?: (view: string) => void; selectedMarket?: string; onMarket?: (coin: string) => void; onShare?: (value: { title: string; subtitle: string; lines: string[]; amount?: string }) => void; draft?: { coin: string; side: string; size: string; leverage: string; kind: string; price: string; n: number } | null }) {
  const [st, setSt] = useState<State | null>(null);
  const [mandates, setMandates] = useState<MandateLite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<{ mandateId: string; master: string; fingerprint: string; closeCoin?: string } | null>(null);
  const [form, setForm] = useState({ coin: "ETH", side: "buy", size: "0.01", leverage: "2", kind: "market", price: "" });
  const { sessions } = useMultiWallets();
  // A draft from the order ticket fills this form; the owner still reviews it here against the mandate.
  useEffect(() => { if (!draft) return; const t = setTimeout(() => setForm({ coin: draft.coin, side: draft.side, size: draft.size, leverage: draft.leverage, kind: draft.kind, price: draft.price }), 0); return () => clearTimeout(t); }, [draft]);
  const selectedCoin = selectedMarket ?? form.coin;
  const fingerprint = JSON.stringify({...form,coin:selectedCoin});

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
    const timer = setTimeout(() => void read(), 0);
    return () => clearTimeout(timer);
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
  // Funding: open the in-app swap prefilled to deliver USDC to this master's own Hyperliquid account (NEAR Intents).
  const fund = (master: string) => {
    if (!st || !onNavigate) return;
    const u = new URL(window.location.href);
    for (const k of ["buy", "swap", "token"]) u.searchParams.delete(k);
    u.searchParams.set("swap", [USDC_ETH, st.deposit.token, "", master].join("|"));
    history.replaceState(null, "", u);
    onNavigate("swap");
    window.dispatchEvent(new Event("fv-prefill"));
  };
  const toPerp = (master: string, amount: string) =>
    run("perp:" + master, async () => {
      const w = walletFor(master);
      if (!w) throw new Error("Connect this Ethereum wallet in this browser first (wallet menu).");
      const chainId = await evmChainId(w);
      const p = await api("/api/perps", { action: "to_perp_prepare", master, amount, chainId }, "POST", scope);
      const signature = await signTypedData(w, p.typedData);
      await api("/api/perps", { action: "relay", master, userAction: p.action, signature }, "POST", scope);
      return `Moved ${amount} USDC to perps margin.`;
    });
  const walletFor = (master: string) => sessions.find((s) => s.chain === "evm" && s.address.toLowerCase() === master);

  const approve = (master: string) =>
    run("approve:" + master, async () => {
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
      return r.response?.status === "ok" ? `Withdrawal accepted: you receive ${p.youReceiveUsdc} USDC. ${p.note}` : "Hyperliquid didn't confirm the withdrawal.";
    });
  const order = (mandateId: string, master: string, close?: string) =>
    run("order", async () => {
      const key = crypto.randomUUID();
      const r = close
        ? await api("/api/perps", { action: "close", mandateId, master, coin: close, key }, "POST", scope)
        : await api("/api/perps", { action: "order", mandateId, master, coin: selectedCoin, isBuy: form.side === "buy", size: form.size, kind: form.kind, ...(form.kind !== "market" && form.price ? { price: form.price } : {}), reduceOnly: form.kind === "stop_loss" || form.kind === "take_profit", leverage: Number(form.leverage), key }, "POST", scope);
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
      {st && !st.agentsAvailable ? <p style={{ ...muted, color: "var(--fvc-8A5F25)" }}>Trading setup is incomplete for this installation. Position reads remain available; withdrawals require your connected wallet and an eligible balance.</p> : null}
      {st?.accounts.map((a) => {
        const s = a.snapshot;
        const m = mandates.find((x) => x.scope.accounts.includes("evm:" + a.master) && ["active", "approved", "draft", "paused"].includes(x.state));
        const activeM = m && m.state === "active" && !m.frozen ? m : null;
        const spot = BigInt(a.spotUsdcRaw ?? "0"), unfunded = a.funded === false;
        return (
          <div key={a.master} style={{ borderTop: "1px solid var(--fvb-EEF0E8)", padding: "12px 0 4px", fontSize: "13px" }}>
            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{short(a.master)}</div>
            {a.error ? <div style={{ ...muted, color: "var(--fvc-8A5F25)" }}>Hyperliquid read failed: {a.error}</div> : null}
            {unfunded ? <div className="fv-notice" style={{ marginTop: "6px" }}>Hyperliquid accepts an agent (or any action) only from a wallet that has deposited there. Add trading funds to this address first; the agent approval comes after.</div> : null}
            {s ? (
              <div className="fv-perp-stats"><div><small>Account value (USDC)</small><strong>{u(s.accountValueUsdcRaw)}</strong></div><div><small>Withdrawable (USDC)</small><strong>{u(s.withdrawableUsdcRaw)}</strong></div><div><small>Unrealized PnL (USDC)</small><strong>{u(s.unrealizedPnlUsdcRaw)}</strong></div>{spot > 0n ? <div><small>Spot USDC (not margin yet)</small><strong>{u(spot.toString())}</strong></div> : null}</div>
            ) : null}
            {s?.positions.length ? (
              <div>
                {s.positions.map(p => <div className="fv-perp-position" key={p.coin}>
                  <div className="fv-section-head"><div className="fv-asset-cell"><TokenIcon symbol={p.coin} core={['ETH','BTC'].includes(p.coin)} /><strong>{p.coin}</strong><span className="fv-chip">{p.szi.startsWith('-') ? 'Short' : 'Long'} · {p.leverage.value}×</span></div>{onShare && <button style={btn} onClick={() => onShare({title:p.coin + ' ' + (p.szi.startsWith('-') ? 'Short' : 'Long'),subtitle:'Open position · unrealized · ' + new Date(s.capturedAt).toLocaleString(),lines:[p.leverage.value + '× ' + p.leverage.type, 'Entry ' + (p.entryPx ?? 'Unknown'), 'Mark ' + (p.markPx ?? 'Unknown')],amount:u(p.unrealizedPnlUsdcRaw) + ' USDC unrealized PnL'})}><Share2 size={14}/> Share</button>}</div>
                  <div className="fv-perp-stats"><div><small>Size</small><strong>{p.szi.replace('-','')} {p.coin}</strong></div><div><small>Entry / mark</small><strong>{p.entryPx ?? '—'} / {p.markPx ?? '—'}</strong></div><div><small>Unrealized PnL</small><strong>{u(p.unrealizedPnlUsdcRaw)} USDC</strong></div><div><small>Liquidation estimate</small><strong>{p.liquidationPx ?? 'Unavailable'}</strong></div><div><small>Margin used</small><strong>{u(p.marginUsedUsdcRaw)} USDC</strong></div></div>
                  {activeM && <div className="fv-actions"><button type="button" style={btn} disabled={!!busy} onClick={() => { setReview({mandateId:activeM.id,master:a.master,fingerprint,closeCoin:p.coin}); }}>Close position</button>{['stop_loss','take_profit'].map(kind => <button key={kind} style={btn} onClick={() => { setReview(null); onMarket?.(p.coin); setForm({ coin:p.coin, side:p.szi.startsWith('-') ? 'buy' : 'sell',size:p.szi.replace('-',''),leverage:String(p.leverage.value),kind,price:'' }); }}>{kind === 'stop_loss' ? 'Stop loss' : 'Take profit'}</button>)}</div>}
                </div>)}
              </div>
            ) : s ? <div style={muted}>No open positions.</div> : null}
            <div style={{ ...muted, marginTop: "4px" }}>
              Agent: {a.link ? `${short(a.link.agentAddress)} · ${a.link.status}${a.link.status === "verified" ? " until " + new Date(a.link.validUntil).toLocaleDateString() : ""}` : "none"}
              {m ? ` · mandate “${m.title}” ${m.state}${m.frozen ? " (frozen)" : ""} — manage it under Risk & permissions › Automations` : ""}
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
              {onNavigate ? <button type="button" style={unfunded ? { ...btn, background: "var(--fvc-1E2A22)", color: "var(--fvb-FFFFFF)" } : btn} disabled={!!busy} onClick={() => fund(a.master)}>Add trading funds…</button> : null}
              {spot >= 1000000n ? <button type="button" style={btn} disabled={!!busy} onClick={() => void toPerp(a.master, cents(spot))}>{busy === "perp:" + a.master ? "Waiting for wallet…" : `Move ${cents(spot)} USDC to perps margin…`}</button> : null}
              {st.agentsAvailable && !unfunded && (!a.link || ["revoked", "expired", "awaiting_master_signature"].includes(a.link.status)) ? (
                <button type="button" style={btn} disabled={!!busy} onClick={() => void approve(a.master)}>{busy === "approve:" + a.master ? "Waiting for wallet…" : "Approve FlowVault agent…"}</button>
              ) : null}
              {a.link?.status === "verified" && !m ? <button type="button" style={btn} disabled={!!busy} onClick={() => void run("mandate", async () => { await api("/api/perps", { action: "mandate_create", master: a.master }, "POST", scope); return "Draft mandate created. Review and sign it under Risk & permissions › Automations."; })}>Create perps mandate</button> : null}
              {a.link && a.link.status !== "revoked" ? <button type="button" style={btn} disabled={!!busy} onClick={() => void revoke(a.master)}>Revoke agent</button> : null}
              {s && BigInt(s.withdrawableUsdcRaw) > 1000000n ? (
                <span style={{ display: "inline-flex", gap: "6px" }}>
                  <input aria-label="USDC to withdraw" placeholder="USDC" style={{ ...input, width: "90px" }} value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
                  <button type="button" style={btn} disabled={!!busy || !amount} onClick={() => void withdraw(a.master, amount)}>Withdraw to my address…</button>
                </span>
              ) : null}
              <button type="button" style={btn} disabled={!!busy} onClick={() => void run("sync", async () => { const r = await api("/api/perps", { action: "sync", master: a.master }, "POST", scope); return `${r.entries.length} ledger entries checked.`; })}>Sync trading history</button>
            </div>
            {m?.perps ? <PerpsLimitsEditor key={m.id+":"+m.version} mandate={m} scope={scope} changed={read} /> : null}
            {activeM ? (
              <form onSubmit={(e) => { e.preventDefault(); setReview({mandateId:activeM.id,master:a.master,fingerprint}); }} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "6px", marginTop: "10px" }}>
                <select aria-label="Market" style={input} value={selectedCoin} onChange={(e) => {setForm({ ...form, coin: e.target.value });onMarket?.(e.target.value);}}><option>ETH</option><option>BTC</option><option>NEAR</option></select>
                <select aria-label="Side" style={input} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}><option value="buy">Long</option><option value="sell">Short</option></select>
                <input aria-label="Size" style={input} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value.trim() })} />
                <input aria-label="Leverage" style={input} value={form.leverage} onChange={(e) => setForm({ ...form, leverage: e.target.value.trim() })} />
                <select aria-label="Order type" style={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="market">Market (IOC)</option><option value="limit">Limit</option><option value="stop_loss">Stop loss · reduce only</option><option value="take_profit">Take profit · reduce only</option></select>
                {form.kind !== "market" ? <input aria-label={form.kind === "limit" ? "Limit price" : "Trigger price"} placeholder={form.kind === "limit" ? "Limit price" : "Trigger price"} style={input} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.trim() })} /> : null}
                <button type="submit" style={btn} disabled={!!busy}>{busy === "order" ? "Checking…" : "Review order"}</button>
              </form>
            ) : null}
            {review?.master === a.master && review.fingerprint === fingerprint && activeM && review.mandateId === activeM.id ? <section className="fv-perp-position" aria-label="Review order"><h3>{review.closeCoin ? "Close " + review.closeCoin + " position" : "Review order"}</h3><p>{review.closeCoin ? "A reduce-only order will close the current position." : <>{form.side === 'buy' ? 'Buy / long' : 'Sell / short'} {form.size} {selectedCoin} · {form.leverage}× · {form.kind.replace('_',' ')}{form.price ? ' at ' + form.price : ''}</>}</p><p style={muted}>Your active trading agent submits this order under the limits you signed. It does not open a new wallet signature. Fees, margin and liquidation depend on execution; orders may be rejected. {form.kind === 'stop_loss' || form.kind === 'take_profit' ? 'Reduce only: this order can reduce an existing position, not open one.' : 'Leverage increases both gains and losses.'}</p><button style={btn} disabled={!!busy} onClick={() => {setReview(null);void order(activeM.id,a.master,review.closeCoin);}}>{review.closeCoin ? "Confirm close position" : "Confirm and place order"}</button><button style={btn} onClick={() => setReview(null)}>Back to edit</button></section> : null}
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
      {st ? <details style={{...muted,marginTop:18}}><summary style={{cursor:"pointer"}}>How funding works</summary><p>{st.deposit.note}</p></details> : null}
    </section>
  );
}

function PerpsLimitsEditor({mandate:m,scope,changed}:{mandate:AgentMandate;scope:Scope;changed:()=>Promise<void>}) {
  const [values,setValues]=useState(()=>perpLimitForm(m)),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const editable=["draft","approved","paused","active"].includes(m.state);
  async function save(){setBusy(true);setMessage("");try{
    const terms=perpLimitUpdate(values);
    if(m.state==="active")await api("/api/mandates",{action:"pause",id:m.id},"POST",scope);
    await api("/api/mandates",{action:"update",id:m.id,terms},"POST",scope);
    setMessage("Limits saved as draft. Sign the current terms, then explicitly activate. Trading stays paused until then.");await changed();
  }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function sign(){setBusy(true);setMessage("");try{
    const c=await api("/api/mandates",{action:"challenge",id:m.id},"POST",scope);
    const {walletClient}=await import("@/lib/flowvault/wallet"),{selector}=await walletClient(),wallet=await selector.wallet(),{Buffer}=await import("buffer");
    // The existing mandate challenge binds these limits, authority and version to the owner's NEP-413 signature.
    const signed=await (wallet as unknown as {signMessage(p:unknown):Promise<{signature:string;publicKey:string;accountId:string}>}).signMessage({message:c.message,recipient:c.recipient,nonce:Buffer.from(c.nonce,"base64")});
    if(!signed?.signature)throw new Error("The wallet did not return a signature.");
    await api("/api/mandates",{action:"approve",id:m.id,challengeId:c.challengeId,signature:signed.signature,publicKey:signed.publicKey,accountId:signed.accountId},"POST",scope);
    setMessage("Terms signed. Activate separately to resume trading under these limits.");await changed();
  }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function activate(){setBusy(true);setMessage("");try{await api("/api/mandates",{action:"activate",id:m.id},"POST",scope);await changed();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  const labels:Record<keyof typeof values,string>={leverage:"Maximum leverage (1–20×)",notional:"Maximum order notional (USDC)",daily:"Daily notional limit (USDC)",margin:"Maximum margin capital (USDC)",loss:"Loss-stop limit (USDC)"};
  return <details style={{marginTop:10,border:"1px solid var(--fvb-E3E6DB)",padding:12,borderRadius:10}}>
    <summary style={{cursor:"pointer",fontWeight:600}}>Perpetual limits · mandate version {m.version} · {m.state}</summary>
    <p style={muted}>These are FlowVault checks; Hyperliquid does not impose the mandate’s size, leverage or loss limits. Changing any limit requires a new signature. Saving an active mandate pauses it first.</p>
    <form onSubmit={e=>{e.preventDefault();void save();}} style={{display:"grid",gap:8,gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",marginTop:10}}>
      {(Object.keys(labels) as (keyof typeof values)[]).map(k=><label key={k} style={muted}>{labels[k]}<input style={{...input,width:"100%"}} value={values[k]} inputMode={k==="leverage"?"numeric":"decimal"} disabled={busy||!editable} onChange={e=>setValues({...values,[k]:e.target.value.trim()})}/></label>)}
      <button type="submit" style={btn} disabled={busy||!editable}>{m.state==="active"?"Pause and save new limits":"Save limits as draft"}</button>
    </form>
    {m.state==="draft"?<button type="button" style={{...btn,marginTop:8}} disabled={busy} onClick={()=>void sign()}>Sign current terms…</button>:null}
    {m.state==="approved"?<button type="button" style={{...btn,marginTop:8}} disabled={busy} onClick={()=>void activate()}>Activate signed limits</button>:null}
    {message?<p role="status" style={muted}>{message}</p>:null}
  </details>;
}
