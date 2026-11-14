"use client";
// "Not connected" marker for anything that shows balances while the personal workspace has no wallet: a pill on top
// of a card, or a full banner with Connect wallet on top of a panel. Never shown in Demo Mode.
import { Wallet } from "lucide-react";

export function NotConnectedBanner({ connect, text = "Connect a wallet to see your balances here.", pill = false }: { connect?: () => void; text?: string; pill?: boolean }) {
  if (pill) return <span className="fv-nc-pill" role="status"><i aria-hidden /> Not connected</span>;
  return <div className="fv-nc-banner" role="status">
    <span className="fv-nc-icon"><Wallet size={15} /></span>
    <span className="fv-nc-text"><strong>Not connected</strong><span>{text}</span></span>
    {connect && <button type="button" className="fv-button fv-primary" onClick={connect}>Connect wallet</button>}
  </div>;
}
