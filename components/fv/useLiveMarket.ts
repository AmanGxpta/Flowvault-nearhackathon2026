"use client";
import { useEffect, useState } from "react";
import type { DisplayMarket } from "@/lib/flowvault/market-display";
import { mergeMarketFrame } from "@/lib/flowvault/market-stream";

export function useLiveMarket(coin: string, interval: string, refresh: number) {
  const key = coin + ":" + interval + ":" + refresh;
  const [state, setState] = useState<{ key: string; data: DisplayMarket | null; error: string; status: string }>({ key: "", data: null, error: "", status: "Connecting" });
  useEffect(() => {
    let active = true, socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined, failures = 0, lastFrame = 0, openedAt = 0, lastSnapshot = 0, fetching = false;
    const abort = new AbortController();
    let current: DisplayMarket | null = null;
    const publish = (error: string, label: string) => { if (active) setState({ key, data: current, error, status: label }); };
    const blank = (): DisplayMarket => ({ coin, interval, capturedAt: new Date().toISOString(), bookAt: null, mid: null, candles: [], bids: [], asks: [], warnings: [], stale: false });
    const status = (label: string) => publish("", label);
    async function snapshot() {
      if (!active || fetching || document.hidden) return;
      fetching = true;
      try {
        const res = await fetch("/api/markets?fresh=1&coin=" + coin + "&interval=" + interval, { cache: "no-store", signal: abort.signal });
        const data = await res.json() as DisplayMarket & { error?: string };
        if (!res.ok) throw new Error(data.error || "Market read failed");
        if (!active) return;
        if (current) {
          const stream = current;
          const book = (stream.bookAt ?? 0) > (data.bookAt ?? 0) ? stream : data;
          current = { ...data, bids: book.bids, asks: book.asks, bookAt: book.bookAt,
            mid: Date.now()-lastFrame < 15000 ? stream.mid ?? data.mid : data.mid,
            candles: [...new Map([...data.candles, ...(Date.now()-lastFrame < 15000 ? stream.candles : [])].map(c => [c.time,c])).values()].sort((a,b)=>a.time-b.time).slice(-96) };
        } else current = data;
        publish("", Date.now()-lastFrame < 15000 ? "Live" : "Polling · every 5s");
        lastSnapshot = Date.now();
      } catch (e) {
        if (active && !abort.signal.aborted) { if (current) current = { ...current, stale: true }; publish((e as Error).message, "Reconnecting"); }
      } finally { fetching = false; }
    }
    function connect() {
      if (!active || document.hidden) return;
      socket?.close();
      const ws = new WebSocket("wss://api.hyperliquid.xyz/ws"); socket = ws;
      ws.onopen = () => {
        if (!active || socket !== ws) return;
        failures = 0; openedAt = Date.now();
        for (const subscription of [{ type: "allMids" }, { type: "l2Book", coin }, { type: "candle", coin, interval }]) ws.send(JSON.stringify({ method: "subscribe", subscription }));
      };
      ws.onmessage = event => {
        if (!active || document.hidden || socket !== ws) return;
        let frame: unknown; try { frame = JSON.parse(event.data); } catch { return; }
        const before = current ?? blank(), after = mergeMarketFrame(before, frame);
        if (before === after) return;
        current = after; lastFrame = Date.now(); publish("", "Live");
      };
      ws.onclose = () => { if (!active || socket !== ws || document.hidden) return; status("Reconnecting · polling"); retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** failures++)); };
      ws.onerror = () => ws.close();
    }
    function visibility() {
      clearTimeout(retry);
      if (document.hidden) { const old = socket; socket = null; old?.close(); status("Paused in background"); }
      else { lastFrame = 0; connect(); void snapshot(); }
    }
    const start = setTimeout(() => { void snapshot(); connect(); }, 0);
    const poll = setInterval(() => {
      if (document.hidden) return;
      if (Date.now()-lastFrame > 15000 || Date.now()-lastSnapshot > 60000) void snapshot();
      if (socket?.readyState === WebSocket.OPEN) { if (Date.now() - Math.max(lastFrame, openedAt) > 20000) socket.close(); else socket.send(JSON.stringify({ method: "ping" })); }
    }, 5000);
    document.addEventListener("visibilitychange", visibility);
    return () => { active = false; clearTimeout(start); clearTimeout(retry); clearInterval(poll); abort.abort(); socket?.close(); document.removeEventListener("visibilitychange", visibility); };
  }, [coin, interval, key]);
  return state.key === key ? state : { key, data: null, error: "", status: "Connecting" };
}
