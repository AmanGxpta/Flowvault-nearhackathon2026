"use client";

// Rotating quick prompts for the Research hero: three at a time from a fixed list of
// questions a DeFi user actually asks. Clicking one sends it to Ask FlowVault.

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BellRing, CalendarClock, ChevronRight, Coins, Gauge, HandCoins, Layers, LineChart, PieChart, Receipt, Repeat, Scale, ShieldCheck, TrendingUp, Wallet } from "lucide-react";

export const QUICK_PROMPTS: { text: string; icon: LucideIcon }[] = [
  { text: "Where can my idle stablecoins earn the most right now?", icon: Coins },
  { text: "What's the biggest risk in my portfolio today?", icon: AlertTriangle },
  { text: "Compare LiNEAR and rNEAR staking for my NEAR", icon: Scale },
  { text: "Which tokens in my wallet are earning nothing?", icon: Wallet },
  { text: "How much would $1,000 USDC earn on Rhea in a year?", icon: HandCoins },
  { text: "Summarize what moved in the market today", icon: LineChart },
  { text: "How concentrated is my portfolio?", icon: PieChart },
  { text: "Explain the risks of lending USDC on Rhea", icon: ShieldCheck },
  { text: "Do I have enough cash for my upcoming payments?", icon: Receipt },
  { text: "Alert me if NEAR drops more than 10%", icon: BellRing },
  { text: "Brief me every morning at 8 AM", icon: CalendarClock },
  { text: "Sweep my surplus USDC into lending every Friday", icon: Repeat },
  { text: "What would it cost to swap everything into USDC?", icon: Gauge },
  { text: "Which of my holdings changed most this week?", icon: TrendingUp },
  { text: "What's a low-risk strategy for my current holdings?", icon: Layers },
];

const SHOWN = 3, EVERY_MS = 9000;

export function QuickPrompts({ ask }: { ask: (text: string) => void }) {
  // Start at 0 so the server and first client render agree; pick a random page after mount.
  const [page, setPage] = useState(0);
  const paused = useRef(false);
  const pages = Math.ceil(QUICK_PROMPTS.length / SHOWN);
  useEffect(() => {
    const start = setTimeout(() => setPage(Math.floor(Math.random() * pages)), 0);
    const t = setInterval(() => { if (!paused.current && !document.hidden) setPage((p) => (p + 1) % pages); }, EVERY_MS);
    return () => { clearTimeout(start); clearInterval(t); };
  }, [pages]);
  const shown = QUICK_PROMPTS.slice(page * SHOWN, page * SHOWN + SHOWN);
  return <div className="fv-hub-quick" role="group" aria-label="Suggested questions"
    onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}
    onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}>
    {shown.map(({ text, icon: Icon }, i) => <button type="button" key={page + ":" + i} className="fv-hub-prompt fv-rise" style={{ ["--i" as string]: i }} onClick={() => ask(text)}>
      <Icon size={16} /><span>{text}</span><ChevronRight size={15} />
    </button>)}
    <span className="fv-hub-quick-dots">{Array.from({ length: pages }, (_, i) => <button type="button" key={i} aria-label={`Suggestions ${i + 1} of ${pages}`} aria-pressed={i === page} onClick={() => setPage(i)} />)}</span>
  </div>;
}
