"use client";
/* eslint-disable */
import { Component } from "react";
import { Shell } from "./Shell";
import { TODAY, MON, days, dlabel, num, usd, short, iso } from "./format";
import { liveState, liveVals, liveConfigure, liveDecide, liveExecute, livePreviews } from "./live-adapt";
import { emptySnapshot } from "./live";
// The personal account comes from the live workspace (connected or watched); never hard-coded.
let LIVE_ACC = '';
const DEMO_ACC = 'fictional example account';
let ACC = LIVE_ACC;
const WS_KEYS = ['wallet', 'rhea', 'evm', 'obs', 'intents', 'ops', 'reserve', 'reserveDraft', 'version', 'horizon', 'lead', 'planDraft', 'pol', 'polDraft', 'revisions'];
const QS_LIST = [['Can I pay 1,000 USDT on BNB next week without touching my ETH?', 'Pay 1,000 USDT on BNB', 'pay'], ['Where should my surplus go?', 'Surplus', 'surplus'], ['What if ETH falls 50%?', 'ETH −50%', 'stress'], ['Why was my 6,000 USDC supply blocked?', 'Why blocked', 'blocked']];
// Route costs come only from the API's quotes; nothing is assumed locally.
const FEES: any = {};
const NOFEE = { fee: 0, buf: 0, time: '—' };
const S = (label: any, detail: any, time: any, hash: any, state: any) => ({ label, detail, time, hash, state });
const ST: any = {
  paid: ['Paid · verified', '#E2EAD6', '#3F6B3C'], confirmed: ['Confirmed', '#E2EAD6', '#3F6B3C'], refunded: ['Refunded', '#F6EBDD', '#8A5F25'],
  stuck: ['Needs recovery', '#F6E3DE', '#9A3F32'], progress: ['In progress', '#E7ECF3', '#3F5A7A'], upcoming: ['Upcoming', '#EEF0E8', '#5B6458'],
  soon: ['Due soon', '#F6EBDD', '#8A5F25'], prepared: ['Prepared · not signed', '#EEF0E8', '#5B6458'], awaiting: ['Waiting for wallet', '#E7ECF3', '#3F5A7A'], failedtx: ['Failed · nothing moved', '#F6E3DE', '#9A3F32'], cancelled: ['Cancelled', '#F4F5EF', '#8A9285'], paying: ['Paying · check status', '#E7ECF3', '#3F5A7A'], failed: ['Refunded · not paid', '#F6E3DE', '#9A3F32'], later: ['Outside horizon', '#F4F5EF', '#8A9285']
};
const DOT: any = {
  done: { dotBg: '#4E7A4A', dotBorder: '#4E7A4A', glyph: '✓', labelColor: '#1E2A22', anim: 'none' },
  active: { dotBg: '#fff', dotBorder: '#4E7A4A', glyph: '', labelColor: '#1E2A22', anim: 'fvpulse 1.2s infinite' },
  pending: { dotBg: '#fff', dotBorder: '#D5DACB', glyph: '', labelColor: '#8A9285', anim: 'none' },
  fail: { dotBg: '#B4543F', dotBorder: '#B4543F', glyph: '✕', labelColor: '#9A3F32', anim: 'none' },
  warn: { dotBg: '#C08A45', dotBorder: '#C08A45', glyph: '!', labelColor: '#8A5F25', anim: 'none' },
};
const deco = (steps: any) => { let found = false; return steps.map((s: any) => { let st = s.state; if (st === 'pending' && !found) { st = 'active'; found = true; } if (st === 'active') found = true; return { ...s, ...DOT[st] }; }); };
const AS = (o: any) => (o && o.asset) || 'USDC';
// Empty policy shape until GET /api/policy answers; the design's example policy is not used.
const POL = () => ({ rev: 0, perAction: 0, daily: 0, used: 0, maxMove: 0, borrow: false, venues: { rhea: false, oneclick: false, native: false, linear: false, rnear: false, vault: false },
  assets: { usdc: { p: '—', uses: [] }, evmusdc: { p: '—', uses: [] }, near: { p: '—', uses: [] }, staked: { p: '—', uses: [] }, linear: { p: '—', uses: [] }, rnear: { p: '—', uses: [] }, eth: { p: '—', uses: [] } } });
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const isEvm = (a: any) => /^0x[0-9a-fA-F]{40}$/.test(a);
const isNear = (a: any) => /^([a-z0-9_-]+\.)*[a-z0-9_-]+\.(near|tg)$/.test(a) || /^[0-9a-f]{64}$/.test(a);

export class DesignApp extends Component<any, any> {
  iv: any; tt: any; onKey: any; onResize: any; opener: any; polTestKey: any; polTestTimer: any; creditKey: any; creditTimer: any; opPollFor: any; payPollFor: any;
  constructor(props: any) { super(props); this.state = this.init(props); }
  init(p: any) {
    const s: any = {
      ds: 'api', wallet: 0, rhea: 0, reserve: 0, reserveDraft: '', version: 1, horizon: 30, lead: 3,
      planDraft: { reserve: '', horizon: '30', lead: '3' },
      obs: [], ops: [], screen: p.screen || 'overview', modal: null, op: null, pay: null,
      form: { name: '', amount: '', chain: 'Arbitrum', token: 'USDC', recurrence: 'none', recipient: '', due: iso(13), note: '', confirmed: false },
      compareTo: null, cmpAmount: null, openOp: null, toast: null, retried: false,
      credit: { dd: 50, cap: 70, hp: 15, debt: 0, prio: 'P2' },
      judge: !!p.judge, asst: { open: !!p.assistant, msgs: [], input: '' }, pol: POL(), polDraft: POL(), revisions: [],
      test: { kind: 'supply', amount: '6000', asset: 'usdc', venue: 'rhea' }, stk: { amt: '30', by: null }, payPick: null, pfDate: null
    };
    s.ws = p.judge ? 'demo' : 'live'; s.intent = null; s.stress = { eth: { on: true }, linear: { on: true, dd: 60, cap: 50 }, rnear: { on: true, dd: 60, cap: 50 }, near: { on: false, dd: 60, cap: 50 } };
    try { s.whyOff = JSON.parse(sessionStorage.getItem('fv-why') || '{}'); } catch (e) { s.whyOff = {}; } s.replay = null; s.connected = false; s.menu = null; s.confirm = null; s.vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    Object.assign(s, this.wsData(s.ws)); s.pfLiveDate = 'now';
    if (s.ws !== 'live') { s.firstRun = false; } s.watchAddr = ''; s.watchDraft = ''; s.actTab = 'timeline'; s.proposals = [];
    return s;
  }
  componentDidMount() {
    if (!this.props.frozen) this.iv = setInterval(() => this.tick(), 1000);
    this.onKey = (e: any) => {
      // Keep keyboard focus inside an open dialog or the assistant panel.
      if (e.key === 'Tab') { const box = document.querySelector('[role=dialog]') || (this.state.asst.open ? document.querySelector('[data-asst-panel]') : null); if (!box) return; const f = [...box.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,a[href],[tabindex="0"]')] as any[]; if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); } else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } return; }
      if (e.key !== 'Escape') return; const s = this.state; if (s.modal) this.endModal(); else if (s.menu) this.closeMenu(); else if (s.asst.open) this.closeAsst(); };
    this.onResize = () => this.setState({ vw: window.innerWidth });
    document.addEventListener('keydown', this.onKey); window.addEventListener('resize', this.onResize);
  }
  componentWillUnmount() { clearInterval(this.iv); clearTimeout(this.tt); document.removeEventListener('keydown', this.onKey); window.removeEventListener('resize', this.onResize); }
  findOb(id: any) { const s = this.state; return s.obs.find((o: any) => o.id === id) || (s.intents || []).find((o: any) => o.id === id); }
  srcNow() { const s = this.state; return s.replay ? 'replay' : s.ws === 'demo' ? 'example' : 'session'; }
  isLive() { return this.state && this.state.ws === 'live'; }
  liveCall(fn: any, okMsg?: any) { Promise.resolve().then(fn).then(() => okMsg && this.toastMsg(okMsg)).catch((e: any) => this.toastMsg(e && e.message ? e.message : 'Something went wrong. Nothing was signed.')); }
  /** The one data-source adapter: the API snapshot for the selected slot (personal or example), else null while it loads. */
  apiSource(ws?: any) {
    const live = this.props.live; const which = ws || (this.state && this.state.ws);
    if (!live || !live.workspace) return null;
    return live.scope === (which === 'demo' ? 'example' : 'personal') ? live : null;
  }
  /** A loading snapshot for the selected slot: reading states, never figures. */
  pendingSource(ws?: any) {
    const which = ws || (this.state && this.state.ws); const scope = which === 'demo' ? 'example' : 'personal'; const live = this.props.live || {};
    return { ...emptySnapshot(scope), walletAccount: live.walletAccount ?? null, walletName: live.walletName ?? '', walletError: live.walletError ?? '', replays: live.replays ?? [], status: live.scope === scope && live.status === 'error' ? 'error' : 'loading', error: live.scope === scope ? live.error ?? '' : '' };
  }
  wsData(ws: any, _ds?: any) {
    const snap = this.apiSource(ws);
    const st: any = { ...liveState(snap || this.pendingSource(ws)), src: snap ? 'api' : 'none' };
    if (ws === 'live') { LIVE_ACC = (snap && snap.workspace.accountId) || ''; ACC = LIVE_ACC; if (!snap) st.firstRun = false; }
    else { ACC = DEMO_ACC; st.connected = false; st.firstRun = false; }
    return st;
  }
  setWorkspace(ws: any) {
    const s = this.state; if (s.ws === ws) return this.setState({ menu: null });
    ACC = ws === 'demo' ? DEMO_ACC : LIVE_ACC;
    this.setState({ ...this.wsData(ws), ws, judge: ws === 'demo', modal: null, replay: null, menu: null, pay: null, op: null, polTest: null, creditRes: null, cmpRes: null, stakeQuote: null, asst: { ...s.asst, msgs: [] } });
    if (this.props.actions) this.liveCall(() => this.props.actions.setMode(ws));
    this.toastMsg(ws === 'demo' ? 'Demo Mode: the fictional example workspace. Your personal workspace is untouched.' : 'Back in your personal workspace.');
  }
  startReplay(fn: any) { const s = this.state; const snap: any = {}; WS_KEYS.forEach((k: any) => { snap[k] = clone(s[k]); }); this.setState({ replay: snap }, fn); }
  endModal(extra: any = {}) {
    const s = this.state;
    if (s.replay) {
      const snap = s.replay; const ids = new Set(snap.ops.map((o: any) => o.id));
      const fresh = s.ops.filter((o: any) => !ids.has(o.id)).map((o: any) => ({ ...o, src: 'replay' }));
      this.setState({ ...snap, ops: [...fresh, ...snap.ops], replay: null, modal: null, confirm: null, ...extra });
      this.toastMsg('Replay finished. Your figures are unchanged; the replay is kept in Activity.');
    } else this.setState({ modal: null, confirm: null, ...extra });
    this.refocus();
  }
  remember() { if (typeof document !== 'undefined') this.opener = document.activeElement; }
  refocus() { const el = this.opener; this.opener = null; if (el && el.focus) setTimeout(() => { try { el.focus(); } catch (e) {} }, 0); }
  closeMenu() { this.setState({ menu: null }); this.refocus(); }
  closeAsst() { this.setState({ asst: { ...this.state.asst, open: false } }); this.refocus(); }
  componentDidUpdate(pp: any, ps: any) {
    // Move focus into a dialog or the assistant when it opens; closing returns it via refocus().
    if (ps && !ps.modal && this.state.modal) setTimeout(() => { const d: any = document.querySelector('[role=dialog]'); const f: any = d && (d.querySelector('input:not([disabled]),select,button:not([disabled])') || d); if (f) f.focus(); }, 0);
    if (ps && !ps.asst.open && this.state.asst.open) setTimeout(() => { const i: any = document.querySelector('[data-asst-panel] input'); if (i) i.focus(); }, 0);
    if (pp.live !== this.props.live && !this.state.replay) {
      const s = this.state; const n: any = this.wsData(s.ws);
      if (n.src === s.src && s.pol && n.pol.rev === s.pol.rev) delete n.polDraft;
      if (n.src === s.src && n.version === s.version && n.lead === s.lead) { delete n.planDraft; delete n.reserveDraft; }
      this.setState(n);
    }
    if (pp.judge !== this.props.judge) this.setWorkspace(this.props.judge ? 'demo' : 'live');
  }
  /** Ask FlowVault: POST /api/assistant (read-only). Suggested questions skip the model; typed ones may use it if the server has a key. */
  ask(text: any, typeOverride?: any) {
    const q = (text || '').trim(); if (!q) return;
    const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
    const a = this.state.asst;
    this.setState({ asst: { ...a, open: true, input: '', msgs: [...a.msgs, { role: 'user', text: q }, { role: 'ai', id, q, type: typeOverride || 'typed', pending: true }] } });
    const toEnd = () => setTimeout(() => { const el = document.querySelector('[data-asst-log]'); if (el) el.scrollTop = el.scrollHeight; }, 30);
    toEnd();
    if (!this.props.actions) return;
    const set = (patch: any) => { const x = this.state.asst; this.setState({ asst: { ...x, msgs: x.msgs.map((m: any) => (m.id === id ? { ...m, ...patch } : m)) } }, toEnd); };
    this.props.actions.ask(q, !typeOverride).then((r: any) => set({ pending: false, res: r })).catch((e: any) => set({ pending: false, err: e && e.message ? e.message : 'Ask failed.' }));
  }
  opExtra(o: any) {
    const SRC: any = ({ journal: ['JOURNAL', '#EEF0E8', '#4A5349'], example: ['EXAMPLE', '#F6EBDD', '#8A5F25'], session: ['THIS SESSION · SIMULATED WALLET', '#E7ECF3', '#3F5A7A'], replay: ['REPLAY', '#F6EBDD', '#8A5F25'] } as any)[o.src || 'example'];
    const pay = o.kind === 'Payout'; let phases: any = [];
    if (pay) {
      const g = ['#EEF0E8', '#4A5349'];
      const end = o.status === 'paid' ? ['SUCCESS', '#E2EAD6', '#3F6B3C'] : o.status === 'refunded' ? ['REFUNDED', '#F6EBDD', '#8A5F25'] : ['PROCESSING · NO UPDATE', '#F6E3DE', '#9A3F32'];
      const seq = [['PENDING_DEPOSIT', ...g], ['KNOWN_DEPOSIT_TX', ...g], ['PROCESSING', ...g]];
      const arr = o.status === 'stuck' ? [...seq.slice(0, 2), end] : [...seq, end];
      phases = arr.map((p: any, i: any) => ({ label: p[0], bg: p[1], color: p[2], arrow: i < arr.length - 1 ? '→' : '' }));
    }
    const f = FEES[o.chain] || NOFEE;
    const meta = pay ? [
      { k: 'Signed quote · kept for disputes', v: 'ed25519:3kR9…f9Qa' },
      { k: 'Quote echo check', v: 'amount, recipient, chain match' },
      { k: 'Refund deadline', v: o.status === 'paid' ? 'Not needed · delivered' : (o.refund || 'deposit + 60 min') },
      { k: 'Refund address', v: '' + ACC + '' },
      { k: 'Fees', v: num(f.fee) + ' USDC + 0.0008 NEAR' },
      { k: 'Journal', v: o.status === 'stuck' ? 'Server · resumes on reopen · do not pay again' : 'Server · safe to close' },
    ] : [
      { k: 'Verified by', v: o.kind === 'Supply' ? 'finalized receipt = prepared amount' : 'exact native-USDC payout event' },
      { k: 'Collateral', v: 'off' },
      { k: 'Policy checked', v: 'at prepare and at wallet handoff' },
      { k: 'Journal', v: 'Server · safe to close' },
    ];
    return { srcTag: SRC[0], srcBg: SRC[1], srcColor: SRC[2], hasPhases: pay, phases, meta };
  }
  toastMsg(msg: any) { this.setState({ toast: msg }); clearTimeout(this.tt); this.tt = setTimeout(() => this.setState({ toast: null }), 3400); }
  quote(ob: any) { const f = FEES[ob.chain] || NOFEE; const input = ob.amount + f.fee; return { ...f, input, deposit: input + f.buf }; }
  needFor(ob: any, wallet: any, reserve: any) { const q = this.quote(ob); return Math.max(0, Math.ceil((q.deposit - (wallet - reserve)) * 100) / 100); }
  payFinal(p: any) { if (p.step !== 'tracking') return null; if (p.outcome === 'success' && p.t >= 6) return 'paid'; if (p.outcome === 'refunded' && p.t >= 5) return 'refunded'; if (p.outcome === 'stuck' && p.t >= 5) return 'stuck'; return null; }
  opFinal(o: any) { return o && o.step === 'tracking' && o.t >= (o.kind === 'withdraw' ? 4 : 3); }
  tick() {
    // Progress always comes from the server (journal, payment plans); nothing is simulated locally.
    if (this.state.modal === 'pay') this.setState({ clock: Date.now() });
  }
  mkOp(kind: any, a: any) {
    const id = 'n' + Date.now();
    if (kind === 'supply') return { id, src: this.srcNow(), kind: 'Supply', title: 'Rhea Lending', amount: a, sub: 'Nov 12 · native USDC → Rhea · collateral off', status: 'confirmed', steps: this.opSteps({ kind, amount: a, t: 9 }), foot: 'Confirmed after finalized receipt matched the prepared amount. Safe to close.' };
    return { id, src: this.srcNow(), kind: 'Withdrawal', title: 'Rhea Lending', amount: a, sub: 'Nov 12 · Rhea → wallet', status: 'confirmed', steps: this.opSteps({ kind: 'withdraw', amount: a, t: 9 }), foot: 'Confirmed after the exact native-USDC payout event. Safe to close.' };
  }
  applyPay(p: any, fin: any) {
    const s = this.state; const ob = this.findOb(p.obId); const q = this.quote(ob);
    const obs = s.obs.map((o: any) => o.id === ob.id ? { ...o, status: fin === 'paid' ? 'paid' : fin === 'refunded' ? 'failed' : 'paying' } : o);
    const wallet = fin === 'paid' ? s.wallet - q.input : fin === 'stuck' ? s.wallet - q.deposit : s.wallet;
    const op: any = { id: 'p' + Date.now(), src: this.srcNow(), chain: ob.chain, asset: ob.asset, deposit: q.deposit, kind: 'Payout', title: ob.name, amount: ob.amount, sub: 'Nov 12 · ' + ob.chain + ' · to ' + short(ob.recipient), status: fin === 'paid' ? 'paid' : fin, steps: this.paySteps(ob, { ...p, t: 9 }), foot: fin === 'paid' ? 'Delivered and verified on ' + ob.chain + '. Buffer ' + num(q.buf) + ' USDC refunded to ' + ACC + '. Safe to close.' : fin === 'refunded' ? 'Not paid. ' + num(q.deposit) + ' USDC refunded to ' + ACC + '. You can re-quote safely.' : 'Status unknown. Deposit address 7a1f…e04c · refund address ' + ACC + '. Retry is disabled to prevent paying twice.' };
    const bump = fin === 'refunded' ? 0 : q.deposit;
    const intents = (s.intents || []).map((o: any) => o.id === ob.id ? { ...o, status: fin === 'paid' ? 'paid' : fin === 'refunded' ? 'failed' : 'paying' } : o);
    this.setState({ intents, pay: p, obs, wallet, ops: [op, ...s.ops], openOp: op.id, pol: { ...s.pol, used: s.pol.used + bump }, polDraft: { ...s.polDraft, used: s.polDraft.used + bump } });
  }
  paySteps(ob: any, p: any) {
    const q = this.quote(ob); const t = p.t; const o = p.outcome;
    const d = (n: any) => t >= n ? 'done' : 'pending';
    const rows = [
      S('Prepared', 'Quote 1C-' + ob.id + '7c · key pay_' + ob.id + '_v' + this.state.version + '_e21f', '18:31', '', 'done'),
      S('Approved in wallet', 'Signer ' + ACC + ' · MyNearWallet', '18:31', '', 'done'),
      S('Deposit submitted', num(q.deposit) + ' USDC to deposit 7a1f…e04c', t >= 1 ? '18:31' : '', t >= 1 ? '4kTz…9mQe ↗' : '', d(1)),
      S('Deposit finalized', 'Receipt SUCCESS · fee 0.0008 NEAR', t >= 2 ? '18:32' : '', t >= 2 ? '4kTz…9mQe ↗' : '', d(2)),
    ];
    if (o === 'success') {
      rows.push(S('Settled by 1Click', 'Status SUCCESS · exact output filled', t >= 4 ? '18:33' : '', '', d(4)));
      rows.push(S('Delivered · verified', num(ob.amount) + ' USDC to ' + short(ob.recipient) + ' on ' + ob.chain, t >= 6 ? '18:34' : '', t >= 6 ? '0x9be1…44a0 ↗' : '', d(6)));
    } else if (o === 'refunded') {
      rows.push(S(t >= 4 ? 'Swap failed' : 'Settled by 1Click', t >= 4 ? 'Solver could not fill · refund issued' : 'Waiting for 1Click status', t >= 4 ? '18:33' : '', '', t >= 4 ? 'fail' : 'pending'));
      rows.push(S('Refunded', num(q.deposit) + ' USDC to ' + ACC + '', t >= 5 ? '18:34' : '', t >= 5 ? '5pLm…Rw2a ↗' : '', t >= 5 ? 'warn' : 'pending'));
    } else {
      rows.push(S('Settlement status', t >= 5 ? 'Unknown for 6 min · last checked 18:37' : 'Waiting for 1Click status', '', '', t >= 5 ? 'warn' : 'pending'));
      rows.push(S('Delivered · verified', 'Not verified', '', '', 'pending'));
    }
    return rows;
  }
  opSteps(o: any) {
    const t = o.t; const d = (n: any) => t >= n ? 'done' : 'pending'; const a = num(parseFloat(o.amount) || 0);
    const rows = [
      S('Prepared', (o.kind === 'supply' ? 'ft_transfer_call' : 'execute · 1 yoctoNEAR') + ' · key ' + (o.kind === 'supply' ? 'sup' : 'wd') + '_v' + this.state.version + '_4a0c', '18:31', '', 'done'),
      S('Approved in wallet', 'Signer ' + ACC + '', '18:31', '', 'done'),
      S('Submitted', o.kind === 'supply' ? 'Holdback re-checked at submission' : 'No collateral, no debt on position', t >= 1 ? '18:31' : '', t >= 1 ? 'G7wE…p3Ku ↗' : '', d(1)),
      S('Finalized', 'Receipt SUCCESS · ' + (o.kind === 'supply' ? 'supplied ' : 'withdrew ') + a + ' USDC', t >= 2 ? '18:32' : '', t >= 2 ? 'G7wE…p3Ku ↗' : '', d(2)),
    ];
    if (o.kind !== 'supply') rows.push(S('Payout event verified', 'Exactly ' + a + ' native USDC to ' + ACC + '', t >= 4 ? '18:32' : '', t >= 4 ? 'G7wE…p3Ku ↗' : '', d(4)));
    return rows;
  }
  go(screen: any) { this.setState({ screen }); }
  openPay(id: any, x: any = {}) { this.remember(); const s = this.state; const ob = this.findOb(id); if (!ob) return; this.setState({ modal: 'pay', asst: { ...s.asst, open: false }, pay: { obId: id, step: 'confirm', t: 0, expires: 298, outcome: x.outcome || 'success', leg: null, plan: x.plan || null, need: x.need ?? this.needFor(ob, s.wallet, s.reserve), final: null } }); }
  openOp(kind: any, amount: any) { this.remember(); this.setState({ modal: 'op', asst: { ...this.state.asst, open: false }, op: { kind, amount: String(amount), step: 'review', t: 0, ack: false } }); }

  renderVals(): any {
    const s = this.state; const self = this;
    if (s.ws === 'live') LIVE_ACC = (this.props.live && this.props.live.workspace && this.props.live.workspace.accountId) || '';
    ACC = s.ws === 'demo' ? DEMO_ACC : LIVE_ACC;
    const empty = s.obs.length === 0 && s.reserve === 0;
    const total = s.wallet + s.rhea + (s.evm || 0);
    const live = s.obs.filter((o: any) => !['paid', 'cancelled'].includes(o.status));
    const inH = live.filter((o: any) => days(o.due) >= 0 && days(o.due) <= s.horizon && o.status !== 'failed' || (o.status === 'failed' && days(o.due) >= 0));
    const obsSum = inH.reduce((a: any, o: any) => a + o.amount, 0);
    // Live workspace without a snapshot yet shows reading states, never the design's example figures.
    const LV: any = this.apiSource() || this.pendingSource();
    const apiHold = LV && LV.obligations && LV.obligations.holdback != null ? Number(LV.obligations.holdback) : null;
    const holdback = apiHold ?? 0;
    const surplus = LV.strategies && LV.strategies.surplus != null ? Number(LV.strategies.surplus) : 0;
    const walletSurplus = Math.max(0, Math.floor((s.wallet - holdback) * 100 + 1e-6) / 100);
    const supplyMax = Math.max(0, Math.min(walletSurplus, s.pol.perAction, s.pol.daily - s.pol.used));
    const above = s.wallet - s.reserve;
    const sorted = [...inH].sort((a: any, b: any) => a.due.localeCompare(b.due));

    let cum = 0;
    const coverage: any = {}; sorted.forEach((o: any) => { cum += o.amount; coverage[o.id] = cum <= above; });
    const obRow = (o: any) => {
      const dd = days(o.due); const paid = o.status === 'paid';
      const key = paid ? 'paid' : o.status === 'failed' ? 'failed' : o.status === 'paying' ? 'paying' : dd > s.horizon ? 'later' : dd <= s.lead ? 'soon' : 'upcoming';
      const urgent = key === 'soon' || key === 'failed';
      const canPay = !paid && o.status !== 'paying';
      return { id: o.id, name: o.name, chain: o.chain, asset: AS(o), note: o.note || '', recipientShort: short(o.recipient), amountF: num(o.amount) + ' ' + AS(o),
        dueLabel: dlabel(o.due), mon: MON[new Date(o.due + 'T00:00:00Z').getUTCMonth()].toUpperCase(), day: new Date(o.due + 'T00:00:00Z').getUTCDate(),
        inDays: paid ? 'paid' : dd === 0 ? 'today' : dd === -1 ? '1 day ago' : dd < 0 ? Math.abs(dd) + ' days ago' : dd === 1 ? 'tomorrow' : 'in ' + dd + ' days',
        stLabel: ST[key][0], stBg: ST[key][1], stColor: ST[key][2],
        btnLabel: paid ? 'Receipt' : o.status === 'paying' ? 'Check status' : o.status === 'failed' ? 'Pay again' : 'Pay', btnBg: urgent && canPay ? '#2A4034' : '#fff', btnColor: urgent && canPay ? '#fff' : '#1E2A22', btnBorder: urgent && canPay ? 'none' : '1px solid #DDE1D4',
        onPay: () => paid || o.status === 'paying' ? (self.setState({ screen: 'activity' })) : self.openPay(o.id) };
    };
    const upcoming = sorted.map(obRow);
    const strip = sorted.map((o: any, i: any) => ({ labelTop: i % 2 ? '-14px' : '0px', dotTop: i % 2 ? '25px' : '11px', left: Math.min(97, Math.max(3, days(o.due) / s.horizon * 100)) + '%', amount: '$' + o.amount.toLocaleString() + ' · ' + dlabel(o.due), dot: coverage[o.id] ? '#4E7A4A' : '#C08A45', color: coverage[o.id] ? '#3F6B3C' : '#8A5F25' }));

    // recommendation
    let rec: any;
    const soon = sorted.find((o: any) => days(o.due) <= s.lead && o.status !== 'paying');
    if (s.wallet === 0 && s.rhea === 0) rec = { tag: 'FUND', title: 'Add ' + num(holdback) + ' USDC to cover your plan.', body: 'Your reserve and payments in the next ' + s.horizon + ' days need ' + usd(holdback) + '. Send native USDC on NEAR to ' + ACC + '; FlowVault reads it, it never holds it.', cta: 'Review your calendar', onClick: () => self.go('calendar') };
    else if (soon) {
      const need = this.needFor(soon, s.wallet, s.reserve);
      rec = need > 0
        ? { tag: 'DUE IN ' + days(soon.due) + ' DAYS', title: 'Withdraw ' + num(need) + ' USDC from Rhea, then pay ' + soon.name + '.', body: soon.name + ' (' + num(soon.amount) + ' USDC on ' + soon.chain + ') is due ' + dlabel(soon.due) + '. Your wallet holds ' + num(Math.max(0, above)) + ' above the reserve. The withdrawal is its own approval and is verified before the payout.', cta: 'Withdraw, then pay', onClick: () => self.openPay(soon.id) }
        : { tag: 'DUE IN ' + days(soon.due) + ' DAYS', title: 'Pay ' + soon.name + ': ' + num(soon.amount) + ' USDC on ' + soon.chain + '.', body: 'Due ' + dlabel(soon.due) + '. Your wallet covers it above the ' + usd(s.reserve) + ' reserve. You’ll see a live exact-output quote before anything moves.', cta: 'Pay ' + soon.name, onClick: () => self.openPay(soon.id) };
    } else if (s.wallet < holdback) rec = { tag: 'RESTORE', title: 'Withdraw ' + num(holdback - s.wallet) + ' USDC to restore your holdback.', body: 'Payments in your horizon need more in the wallet than it holds.', cta: 'Withdraw USDC', onClick: () => self.openOp('withdraw', (holdback - s.wallet).toFixed(2)) };
    else if (walletSurplus > 1) rec = { tag: 'SURPLUS', title: 'Supply ' + num(supplyMax) + ' USDC surplus to Rhea.', body: 'Everything due is covered.' + (supplyMax < walletSurplus ? ' Capped by your policy limits.' : ''), cta: 'Review supply', onClick: () => self.openOp('supply', supplyMax.toFixed(2)) };
    else rec = { tag: 'ALL SET', title: 'Nothing to do. Your calendar is covered.', body: 'Holdback is in your wallet and the surplus is working.', cta: 'Open calendar', onClick: () => self.go('calendar') };
    rec.tagBg = rec.tag.startsWith('DUE') ? '#C9E86B' : 'rgba(255,255,255,.1)'; rec.tagColor = rec.tag.startsWith('DUE') ? '#1E2A22' : '#C9D6C1';

    const metrics = [
      { label: 'Cash', value: usd(s.wallet + s.evm), sub: 'NEAR wallet ' + usd(s.wallet) + ' · Base, Arbitrum ' + usd(s.evm), dot: '#D8B98F', border: 'none' },
      { label: 'In Rhea Lending', value: usd(s.rhea), sub: '10.30% variable · collateral off', dot: '#4E7A4A', border: '1px solid #EEF0E8' },
      { label: 'Holdback', value: usd(holdback), sub: 'reserve ' + usd(s.reserve) + ' + ' + inH.length + ' payments', dot: '#9DB48C', border: '1px solid #EEF0E8' },
      { label: 'Surplus', value: usd(surplus), sub: walletSurplus > 0 ? usd(walletSurplus) + ' idle in wallet' : 'all surplus is working', dot: '#4E7A4A', border: '1px solid #EEF0E8' },
    ];
    const pct = (x: any) => total > 0 ? Math.min(100, x / Math.max(total, holdback) * 100) + '%' : '0%';
    const bar: any = { reserve: pct(s.reserve), obs: pct(obsSum), surplus: pct(surplus) };

    const positions = empty || total === 0 ? [] : [
      { icon: '$', iconBg: '#E2EAD6', iconColor: '#3F6B3C', name: 'Wallet USDC', sub: '' + ACC + '', balance: usd(s.wallet), exit: 'Available now · holds your holdback', action: 'Supply surplus', onAction: () => self.openOp('supply', supplyMax.toFixed(2)) },
      { icon: '$', iconBg: '#E2EAD6', iconColor: '#3F6B3C', name: 'Rhea Lending', sub: 'USDC supply · 10.30% variable', balance: usd(s.rhea), exit: 'Withdrawable now, liquidity-dependent · timing unverified', action: 'Withdraw', onAction: () => self.openOp('withdraw', Math.min(s.rhea, 1000).toFixed(2)) },
      { icon: 'N', iconBg: '#ECE8F4', iconColor: '#6B5E99', name: 'NEAR', sub: 'gas and storage', balance: '42.10 NEAR', exit: 'Not part of the USDC plan', action: 'Gas and fees only', isLabel: true, onAction: () => {} },
    ].map((p: any) => ({ ...p, isBtn: !p.isLabel, isLabel: !!p.isLabel }));

    // calendar groups
    const later = live.filter((o: any) => days(o.due) > s.horizon).map(obRow);
    const paidL = s.obs.filter((o: any) => o.status === 'paid').map(obRow);
    const obGroups: any = [];
    if (upcoming.length) obGroups.push({ title: 'Payments due in ' + s.horizon + ' days', sub: usd(obsSum) + ' · holdback = reserve ' + usd(s.reserve) + ' + payments = ' + usd(holdback), items: upcoming });
    if (later.length) obGroups.push({ title: 'Later', sub: 'not held back yet', items: later });
    if (paidL.length) obGroups.push({ title: 'Paid', sub: 'delivery verified', items: paidL });

    const pd = s.planDraft;
    const hbDraftObs = live.filter((o: any) => days(o.due) >= 0 && days(o.due) <= +pd.horizon);
    const holdbackDraft = (parseFloat(pd.reserve) || 0) + hbDraftObs.reduce((a: any, o: any) => a + o.amount, 0);
    const planClean = +pd.reserve === s.reserve && +pd.horizon === s.horizon && +pd.lead === s.lead;
    const setPd = (k: any) => (e: any) => self.setState({ planDraft: { ...s.planDraft, [k]: e.target.value } });

    // strategies
    const cmpOb = s.obs.find((o: any) => o.id === s.compareTo) || sorted[0] || { due: '2026-12-01', chain: 'NEAR' };
    const cmpDays = Math.max(1, days(cmpOb.due));
    const cmpStr = s.cmpAmount ?? supplyMax.toFixed(2); const amt = parseFloat(cmpStr) || 0;
    const earn = (apr: any) => amt * apr / 100 * cmpDays / 365;
    const rtc = (FEES[cmpOb.chain] || NOFEE).fee;
    const rheaNet = earn(10.30) - rtc - 0.01;
    const vaultExitOk = days(cmpOb.due) >= 18;
    const vaultOk = false;
    const vaultNet = earn(14.20) - rtc - 0.05;
    const strat = [
      { key: 'rhea', ok: true, net: rheaNet, icon: '$', iconBg: '#E2EAD6', iconColor: '#3F6B3C', name: 'Rhea Lending', kind: 'USDC · lending · approved venue',
        rows: [{ k: 'Earnings at 10.30% · ' + cmpDays + 'd', v: '+' + usd(earn(10.30)), color: '#1E2A22' }, { k: 'Return-to-cash to ' + cmpOb.chain, v: '−' + usd(rtc), color: '#8A5F25' }, { k: 'Withdrawal network cost', v: '−$0.01', color: '#8A5F25' }],
        notes: [{ glyph: '◷', text: 'Withdrawable now, liquidity-dependent', color: '#5B6458' }, { glyph: '⚠', text: 'Withdrawal timing is unverified', color: '#8A5F25' }],
        cta: 'Review supply', onClick: () => self.openOp('supply', (Math.floor(Math.min(amt, supplyMax) * 100) / 100).toFixed(2)) },
      { key: 'vault', ok: vaultOk, net: vaultNet, icon: '$', iconBg: '#E2EAD6', iconColor: '#3F6B3C', name: 'USDC vault', kind: 'USDC · vault · example rate, not verified',
        rows: [{ k: 'Earnings at 14.20% · ' + cmpDays + 'd', v: '+' + usd(earn(14.20)), color: '#1E2A22' }, { k: 'Return-to-cash to ' + cmpOb.chain, v: '−' + usd(rtc), color: '#8A5F25' }, { k: 'Redemption network cost', v: '−$0.05', color: '#8A5F25' }],
        notes: [{ glyph: '◷', text: 'Next redemption window opens Nov 28', color: '#5B6458' }, { glyph: '⚠', text: 'Not an approved venue · rate unverified', color: '#8A5F25' }],
        why: vaultExitOk ? 'Would net ' + usd(vaultNet) + ', but not an approved venue' : 'Exit window misses ' + dlabel(cmpOb.due), cta: 'Not in your approved venues', onClick: () => {} },
      { key: 'linear', ok: false, net: 0, icon: 'N', iconBg: '#ECE8F4', iconColor: '#6B5E99', name: 'LiNEAR', kind: 'NEAR asset family',
        rows: [{ k: 'Return assumed', v: 'none', color: '#8A9285' }],
        notes: [{ glyph: '⚠', text: 'NEAR exposure does not match this USDC plan', color: '#8A5F25' }],
        why: 'Outside your USDC mandate', cta: 'Kept separate', onClick: () => {} },
    ];
    const rank = strat.filter((x: any) => x.ok).sort((a: any, b: any) => b.net - a.net);
    const ordered = [...rank, ...strat.filter((x: any) => !x.ok)];
    const strategies = ordered.map((x: any) => {
      const r = rank.indexOf(x);
      const isTop = r === 0; const disabled = x.key !== 'rhea';
      return { ...x, net: x.ok ? (x.net >= 0 ? '+' : '') + usd(x.net) : '—', netColor: x.ok ? '#1E2A22' : '#8A9285',
        netSub: x.ok ? 'scenario · rate held constant · ' + cmpDays + ' days' : x.why,
        tag: x.ok ? (isTop ? 'BEST FIT #1' : 'FITS #' + (r + 1)) : 'INELIGIBLE', tagBg: x.ok ? (isTop ? '#C9E86B' : '#EEF0E8') : '#F6EBDD', tagColor: x.ok ? '#1E2A22' : '#8A5F25',
        border: isTop ? '#9DB48C' : '#E3E6DB', opacity: x.ok ? 1 : 0.85, disabled,
        btnBg: disabled ? '#F4F5EF' : '#2A4034', btnColor: disabled ? '#8A9285' : '#fff', btnBorder: disabled ? '1px solid #E3E6DB' : 'none' };
    });
    const cmpTabs = sorted.filter((o: any) => days(o.due) > 0).slice(0, 4).map((o: any) => ({ label: o.name.split(' ')[0] + ' · ' + dlabel(o.due), bg: o.id === cmpOb.id ? '#fff' : 'transparent', shadow: o.id === cmpOb.id ? '0 1px 3px rgba(0,0,0,.08)' : 'none', onClick: () => self.setState({ compareTo: o.id }) }));

    // activity
    const kindIcon: any = { Payout: ['↗', '#E7ECF3', '#3F5A7A'], Supply: ['↑', '#E2EAD6', '#3F6B3C'], Withdrawal: ['↙', '#F6EBDD', '#8A5F25'] };
    const ops = s.ops.map((o: any) => {
      const st = ST[o.status] || ST.progress; const ic = kindIcon[o.kind]; const open = s.openOp === o.id;
      return { ...o, ...self.opExtra(o), amountF: num(o.amount) + ' ' + AS(o), stLabel: st[0], stBg: st[1], stColor: st[2], icon: ic[0], iconBg: ic[1], iconColor: ic[2], isOpen: open, chev: open ? '▴' : '▾',
        steps: deco(o.steps), footBg: o.status === 'stuck' ? '#F6E3DE' : o.status === 'refunded' ? '#F6EBDD' : '#F4F5EF', footColor: o.status === 'stuck' ? '#7F3528' : o.status === 'refunded' ? '#7A521E' : '#5B6458',
        onToggle: () => self.setState({ openOp: open ? null : o.id }) };
    });
    const legend = [['Example', '#fff', '#8A5F25', '#EBD9BF'], ['Dry quote', '#fff', '#5B6458', '#DDE1D4'], ['Prepared', '#E7ECF3', '#3F5A7A', '#E7ECF3'], ['Submitted', '#fff', '#3F5A7A', '#C9D5E4'], ['Finalized', '#fff', '#3F6B3C', '#C9D9BF'], ['Confirmed', '#E2EAD6', '#3F6B3C', '#E2EAD6']].map(([label, bg, color, border]: any) => ({ label, bg, color, border }));

    // modal
    let m: any = { eyebrow: '', title: '', hasSteps: false, steps: [] };
    const mkSteps = (labels: any, i: any) => labels.map((label: any, k: any) => ({ label, bar: k <= i ? '#4E7A4A' : '#E3E6DB', color: k <= i ? '#1E2A22' : '#8A9285', weight: k === i ? 600 : 400 }));
    let wallet: any = { show: false, rows: [] };
    let pv: any = { summary: [], legs: [], quoteRows: [], track: [], recovery: [] };
    let opv: any = { payload: [], track: [] };
    const pay = s.pay; const payOb = pay && this.findOb(pay.obId);

    if (s.modal === 'confirm' && s.confirm) m = { eyebrow: 'POLICY · PROTECTED ASSET', title: s.confirm.title, hasSteps: false, steps: [] };
    if (s.modal === 'intent') m = { eyebrow: 'PAY OR MOVE MONEY', title: 'State the outcome', hasSteps: false, steps: [] };
    if (s.modal === 'add') m = { eyebrow: 'NEW DATED PAYMENT', title: 'Add a payment to your plan', hasSteps: false, steps: [] };

    if (s.modal === 'op' && s.op) {
      const o = s.op; const sup = o.kind === 'supply'; const a = parseFloat(o.amount) || 0;
      const idx: any = ({ review: 0, prepared: 1, wallet: 2, tracking: 3 } as any)[o.step];
      m = { eyebrow: sup ? 'SUPPLY · RHEA LENDING' : 'WITHDRAW · RHEA LENDING', title: sup ? 'Supply USDC, exit first' : 'Withdraw USDC to your wallet', hasSteps: true, steps: mkSteps(['Review', 'Prepare', 'Approve', 'Verify'], idx) };
      const max = sup ? supplyMax : s.rhea; const cents = (x: any) => Math.round(x * 100);
      const breach = sup && cents(a) > cents(walletSurplus);
      const over = !sup && cents(a) > cents(s.rhea);
      const P0 = s.pol; const polBad = sup ? (a > P0.perAction ? 'over your ' + usd(P0.perAction) + ' per-action cap' : P0.used + a > P0.daily ? 'over your ' + usd(P0.daily) + ' daily cap (' + usd(P0.used) + ' used today)' : '') : '';
      const ok = a > 0 && !breach && !over && !polBad && o.ack;
      opv = {
        amountLabel: sup ? 'Amount to supply' : 'Amount to withdraw', maxF: num(max),
        check: polBad ? 'Refused by policy rev ' + P0.rev + ': ' + polBad + (breach ? ', and it would cut into your ' + usd(holdback) + ' holdback' : '') + '.' : sup ? (breach ? 'Refused: this leaves ' + usd(s.wallet - a) + ' in wallet, below your ' + usd(holdback) + ' holdback. Max ' + usd(walletSurplus) + '.' : 'Leaves ' + usd(s.wallet - a) + ' in wallet · holdback ' + usd(holdback) + ' stays covered.') : (over ? 'More than your Rhea supply of ' + usd(s.rhea) + '.' : 'Wallet after: ' + usd(s.wallet + a) + ' · holdback ' + usd(holdback)),
        checkColor: breach || over || polBad ? '#9A3F32' : '#3F6B3C', amtBorder: breach || over || polBad ? '#E0B4A8' : '#DDE1D4',
        netLine: 'Scenario: ' + usd(a) + ' at 10.30% to ' + dlabel(cmpOb.due) + ' (' + cmpDays + ' days) nets ' + usd(a * 0.103 * cmpDays / 365 - rtc - 0.01) + ' after the return-to-cash cost. Not a forecast.',
        blocked: !ok, prepBg: ok ? '#2A4034' : '#B9C0B2', prepLabel: sup ? 'Prepare supply' : 'Prepare withdrawal',
        payload: [{ k: 'Contract', v: sup ? 'usdc.near → contract.main.burrow.near' : 'contract.main.burrow.near' }, { k: 'Method', v: sup ? 'ft_transfer_call' : 'execute (1 yoctoNEAR)' }, { k: 'Amount', v: num(a) + ' USDC' }, { k: 'Collateral', v: 'off' }, { k: 'Plan version', v: 'v' + s.version }, { k: 'Expires', v: '18:41 (10 min)' }, { k: 'Idempotency key', v: (sup ? 'sup' : 'wd') + '_v' + s.version + '_4a0c' }],
        track: deco(this.opSteps(o)), prepTime: 'Fresh preflight passed at 18:31:04',
      };
      const done = this.opFinal(o);
      opv.finBg = done ? '#E2EAD6' : '#F4F5EF'; opv.finColor = done ? '#2F552D' : '#5B6458';
      opv.finText = done ? (sup ? 'Confirmed. ' + num(a) + ' USDC supplied to Rhea with collateral off. Your reserve can never be liquidated.' : 'Confirmed. Exactly ' + num(a) + ' native USDC arrived in ' + ACC + '.') : 'Safe to close. Tracking continues in Activity with the cached hash.';
      opv.closeLabel = done ? 'Done' : 'Close';
      if (o.step === 'wallet') wallet = { show: true, action: (sup ? 'Supply ' : 'Withdraw ') + num(a) + ' USDC', rows: [{ k: 'Receiver', v: 'contract.main.burrow.near' }, { k: 'Method', v: sup ? 'ft_transfer_call' : 'execute' }, { k: 'Deposit', v: sup ? '1 yoctoNEAR' : '1 yoctoNEAR' }, { k: 'Network fee', v: '≈ 0.0011 NEAR' }],
        onReject: () => self.setState({ op: { ...o, step: 'prepared' } }), onApprove: () => self.setState({ op: { ...o, step: 'tracking', t: 0 } }) };
    }

    if (s.modal === 'pay' && pay && payOb) {
      const q = this.quote(payOb); const fin = pay.final || this.payFinal(pay);
      const idx: any = ({ confirm: 0, sources: 1, quote: 2, wallet: 3, tracking: 4 } as any)[pay.step];
      m = { eyebrow: 'PAY ON THE DATE · DUE ' + dlabel(payOb.due).toUpperCase(), title: 'Pay ' + payOb.name, hasSteps: true, steps: mkSteps(['Confirm', 'Sources', 'Quote', 'Approve', 'Deliver'], idx) };
      const needLeg = pay.need > 0;
      const legDone = pay.leg === 'done';
      const expired = pay.expires <= 0;
      const mm = Math.floor(pay.expires / 60), ss = String(pay.expires % 60).padStart(2, '0');
      pv = {
        quoteTag: s.replay ? 'RECORDED QUOTE · EXACT OUTPUT' : 'LIVE QUOTE · EXACT OUTPUT', quoteSrc: s.replay ? 'Recorded 1Click response · not a live quote' : 'NEAR Intents 1Click · fetched 18:31:02',
        amountF: num(payOb.amount) + ' ' + AS(payOb), depositF: num(q.deposit) + ' USDC',
        summary: [{ k: 'Recipient', v: payOb.recipient, font: "'DM Mono',monospace" }, { k: 'Chain', v: payOb.chain, font: 'inherit' }, { k: 'Asset', v: AS(payOb) + (AS(payOb) !== 'USDC' ? ' · swapped from your USDC' : ''), font: 'inherit' }, { k: 'Recipient receives', v: num(payOb.amount) + ' ' + AS(payOb) + ' (net)', font: 'inherit' }, { k: 'Policy rev ' + s.pol.rev, v: q.deposit <= s.pol.perAction && s.pol.used + q.deposit <= s.pol.daily ? 'Within per-action and daily caps' : 'Over a cap · will be refused at prepare', font: 'inherit' }, { k: 'Due', v: dlabel(payOb.due) + ', 2026 · in ' + days(payOb.due) + ' days', font: 'inherit' }],
        legs: [
          { title: 'Wallet USDC above reserve', sub: '' + ACC + ' · ' + usd(Math.max(0, s.wallet - s.reserve)) + ' available after keeping ' + usd(s.reserve), amount: num(Math.min(q.deposit, Math.max(0, s.wallet - s.reserve))), glyph: '1', dotBg: '#4E7A4A', border: '#E3E6DB', bg: '#fff' },
        ],
        reserveAfter: usd(s.reserve) + ' untouched',
        sourcesNote: needLeg && !legDone ? 'The withdrawal is a separate approval. It must be verified in your wallet before a payout quote is requested.' : 'Next, FlowVault requests a live exact-output quote. That creates a deposit address but moves nothing until you approve.',
        sourcesCta: needLeg && pay.leg === 'verifying' ? 'Verifying withdrawal…' : needLeg && !legDone ? 'Approve withdrawal of ' + num(pay.need) + ' USDC' : 'Get a live quote →',
        sourcesAction: needLeg && pay.leg === 'verifying' ? () => {} : needLeg && !legDone ? () => self.setState({ pay: { ...pay, leg: 'wallet' } }) : () => self.setState({ pay: { ...pay, step: 'quote', expires: pay.outcome === 'expired' ? 8 : 298 } }),
        expired, expLabel: expired ? 'Expired' : 'Expires in ' + mm + ':' + ss, expColor: expired ? '#9A3F32' : pay.expires < 30 ? '#8A5F25' : '#3F6B3C', quoteOpacity: expired ? 0.5 : 1,
        quoteRows: [{ k: 'Input amount', v: num(q.input) + ' USDC', color: '#1E2A22' }, { k: 'Non-refundable fees', v: num(q.fee) + ' USDC', color: '#8A5F25' }, { k: 'Refundable buffer', v: num(q.buf) + ' USDC · returned if unused', color: '#3F6B3C' }, { k: 'Deposit address', v: s.replay ? '7a1fc0e4…b9d2e04c · recorded, not live' : '7a1fc0e4…b9d2e04c', color: '#1E2A22' }, { k: 'Refund address', v: '' + ACC + '', color: '#1E2A22' }, { k: 'Estimated delivery', v: q.time + ' on ' + payOb.chain, color: '#1E2A22' }],
        quoteCta: expired ? 'Get a new quote' : 'Approve deposit in wallet →',
        quoteAction: expired ? () => self.setState({ pay: { ...pay, expires: 298, outcome: 'success' } }) : () => self.setState({ pay: { ...pay, step: 'wallet' } }),
        track: deco(this.paySteps(payOb, pay)), isStuck: fin === 'stuck',
        recovery: [{ k: 'Deposit address', v: '7a1fc0e4…b9d2e04c' }, { k: 'Deposit tx', v: '4kTz…9mQe ↗' }, { k: 'Refund address', v: '' + ACC + '' }, { k: '1Click status', v: 'UNKNOWN · 18:37' }],
      };
      if (needLeg) pv.legs.push({ title: legDone ? 'Rhea withdrawal · verified' : 'Rhea withdrawal leg', sub: legDone ? 'Payout event verified · native USDC in wallet' : 'Separate approval · verified before payout · collateral off', amount: num(pay.need), glyph: legDone ? '✓' : '2', dotBg: legDone ? '#4E7A4A' : '#C08A45', border: legDone ? '#E3E6DB' : '#EBD9BF', bg: legDone ? '#fff' : '#FBF6EE' });
      pv.finBg = fin === 'paid' ? '#E2EAD6' : fin === 'refunded' ? '#F6EBDD' : '#F4F5EF';
      pv.finColor = fin === 'paid' ? '#2F552D' : fin === 'refunded' ? '#7A521E' : '#5B6458';
      pv.finText = fin === 'paid' ? 'Paid and verified. ' + num(payOb.amount) + ' USDC reached ' + short(payOb.recipient) + ' on ' + payOb.chain + '. Unused buffer of ' + num(q.buf) + ' USDC returned to your wallet.' : fin === 'refunded' ? 'Not paid. The swap failed and ' + num(q.deposit) + ' USDC was refunded to ' + ACC + '. ' + payOb.name + ' stays in your holdback; you can re-quote.' : fin === 'stuck' ? 'Not marked paid. FlowVault keeps checking; recovery details are saved in Activity.' : 'Safe to close. FlowVault keeps tracking the deposit address; the payment is marked paid only after delivery is verified on ' + payOb.chain + '.';
      pv.finCta = fin === 'refunded' ? 'Re-quote safely' : fin ? 'Done' : 'Close';
      pv.finAction = fin === 'refunded' ? () => self.openPay(payOb.id) : () => self.endModal();
      if (pay.step === 'wallet') wallet = { show: true, action: 'Send ' + num(q.deposit) + ' USDC', rows: [{ k: 'To deposit address', v: '7a1fc0e4…b9d2e04c' }, { k: 'Method', v: 'ft_transfer · usdc.near' }, { k: 'Refund address', v: '' + ACC + '' }, { k: 'Quote expires', v: Math.floor(pay.expires / 60) + ':' + String(pay.expires % 60).padStart(2, '0') }],
        onReject: () => self.setState({ pay: { ...pay, step: 'quote' } }), onApprove: () => self.setState({ pay: { ...pay, step: 'tracking', t: 0 } }) };
      if (pay.leg === 'wallet') wallet = { show: true, action: 'Withdraw ' + num(pay.need) + ' USDC from Rhea', rows: [{ k: 'Receiver', v: 'contract.main.burrow.near' }, { k: 'Method', v: 'execute · 1 yoctoNEAR' }, { k: 'Arrives as', v: 'native USDC → ' + ACC + '' }, { k: 'Network fee', v: '≈ 0.0009 NEAR' }],
        onReject: () => self.setState({ pay: { ...pay, leg: null } }), onApprove: () => self.setState({ pay: { ...pay, leg: 'verifying', legT: 0 } }) };
    }

    // add form
    const f = s.form; const evm = f.chain !== 'NEAR'; const r = f.recipient.trim();
    const zero = /^0x0{40}$/.test(r) || /recipient|placeholder|^0x\.*$/i.test(r);
    const addrValid = r && !zero && (evm ? isEvm(r) : isNear(r));
    const addrMsg = !r ? (evm ? 'EVM address on ' + f.chain + ': 0x + 40 hex characters.' : 'NEAR account (name.near) or 64-character implicit account.') : zero ? 'Rejected: placeholder or zero address.' : addrValid ? 'Valid ' + f.chain + ' address format.' : 'Doesn’t match the ' + f.chain + ' address format.';
    const fAmt = parseFloat(f.amount) || 0;
    const dueIn = f.due ? days(f.due) : -1;
    const formInvalid = !(f.name.trim() && fAmt > 0 && addrValid && f.confirmed && dueIn >= 0);
    const inHz = dueIn >= 0 && dueIn <= s.horizon;
    const impact = !fAmt ? { text: 'Holdback is ' + usd(holdback) + ' today. Payments due within ' + s.horizon + ' days are kept out of any strategy.', bg: '#F4F5EF', color: '#5B6458' }
      : inHz ? (holdback + fAmt > total ? { text: 'Holdback rises to ' + usd(holdback + fAmt) + ', more than the ' + usd(total) + ' you hold. FlowVault will recommend adding USDC.', bg: '#F6EBDD', color: '#7A521E' } : { text: 'Holdback rises from ' + usd(holdback) + ' to ' + usd(holdback + fAmt) + '. Surplus falls to ' + usd(Math.max(0, total - holdback - fAmt)) + '.', bg: '#E9EEDF', color: '#2F552D' })
      : { text: 'Due outside your ' + s.horizon + '-day horizon. It joins the holdback as the date approaches.', bg: '#F4F5EF', color: '#5B6458' };
    const setF = (k: any) => (e: any) => self.setState({ form: { ...s.form, [k]: k === 'confirmed' ? e.target.checked : e.target.value, ...(k === 'recipient' || k === 'chain' ? { confirmed: false } : {}) } });

    // portfolio & credit
    const c = s.credit; const value = 2000; const stressed = value * (1 - c.dd / 100);
    const policy = stressed * c.cap / 100; const health = stressed * 0.8 / (c.hp / 10);
    const capRaw = Math.min(policy, health) - c.debt; const binding = policy <= health ? 'your ' + c.cap + '% LTV cap' : 'minimum stressed health ' + (c.hp / 10).toFixed(1);
    const setC = (k: any) => (e: any) => self.setState({ credit: { ...s.credit, [k]: +e.target.value } });
    const credit: any = { capF: usd(Math.max(0, capRaw)), binding, rows: [
      { k: 'Stressed value at −' + c.dd + '%', v: usd(stressed), kc: '#5B6458', w: 400 },
      { k: 'Policy ceiling (' + c.cap + '% cap)', v: usd(policy), kc: policy <= health ? '#1E2A22' : '#5B6458', w: policy <= health ? 600 : 400 },
      { k: 'Health cap (80% LT ÷ ' + (c.hp / 10).toFixed(1) + ')', v: usd(health), kc: health < policy ? '#1E2A22' : '#5B6458', w: health < policy ? 600 : 400 },
      { k: 'Existing debt', v: '−' + usd(c.debt), kc: '#5B6458', w: 400 }] };
    const sliders = [
      { label: 'Drawdown scenario', display: '−' + c.dd + '%', min: 10, max: 95, step: 5, value: c.dd, onChange: setC('dd'), hint: 'How far the price could fall before you’d need to act.' },
      { label: 'Your LTV cap', display: c.cap + '%', min: 10, max: 80, step: 5, value: c.cap, onChange: setC('cap'), hint: 'Protocol allows up to 80% liquidation threshold.' },
      { label: 'Minimum stressed health', display: (c.hp / 10).toFixed(1), min: 11, max: 30, step: 1, value: c.hp, onChange: setC('hp'), hint: 'Health factor that must hold even after the drawdown.' },
      { label: 'Existing debt', display: usd(c.debt), min: 0, max: 100, step: 10, value: c.debt, onChange: setC('debt'), hint: 'Deducted from capacity, including accrued interest.' },
    ];
    const ethA = s.pol.assets.eth; const ethPledge = ethA.uses.includes('pledge');
    if (!ethPledge) { credit.capF = '$0.00'; credit.binding = 'ETH may not be borrowed against under policy rev ' + s.pol.rev; }
    credit.blocked = !ethPledge;
    const creditUses = [['hold', 'Hold'], ['sell', 'Sell'], ['pledge', 'Borrow against'], ['fees', 'Use for fees']].map(([u, l]: any) => { const on = ethA.uses.includes(u); return { label: (on ? '✓ ' : '') + l, bg: on ? '#E2EAD6' : '#fff', color: on ? '#3F6B3C' : '#8A9285', border: on ? '#E2EAD6' : '#E3E6DB' }; });
    const creditPrio = ethA.p + ' · from Policy';

    // ===== five-layer additions
    const judge = !!s.judge; const P = s.pol; const D = s.polDraft; const NP = 3.2;
    const L = s.vw < 640 ? 'm' : s.vw < 1024 ? 'r' : 'f';
    const hpv = c.hp / 10;
    const ST_A = [
      { k: 'eth', name: 'ETH', chain: 'Arbitrum', venue: 'Aave v3 · Arbitrum', usd: 2000, lt: 0.8 },
      { k: 'linear', name: 'LiNEAR', chain: 'NEAR', venue: 'Rhea Lending', usd: 64.8 * NP, lt: 0.6 },
      { k: 'rnear', name: 'rNEAR', chain: 'NEAR', venue: 'Rhea Lending', usd: 26.5 * NP, lt: 0.55 },
      { k: 'near', name: 'NEAR', chain: 'NEAR', venue: 'Rhea Lending', usd: 42.1 * NP, lt: 0.65 },
      { k: 'staked', name: 'Staked NEAR', chain: 'NEAR', venue: 'No supported venue', usd: 120 * NP, lt: 0, unsupported: 'Unsupported: no venue accepts natively staked NEAR' },
      { k: 'usdc', name: 'USDC · Rhea supply', chain: 'NEAR', venue: 'Rhea Lending', usd: s.rhea, lt: 0.9, unsupported: 'Collateral stays off so your reserve can’t be liquidated' },
    ];
    let stCum = 0, stLT = 0, stSLT = 0;
    const stRows = ST_A.map((a: any) => {
      const cfg = a.k === 'eth' ? { on: s.stress.eth.on, dd: c.dd, cap: c.cap } : (s.stress[a.k] || { on: false, dd: 60, cap: 50 });
      const allowed = !!(P.assets[a.k] && P.assets[a.k].uses.includes('pledge'));
      const stv = a.usd * (1 - cfg.dd / 100); const pc = stv * cfg.cap / 100; const hc = stv * a.lt / hpv; const debt = a.k === 'eth' ? c.debt : 0;
      const eligible = !a.unsupported && allowed;
      const cap = eligible ? Math.max(0, Math.min(pc, hc) - debt) : 0;
      if (eligible && cfg.on) { stCum += cap; stLT += a.usd * a.lt; stSLT += stv * a.lt; }
      const binding = a.unsupported ? a.unsupported : !allowed ? 'Not allowed as collateral in policy rev ' + P.rev : pc <= hc ? 'Your ' + cfg.cap + '% LTV cap' : 'Minimum health ' + hpv.toFixed(1);
      const setS = (key: any, val: any) => a.k === 'eth' ? self.setState(key === 'on' ? { stress: { ...s.stress, eth: { on: val } } } : { credit: { ...s.credit, [key]: val } }) : self.setState({ stress: { ...s.stress, [a.k]: { ...cfg, [key]: val } } });
      return { name: a.name, chain: a.chain, venue: a.venue, valueF: usd(a.usd), on: eligible && cfg.on, dis: !eligible, dd: String(cfg.dd), cap: String(cfg.cap), capF: usd(cap), binding, bindColor: eligible ? '#4A5349' : '#8A5F25', canAllow: !a.unsupported && !allowed,
        running: eligible && cfg.on ? usd(stCum) : '—', opacity: eligible ? 1 : 0.8,
        onToggle: (e: any) => setS('on', e.target.checked), onDd: (e: any) => setS('dd', +e.target.value), onCap: (e: any) => setS('cap', +e.target.value) };
    });
    const stTotal = stCum;
    const chk = (ok: any, text: any) => ({ glyph: ok ? '✓' : '✕', color: ok ? '#3F6B3C' : '#9A3F32', text, k: text });
    const tab = (on: any, label: any, onClick: any) => ({ label, bg: on ? '#fff' : 'transparent', shadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none', onClick });
    const TAG: any = { live: judge ? ['EXAMPLE', '#F6EBDD', '#8A5F25'] : ['LIVE READ', '#E2EAD6', '#3F6B3C'], unvalued: ['UNVALUED', '#F6E3DE', '#9A3F32'], indicative: ['INDICATIVE', '#F4F5EF', '#8A9285'] };

    // Observe · portfolio
    const cashDates = sorted.filter((o: any) => days(o.due) > 0 && o.status !== 'paid');
    const pfT = cashDates.find((o: any) => o.id === s.pfDate) || null;
    const pfD = pfT ? days(pfT.due) : 0; const pfDl = pfT ? dlabel(pfT.due) : 'today';
    const pfDateTabs = [tab(!pfT, 'Today', () => self.setState({ pfDate: 'now' })), ...cashDates.slice(0, 4).map((o: any) => tab(pfT && pfT.id === o.id, dlabel(o.due) + ' · ' + o.name.split(' ')[0], () => self.setState({ pfDate: o.id })))];
    const sellable = (k: any) => P.assets[k].uses.includes('sell');
    let HD = [
      { name: 'USDC', sub: 'wallet · ' + ACC + '', chain: 'NEAR', usd: s.wallet, avail: 0, kind: 'cash', path: 'Available now', tag: 'live', src: 'NEAR RPC · 18:24' },
      { name: 'USDC', sub: '0x71C9…a9E2 · separate EVM signer', chain: 'Base', usd: (s.evm || 0) * 640 / 950, avail: 0, kind: 'cash', path: 'Available now', tag: 'live', src: 'Base public RPC · 18:24' },
      { name: 'USDC', sub: '0x71C9…a9E2 · separate EVM signer', chain: 'Arbitrum', usd: (s.evm || 0) * 310 / 950, avail: 0, kind: 'cash', path: 'Available now', tag: 'live', src: 'Arbitrum public RPC · 18:24' },
      { name: 'Rhea USDC supply', sub: 'collateral off · no debt', chain: 'NEAR', usd: s.rhea, avail: 0, kind: 'committed', path: 'Withdrawable now · liquidity-dependent', tag: 'live', src: 'Rhea get_account · 18:24' },
      { name: 'Staked NEAR', sub: '120.00 NEAR · aurora.pool.near', chain: 'NEAR', usd: 120 * NP, avail: 3, kind: 'committed', path: 'Unstake · 4 epochs · ~2–3 days', tag: 'live', src: 'Validator view · 18:24' },
      { name: 'Unstaking NEAR', sub: '8.00 NEAR · unbonding', chain: 'NEAR', usd: 8 * NP, avail: 2, kind: 'committed', path: 'Withdrawable Nov 14', tag: 'live', src: 'Validator view · 18:24' },
      { name: 'LiNEAR', sub: '60.00 LiNEAR ≈ 64.80 NEAR', chain: 'NEAR', usd: 64.8 * NP, avail: sellable('linear') ? 0 : null, kind: 'committed', path: sellable('linear') ? 'Instant swap ~0.3%' : 'Hold only under policy rev ' + P.rev, tag: 'live', src: 'LiNEAR price view · 18:24' },
      { name: 'rNEAR', sub: '25.00 rNEAR ≈ 26.50 NEAR', chain: 'NEAR', usd: 26.5 * NP, avail: sellable('rnear') ? 0 : null, kind: 'committed', path: sellable('rnear') ? 'Instant via Rhea pool ~0.2%' : 'Hold only under policy rev ' + P.rev, tag: 'live', src: 'Rhea pool price · 18:24' },
      { name: 'NEAR', sub: '42.10 NEAR · 0.50 kept as exit reserve', chain: 'NEAR', usd: 42.1 * NP, avail: null, kind: 'fees', path: 'Gas and fees', tag: 'live', src: 'NEAR RPC · example price $3.20' },
      { name: 'ETH', sub: '0.62 ETH · 0x71C9…a9E2', chain: 'Arbitrum', usd: 2000, avail: null, kind: 'protected', path: 'Never sold or pledged', tag: 'live', src: 'Arbitrum public RPC · 18:24' },
      { name: 'USDC/ETH LP', sub: '0x9aB4…77c1 · watched', chain: 'Base', usd: null, watched: true, path: 'Not yours to move', tag: 'unvalued', src: 'Adapter not supported' },
      { name: 'NFT · 3 items', sub: 'old-vault.near · watched', chain: 'NEAR', usd: null, watched: true, path: 'Not yours to move', tag: 'indicative', src: 'Floor price · not counted' },
    ];
    const pendingAmt = s.ops.filter((o: any) => o.status === 'stuck').reduce((a: any, o: any) => a + (o.deposit || o.amount), 0);
    if (pendingAmt > 0) HD.splice(4, 0, { name: 'Payout in flight', sub: 'deposit sent · waiting for 1Click', chain: 'NEAR', usd: pendingAmt, avail: null, kind: 'pending', path: 'Refunds to your wallet if it fails', tag: 'live', src: 'Server journal' });
    const fresh = s.ws === 'live' && s.ds === 'empty';
    if (fresh) HD = HD.filter((x: any) => (x.name === 'USDC' || x.name === 'Rhea USDC supply') && x.usd > 0).concat(s.watchAddr ? [{ name: 'Watched address', sub: short(s.watchAddr) + ' · read only', chain: s.watchAddr.startsWith('0x') ? 'Base' : 'NEAR', usd: null, watched: true, path: 'Not yours to move', tag: 'unvalued', src: 'Indexing · positions not read yet' }] : []);
    const owned = HD.filter((x: any) => !x.watched); const sumU = (arr: any) => arr.reduce((a: any, x: any) => a + x.usd, 0);
    const nw = sumU(owned), cashNow = sumU(owned.filter((x: any) => x.kind === 'cash'));
    const wdBy = sumU(owned.filter((x: any) => (x.kind === 'cash' || x.kind === 'committed') && x.avail !== null && x.avail <= pfD));
    const committed = sumU(owned.filter((x: any) => x.kind === 'committed' || x.kind === 'pending'));
    const W: any = { bg: '#fff', color: '#1E2A22', border: '#E3E6DB' };
    const pfBalances = [
      { label: 'Net worth', value: usd(nw), sub: 'owned positions · watched excluded · 1 unvalued', bg: '#2B4233', color: '#EAF0E2', border: '#2B4233' },
      { label: 'Cash now', value: usd(cashNow), sub: 'USDC on NEAR, Base and Arbitrum', ...W },
      { label: 'Withdrawable by ' + pfDl, value: usd(wdBy), sub: pfD >= 2 ? 'includes staking that unbonds in time' : 'staked NEAR still unbonding', ...W },
      { label: 'Borrowing headroom', value: '$0.00', sub: P.borrow ? 'borrowing ships in phase 2' : 'new borrowing is off in policy', ...W },
      { label: 'Committed', value: usd(committed), sub: 'Rhea, staking, unbonding' + (pendingAmt > 0 ? ', ' + usd(pendingAmt) + ' pending' : ''), ...W },
    ];
    const pfRows = HD.map((x: any) => {
      const t = TAG[x.tag]; const ok = !x.watched && x.avail !== null && x.avail <= pfD && x.kind !== 'fees';
      const by = x.watched ? 'Excluded' : x.kind === 'pending' ? 'Pending' : x.kind === 'fees' ? 'Fees only' : x.kind === 'protected' ? 'Protected' : x.avail === null ? 'Hold only' : ok ? '✓ Usable' : 'From ' + dlabel(iso(x.avail));
      return { name: x.name, sub: x.sub, chain: x.chain, value: x.usd === null ? (x.tag === 'unvalued' ? 'Unvalued' : 'Indicative') : usd(x.usd), valColor: x.usd === null ? '#8A5F25' : '#1E2A22',
        by, byColor: ok ? '#3F6B3C' : x.kind === 'protected' ? '#5B4F8A' : '#8A9285', path: x.path, tag: x.watched && x.tag !== 'unvalued' ? 'WATCHED' : t[0], tagBg: t[1], tagColor: t[2], src: x.src, opacity: x.watched ? 0.72 : 1 };
    });
    const pfAccounts0 = [
      { name: '' + ACC + '', sub: 'NEAR · MyNearWallet · can approve', tag: 'OWNER', tagBg: '#E2EAD6', tagColor: '#3F6B3C' },
      { name: '0x71C9…a9E2', sub: 'Base, Arbitrum · your EVM wallet · read here', tag: 'CONNECTED', tagBg: '#E7ECF3', tagColor: '#3F5A7A' },
      { name: '0x9aB4…77c1', sub: 'Base · someone else’s address', tag: 'WATCHED', tagBg: '#EEF0E8', tagColor: '#5B6458' },
      { name: 'old-vault.near', sub: 'Compromised 2025 · never signs', tag: 'WATCHED', tagBg: '#F6E3DE', tagColor: '#9A3F32' },
    ];
    const pfAccounts = !fresh ? pfAccounts0 : [s.connected ? pfAccounts0[0] : null, s.watchAddr ? { name: short(s.watchAddr), sub: 'read only · never signs', tag: 'WATCHED', tagBg: '#EEF0E8', tagColor: '#5B6458' } : null].filter(Boolean);
    const pfStake = [
      { label: 'STAKED', v: '120.00 NEAR', sub: 'earning · 9.1% example APR', bg: '#F7F8F3' },
      { label: 'UNSTAKING', v: '8.00 NEAR', sub: 'available Nov 14 · in 1d 14h', bg: '#FBF6EE' },
      { label: 'WITHDRAWABLE', v: '0.00 NEAR', sub: 'moves here when unbonding ends', bg: '#F7F8F3' },
    ];
    const pfStakeNote = 'The 8 NEAR unbonding counts toward “withdrawable by” any date from Nov 14. Staked NEAR needs 4 epochs to come back, so it never counts toward a payment due sooner than that.';

    // Configure · policy
    const USES = ['hold', 'sell', 'supply', 'pledge', 'stake', 'pay', 'fees'];
    const AM: any = { usdc: ['USDC · NEAR wallet', '' + ACC + ''], evmusdc: ['USDC · Base and Arbitrum', '0x71C9…a9E2 · separate signer'], near: ['NEAR', 'liquid · 0.50 exit reserve'], staked: ['Staked NEAR', 'aurora.pool.near'], linear: ['LiNEAR', 'liquid staking'], rnear: ['rNEAR', 'liquid staking'], eth: ['ETH · Arbitrum', '0x71C9…a9E2'] };
    const setDraft = (fn: any) => self.setState({ polDraft: fn(clone(s.polDraft)) });
    const polAssets = Object.keys(AM).map((k: any) => { const a = D.assets[k];
      return { name: AM[k][0], sub: AM[k][1], isProt: !a.uses.includes('sell') && !a.uses.includes('pledge') && k === 'eth',
        prio: ['P1', 'P2', 'P3'].map((l: any) => ({ label: l, bg: a.p === l ? '#fff' : 'transparent', onClick: () => setDraft((d: any) => { d.assets[k].p = l; return d; }) })),
        uses: USES.map((u: any) => { const on = a.uses.includes(u); return { label: (on ? '✓ ' : '') + (u === 'fees' ? 'pay fees' : u === 'pledge' ? 'borrow against' : u), bg: on ? '#E2EAD6' : '#fff', color: on ? '#3F6B3C' : '#8A9285', border: on ? '#E2EAD6' : '#E3E6DB', onClick: () => { if (!on && k === 'eth' && (u === 'sell' || u === 'pledge')) { self.remember(); self.setState({ modal: 'confirm', confirm: { u, title: 'Remove ETH’s protection?', text: 'ETH is protected: it is never sold or pledged. Allowing it to be ' + (u === 'sell' ? 'sold' : 'borrowed against') + ' lets the engine propose using it once you save the revision. You can turn this off again at any time.' } }); } else setDraft((d: any) => { const x = d.assets[k].uses; d.assets[k].uses = on ? x.filter((y: any) => y !== u && !(u === 'pledge' && y === 'borrow')) : [...x, u, ...(u === 'pledge' && !x.includes('borrow') ? ['borrow'] : [])]; return d; }); } }; }) };
    });
    const VEN = [['rhea', 'Rhea Lending'], ['oneclick', 'NEAR Intents 1Click'], ['native', 'Native validators'], ['linear', 'LiNEAR'], ['rnear', 'rNEAR'], ['vault', 'USDC vault · not verified']];
    const VN = Object.fromEntries(VEN);
    const polVenues = VEN.map(([k, label]: any) => { const on = D.venues[k]; const locked = k === 'vault'; return { label: (on ? '✓ ' : '') + label, bg: on ? '#E2EAD6' : '#fff', color: on ? '#3F6B3C' : '#8A9285', border: on ? '#E2EAD6' : '#D5DACB', borderStyle: locked ? 'dashed' : 'solid', onClick: () => locked ? self.toastMsg('This vault has no verified adapter yet, so it can’t be allowlisted.') : setDraft((d: any) => { d.venues[k] = !on; return d; }) }; });
    const setLim = (k: any) => (e: any) => setDraft((d: any) => { d[k] = parseFloat(e.target.value) || 0; return d; });
    const diffs: any = [];
    if (P.perAction !== D.perAction) diffs.push('per-action cap ' + usd(D.perAction));
    if (P.daily !== D.daily) diffs.push('daily cap ' + usd(D.daily));
    if (P.maxMove !== D.maxMove) diffs.push('max moving cost ' + usd(D.maxMove));
    if (P.borrow !== D.borrow) diffs.push('new borrowing ' + (D.borrow ? 'allowed' : 'off'));
    if (JSON.stringify(P.venues) !== JSON.stringify(D.venues)) diffs.push('venues changed');
    if (JSON.stringify(P.assets) !== JSON.stringify(D.assets)) diffs.push('asset uses or priorities changed');
    const polClean = diffs.length === 0;
    const polSave = polClean ? { title: 'Saved · revision ' + P.rev, sub: 'Every prepared action is checked against this revision.', bg: '#F4F5EF', border: '#E3E6DB', color: '#4A5349', btnBg: '#B9C0B2' }
      : { title: 'Unsaved changes', sub: diffs.join(' · ') + '. Saving supersedes actions prepared under rev ' + P.rev + '.', bg: '#FBF6EE', border: '#EBD9BF', color: '#6E4A1A', btnBg: '#2A4034' };
    const T = s.test; const ta = parseFloat(T.amount) || 0;
    const tcost: any = ({ supply: 0.01, pay: 0.61, sell: ta * 0.003, pledge: 0.02 } as any)[T.kind];
    const tc = [
      chk(ta <= D.perAction, 'Per-action cap ' + usd(D.perAction)),
      chk(P.used + ta <= D.daily, 'Daily total ' + usd(P.used + ta) + ' of ' + usd(D.daily)),
      chk(!!D.venues[T.venue], VN[T.venue] + ' is allowlisted'),
      chk(D.assets[T.asset].uses.includes(T.kind), AM[T.asset][0] + ' may be used to ' + (T.kind === 'pledge' ? 'borrow against' : T.kind)),
      chk(tcost <= D.maxMove, 'Moving cost ' + usd(tcost) + ' within ' + usd(D.maxMove)),
    ];
    if (T.asset === 'usdc' && (T.kind === 'supply' || T.kind === 'pay')) tc.push(T.kind === 'supply' ? chk(ta <= walletSurplus, 'Holdback ' + usd(holdback) + ' stays in wallet') : chk(ta <= Math.max(0, s.wallet - s.reserve), 'Reserve ' + usd(s.reserve) + ' stays in wallet'));
    if (T.kind === 'pledge') tc.push(chk(D.borrow, 'New borrowing allowed'));
    const tf = tc.filter((c: any) => c.glyph === '✕').length;
    const testVerdict = tf ? { text: 'Refused at prepare · ' + tf + (tf > 1 ? ' rules fail' : ' rule fails'), bg: '#F6E3DE', color: '#7F3528' } : { text: 'Passes every rule · can be prepared for your approval', bg: '#E2EAD6', color: '#2F552D' };
    const setT = (k: any) => (e: any) => self.setState({ test: { ...s.test, [k]: e.target.value } });

    // Execute · pay on a date
    const planFor = (ob: any) => {
      const q = this.quote(ob);
      const earlier = live.filter((o: any) => o.id !== ob.id && o.due <= ob.due && days(o.due) >= 0 && o.status !== 'paying').reduce((a: any, o: any) => a + o.amount, 0);
      const free = s.wallet - s.reserve - earlier; const fy = q.deposit * 0.103 * s.horizon / 365;
      const capOk = q.deposit <= P.perAction, dayOk = P.used + q.deposit <= P.daily;
      const usePay = P.assets.usdc.uses.includes('pay');
      const polWhy = !usePay ? 'USDC may not be used to pay under policy rev ' + P.rev : !capOk ? 'Over your ' + usd(P.perAction) + ' per-action cap' : !dayOk ? 'Over your ' + usd(P.daily) + ' daily cap' : '';
      const plans = [
        { key: 'wallet', name: 'Idle wallet USDC', sub: 'above your reserve and earlier payments', pol: !!polWhy, ok: !polWhy && free >= q.deposit, why: polWhy || 'Only ' + usd(Math.max(0, free)) + ' free after reserve and earlier payments', cost: q.fee, time: q.time, rows: [['Fees', usd(q.fee)], ['Foregone yield', '$0.00'], ['Approvals', '1 · deposit']] },
        { key: 'rhea', name: 'Withdraw from Rhea, then pay', sub: 'withdrawal verified before the payout quote', pol: !!polWhy || !P.venues.rhea, ok: !polWhy && P.venues.rhea && s.rhea >= q.deposit, why: polWhy || (P.venues.rhea ? 'Rhea holds only ' + usd(s.rhea) : 'Rhea is not allowlisted'), cost: q.fee + 0.01 + fy, time: '~3 min', need: q.deposit, rows: [['Fees', usd(q.fee + 0.01)], ['Foregone yield · ' + s.horizon + 'd', usd(fy)], ['Approvals', '2 · withdraw, deposit']] },
        (() => { const ok = sellable('linear'); const qty = q.deposit / (NP * 1.08); const fyL = q.deposit * 0.086 * s.horizon / 365; return { key: 'linear', name: 'Sell LiNEAR for ' + AS(ob), sub: 'approved asset · sells NEAR exposure', pol: !ok, preview: ok, previewCta: 'Preview · swap leg not built', ok: false, why: !ok ? 'LiNEAR may not be sold under policy rev ' + P.rev : qty > 60 ? 'Needs ' + num(qty) + ' LiNEAR; you hold 60.00' : 'Preview only · the swap leg isn’t built yet', cost: q.fee + q.deposit * 0.003 + fyL, rows: ok ? [['LiNEAR sold', num(qty) + ' of 60.00'], ['Price impact ~0.3%', usd(q.deposit * 0.003)], ['Foregone yield · ' + s.horizon + 'd at 8.6%', usd(fyL)], ['Fees', usd(q.fee)]] : [['Would sell', num(qty) + ' LiNEAR'], ['Approvals', '2']] }; })(),
        (() => { const loan = q.deposit; const has = stTotal > 0; const bInt = loan * 0.065 * s.horizon / 365; const hN = stLT / Math.max(1, loan + c.debt); const hS = stSLT / Math.max(1, loan + c.debt); return { key: 'borrow', name: 'Borrow USDC against collateral', sub: has ? 'selected collateral on the Credit page' : 'no collateral allowed', pol: !has, preview: has, previewCta: 'Preview only · phase 2', ok: false, why: !has ? 'No asset is allowed as collateral in your policy' : stTotal < loan ? 'Capacity ' + usd(stTotal) + ' is below the ' + usd(loan) + ' needed' : 'Preview only · borrowing ships in phase 2' + (P.borrow ? '' : ' · new borrowing is off in policy'), cost: bInt + q.fee, rows: has ? [['Capacity under stress', usd(stTotal)], ['Health after loan', hN.toFixed(2) + ' · stressed ' + hS.toFixed(2)], ['Interest · 6.5% example', usd(bInt)], ['Repay by ' + dlabel(iso(s.horizon)), usd(loan + bInt) + ' from surplus']] : [['Collateral allowed', 'none'], ['Repayment plan', 'required']] }; })(),
      ];
      const elig = plans.filter((p: any) => p.ok).sort((a: any, b: any) => a.cost - b.cost);
      return { q, earlier, free, plans, elig, best: elig[0], capOk, dayOk };
    };
    const payables = [...(s.intents || []).filter((o: any) => !['paid', 'paying'].includes(o.status)), ...sorted.filter((o: any) => days(o.due) >= 0 && !['paid', 'paying'].includes(o.status))];
    pv.alts = pv.alts || [];
    if (s.modal === 'pay' && s.pay) { const ob0 = this.findOb(s.pay.obId); if (ob0) { const pf0 = planFor(ob0); const chosen = s.pay.plan || (s.pay.need > 0 ? 'rhea' : 'wallet'); const chp = pf0.plans.find((p: any) => p.key === chosen); pv.chosen = chp ? chp.name : '—'; pv.chosenCost = chp ? usd(chp.cost) + ' total cost' : ''; pv.alts = pf0.plans.filter((p: any) => p.key !== chosen).map((p: any) => ({ name: p.name, note: p.ok ? usd(p.cost) + ' · allowed, costs more' : p.why, color: p.ok ? '#5B6458' : '#8A5F25' })); } }
    const pyOb = payables.find((o: any) => o.id === s.payPick) || payables[0];
    const py = pyOb ? planFor(pyOb) : null;
    const pyTabs = payables.slice(0, 5).map((o: any) => tab(pyOb && o.id === pyOb.id, o.name + ' · ' + dlabel(o.due), () => self.setState({ payPick: o.id })));
    const pyPlans = py ? [...py.elig, ...py.plans.filter((p: any) => !p.ok)].map((p: any) => { const r = py.elig.indexOf(p); const top = r === 0;
      return { name: p.name, sub: p.sub, tag: p.ok ? (top ? 'ENGINE PICK' : 'ALLOWED #' + (r + 1)) : p.preview ? (p.key === 'borrow' ? 'PREVIEW · PHASE 2' : 'PREVIEW') : 'NOT ALLOWED', tagBg: p.ok ? (top ? '#C9E86B' : '#EEF0E8') : '#F6EBDD', tagColor: p.ok ? '#1E2A22' : '#8A5F25',
        costF: p.key === 'borrow' && !p.preview ? '—' : usd(p.cost), costColor: p.ok ? '#1E2A22' : '#8A9285', costSub: p.ok ? 'total cost · ' + p.time : p.why, subColor: p.ok ? '#8A9285' : '#8A5F25',
        rows: p.rows.map(([k, v]: any) => ({ k, v })), border: top ? '#9DB48C' : '#E3E6DB', opacity: p.ok || p.preview ? 1 : 0.82, disabled: p.preview || (!p.ok && !p.pol),
        cta: p.ok ? 'Review this plan →' : p.preview ? p.previewCta : p.pol ? 'Allow in Policy ↗' : 'Not available', btnBg: p.ok ? (top ? '#2A4034' : '#fff') : p.pol ? '#fff' : '#F4F5EF', btnColor: p.ok ? (top ? '#fff' : '#1E2A22') : p.pol ? '#3F6B3C' : '#8A9285', btnBorder: p.ok && top ? 'none' : '1px solid #E3E6DB',
        onClick: () => p.ok ? self.openPay(pyOb.id, { need: p.need, plan: p.key }) : !p.preview && p.pol && self.go('policy') }; }) : [];
    const pyChecks = py ? [
      chk(true, 'Reserve of ' + usd(s.reserve) + ' stays in wallet'),
      chk(!!py.best, 'Earlier payments (' + usd(py.earlier) + ') stay covered'),
      chk(py.capOk, 'Per-action cap ' + usd(P.perAction) + ' · this sends ' + usd(py.q.deposit)),
      chk(py.dayOk, 'Daily total ' + usd(P.used + py.q.deposit) + ' of ' + usd(P.daily)),
      chk(P.venues.oneclick, 'NEAR Intents 1Click is allowlisted'),
      chk(true, 'ETH stays protected · never a source'),
      chk(true, 'Recipient matches your calendar entry'),
    ] : [];
    const pyHead = pyOb ? { amount: num(pyOb.amount) + ' ' + AS(pyOb), line: 'to ' + pyOb.name + ' on ' + pyOb.chain + ' · due ' + dlabel(pyOb.due) + ' · in ' + days(pyOb.due) + ' days', addr: pyOb.recipient, send: num(py!.q.deposit) + ' USDC', fee: usd(py!.q.fee), buf: usd(py!.q.buf) + ' · returned' } : { amount: '', line: '', addr: '', send: '', fee: '', buf: '' };

    // Decide · staking
    const sAmt = Math.min(Math.max(0, parseFloat(s.stk.amt) || 0), 41.6);
    const stOb = cashDates.find((o: any) => o.id === s.stk.by) || cashDates[0];
    const stD = stOb ? days(stOb.due) : 30; const stDl = stOb ? dlabel(stOb.due) : dlabel(iso(30));
    const SO = [
      { key: 'native', name: 'Native staking', kind: 'aurora.pool.near · validator', apr: 9.1, exitDays: 3, exitPct: 0, exit: 'Unstake takes 4 epochs, about 2–3 days' },
      { key: 'linear', name: 'LiNEAR', kind: 'liquid staking', apr: 8.6, exitDays: 0, exitPct: 0.3, exit: 'Instant swap ~0.3%, or a 4-epoch unstake' },
      { key: 'rnear', name: 'rNEAR', kind: 'liquid staking on Rhea', apr: 8.9, exitDays: 0, exitPct: 0.2, exit: 'Instant through the Rhea pool ~0.2%' },
    ].map((o: any) => { const earnN = sAmt * o.apr / 100 * Math.max(0, stD - s.lead) / 365; const costN = sAmt * o.exitPct / 100; const fits = o.exitDays + s.lead <= stD; const allowed = !!P.venues[o.key] && P.assets.near.uses.includes('stake');
      // Same rule as the staking engine: stakes come from surplus only, so exit timing informs but never blocks.
      return { ...o, earnN, costN, net: earnN - costN, fits, allowed, ok: allowed }; });
    const sRank = SO.filter((o: any) => o.ok).sort((a: any, b: any) => b.net - a.net);
    const stakeCards = [...sRank, ...SO.filter((o: any) => !o.ok)].map((o: any) => { const r = sRank.indexOf(o); const top = r === 0;
      return { name: o.name, kind: o.kind, tag: o.ok ? (top ? 'BEST FIT #1 · SURPLUS' : 'FITS #' + (r + 1) + ' · SURPLUS') : 'NOT ALLOWED', tagBg: o.ok ? (top ? '#C9E86B' : '#EEF0E8') : '#F6EBDD', tagColor: o.ok ? '#1E2A22' : '#8A5F25',
        net: o.ok ? (o.net >= 0 ? '+' : '−') + num(Math.abs(o.net)) + ' NEAR' : '—', netColor: o.ok ? '#1E2A22' : '#8A9285',
        netSub: o.ok ? '≈ ' + usd(o.net * NP) + ' · rate held constant' : (!P.assets.near.uses.includes('stake') ? 'NEAR may not be staked under policy rev ' + P.rev : 'Not in your policy venues'),
        rows: [{ k: 'Earned at ' + o.apr + '% · ' + Math.max(0, stD - s.lead) + 'd', v: '+' + num(o.earnN) + ' NEAR' }, { k: 'Exit cost', v: o.costN ? '−' + num(o.costN) + ' NEAR' : 'none' }, { k: 'Back in wallet', v: o.exitDays ? '~' + o.exitDays + ' days' : 'same block' }],
        exit: o.exit, fitText: o.fits ? '✓ Could be back before ' + stDl + ' with your ' + s.lead + '-day lead · staked from surplus only' : 'Back after ' + stDl + ' if you exit · fine: staked from surplus only, no payment counts on it', fitColor: o.fits ? '#3F6B3C' : '#5B6458',
        border: top ? '#9DB48C' : '#E3E6DB', cta: o.ok ? 'Prepare stake' : !o.allowed ? 'Allow in Policy ↗' : 'Not available', btnBg: o.ok && top ? '#2A4034' : o.ok || !o.allowed ? '#fff' : '#F4F5EF', btnColor: o.ok && top ? '#fff' : o.ok ? '#1E2A22' : !o.allowed ? '#3F6B3C' : '#8A9285', btnBorder: o.ok && top ? 'none' : '1px solid #E3E6DB',
        onClick: () => o.ok ? self.toastMsg('Stake preparation reuses the supply handoff and is next in the build. Nothing was prepared.') : !o.allowed && self.go('policy') }; });
    const stkTabs = cashDates.slice(0, 4).map((o: any) => tab(stOb && o.id === stOb.id, dlabel(o.due) + ' · ' + o.name.split(' ')[0], () => self.setState({ stk: { ...s.stk, by: o.id } })));

    // Account · replays
    const rentId = (s.obs.find((o: any) => o.id === 'o6' && o.status === 'upcoming') || payables[0] || {}).id;
    const rentOb = s.obs.find((o: any) => o.id === rentId);
    const RC: any = { ok: ['#E2EAD6', '#3F6B3C'], warn: ['#F6EBDD', '#8A5F25'], bad: ['#F6E3DE', '#9A3F32'] };
    const needRent = () => self.toastMsg('No unpaid payment left to replay. Switch the dataset to reset.');
    const runPay = (x: any) => () => rentOb ? self.openPay(rentOb.id, x) : needRent();
    const replays = [
      ['Delivered and verified', 'Pay Rent · Aman 1,000 USDT on BNB Chain from idle wallet USDC. It is marked paid only after the destination transfer is found.', '1Click SUCCESS + destination receipt', 'PAID · VERIFIED', 'ok', runPay({ outcome: 'success' })],
      ['Withdraw, then pay', 'Funds the same payout from Rhea. The withdrawal is its own approval and must be verified before a payout quote is requested.', 'Rhea payout event + 1Click SUCCESS', 'TWO LEGS VERIFIED', 'ok', () => rentOb ? self.openPay(rentOb.id, { outcome: 'success', need: planFor(rentOb).q.deposit }) : needRent()],
      ['Swap failed, refunded', 'The solver can’t fill the quote. The full deposit goes back to your account and the payment stays in your holdback.', '1Click REFUNDED', 'REFUNDED · NOT PAID', 'warn', runPay({ outcome: 'refunded' })],
      ['Status unknown', 'The deposit lands but 1Click stops reporting. Recovery details are saved and paying again stays disabled.', '1Click PROCESSING, no update', 'NEEDS RECOVERY', 'bad', runPay({ outcome: 'stuck' })],
      ['Quote expires', 'The exact-output quote runs out before any deposit. Nothing is sent and a new quote is required.', '1Click quote deadline', 'EXPIRED · NOTHING SENT', 'warn', runPay({ outcome: 'expired' })],
      ['Blocked by policy', 'A 6,000 USDC supply is refused at prepare: it is over the per-action cap and would cut into the holdback.', 'Policy rev ' + P.rev + ' + holdback check', 'REFUSED AT PREPARE', 'bad', () => self.openOp('supply', '6000')],
      ['Assistant proposal rejected', 'A question becomes a structured proposal. The engine rejects it, and the assistant explains why using only engine figures.', 'Example response', 'REJECTED BY ENGINE', 'bad', () => self.ask('Why was my 6,000 USDC supply blocked?', 'blocked')],
    ].map(([title, desc, src, end, kind, onClick]: any, i: any) => ({ n: String(i + 1).padStart(2, '0'), title, desc, src, end, endBg: RC[kind][0], endColor: RC[kind][1], onClick: () => i === 6 ? onClick() : self.startReplay(onClick) }));

    // Later · roadmap
    const RS: any = { now: ['IN THIS BUILD', '#E2EAD6', '#3F6B3C', '#4E7A4A', '#fff'], part: ['PARTLY BUILT', '#E7ECF3', '#3F5A7A', '#E2EAD6', '#2F552D'], prev: ['SIMULATED PREVIEW', '#F6EBDD', '#8A5F25', '#F6EBDD', '#8A5F25'], plan: ['PLANNED', '#EEF0E8', '#5B6458', '#EEF0E8', '#5B6458'] };
    const roadmap = [
      ['0', 'Close the local loop', 'Cash plan, owner-approved Rhea supply and withdrawal, verified activity', 'An owner-funded rehearsal with reconciliation, recovery and a security review', 'now'],
      ['1', 'Universal observation and policy', 'Seven-chain target, wallet and exchange views, asset rows, priorities and stress scenarios', 'Coverage inventory, correct exposure accounting and visible unknowns', 'part', 'Open portfolio', 'portfolio'],
      ['2', 'Cash access and credit', 'Equal-net plans across cash, withdrawal, sale and eligible borrowing; cross-chain payout and gas abstraction', 'Real debt and health previews, repayment, per-leg settlement and partial-failure recovery', 'prev', 'Open credit preview', 'credit'],
      ['3', 'Discovery and vault publishing', 'Research reports, manual pilots, then vaults from approved templates', 'Evidence-backed net accounting, fee and redemption rules, verified exit', 'plan'],
      ['4', 'Protective automation and trading', 'Bounded incident responses, rotation, exchange and perp adapters', 'Revocable scoped mandates, incident drills, margin reconciliation', 'plan'],
      ['5', 'Everyday and institutional account', 'Partner-issued cards, treasury API, capital-partner reporting', 'Issuer agreements, spendable-fund reservation, paid-pilot evidence', 'plan'],
      ['6', 'Ecosystem incentive economy', 'Protocol campaigns, FlowVault token programs, discount receipts', 'Explicit rights and eligibility, vesting and transfer design, authorized release', 'plan'],
      ['7', 'Speculative sleeve and launch treasuries', 'A policy-bounded budget for memecoins through official pools; creator treasuries run as plans', 'Sleeve isolation proven, safety-report coverage, treasury rules verifiable on-chain', 'plan'],
    ].map(([n, title, journey, exit, st, linkLabel, to]: any) => ({ n, title, journey, exit, status: RS[st][0], stBg: RS[st][1], stColor: RS[st][2], dotBg: RS[st][3], dotColor: RS[st][4], hasLink: !!to, linkLabel: linkLabel || '', onLink: () => to && self.go(to) }));
    const stretch = [
      { t: 'On-chain policy contract', d: 'Your plan held by a NEAR contract that holds no funds. Agent proposals that break it are rejected on-chain; the rest wait for you.' },
      { t: 'Chain Signatures', d: 'An EVM address controlled by your NEAR account, read and paid from as part of the same account.' },
      { t: 'Receive into the plan', d: 'Incoming payments fill the reserve first, then surplus goes to approved strategies.' },
    ];

    // Assistant
    const verd = (label: any, k: any) => ({ verdict: label, vBg: RC[k][0], vColor: RC[k][1] });
    const kv = (arr: any) => arr.map(([k, v]: any) => ({ k, v }));
    const aiFor = (type: any) => {
      if (type === 'pay') {
        const real = s.obs.find((o: any) => o.chain === 'BNB Chain' && AS(o) === 'USDT' && o.amount === 1000 && !['paid', 'paying'].includes(o.status));
        const ob = real || { id: 'ask', name: 'a new payment', amount: 1000, asset: 'USDT', chain: 'BNB Chain', recipient: 'not set', due: iso(7), status: 'upcoming' };
        const pf = planFor(ob); const b = pf.best;
        const lead = real ? real.name + ' (1,000 USDT on BNB Chain) is already in your calendar for ' + dlabel(real.due) + '. ' : 'There is no such payment in your calendar, so it is evaluated as one due ' + dlabel(ob.due) + '. ';
        return { text: b ? 'Yes. ' + lead + 'The cheapest source your policy allows is ' + b.name.charAt(0).toLowerCase() + b.name.slice(1) + ': you send ' + num(pf.q.deposit) + ' USDC and the recipient receives exactly 1,000.00 USDT on BNB Chain. Fees are ' + usd(pf.q.fee) + ', the ' + usd(pf.q.buf) + ' buffer comes back, and your ' + usd(s.reserve) + ' reserve and ETH are not used.' : 'Not under your current rules. ' + lead + pf.plans[0].why + '.',
          hasProposal: true, rows: kv([['kind', 'payout'], ['amount', '1,000.00 · exact output'], ['token', 'USDT'], ['chain', 'BNB Chain'], ['due', dlabel(ob.due)], ['source', b ? b.key : 'none'], ['excluded', 'ETH · protected']]), ...verd(b ? 'ACCEPTED BY ENGINE' : 'REJECTED', b ? 'ok' : 'bad'),
          checks: [chk(pf.capOk, 'Per-action cap ' + usd(P.perAction)), chk(pf.dayOk, 'Daily cap ' + usd(P.daily)), chk(true, 'Reserve kept'), chk(true, 'ETH untouched')],
          sent: 'this payment, wallet and Rhea USDC balances, policy limits. Not sent: other payments or addresses.', hasAction: true,
          actionLabel: real ? 'Review in Pay on a date →' : 'Add it as a dated payment →',
          onAction: () => real ? self.setState({ screen: 'pay', payPick: real.id, asst: { ...s.asst, open: false } }) : self.setState({ modal: 'add', asst: { ...s.asst, open: false }, form: { name: '', amount: '1000', chain: 'BNB Chain', recipient: '', due: iso(7), note: '', confirmed: false } }) };
      }
      if (type === 'surplus') {
        const ws = supplyMax; const n = ws * 0.103 * s.horizon / 365 - rtc - 0.01;
        if (ws <= 1) return { text: 'Nothing is idle. Your wallet holds the holdback and the rest is already in Rhea.', hasProposal: false, sent: 'wallet balance, holdback', hasAction: false };
        const capOk = ws <= P.perAction, dayOk = P.used + ws <= P.daily;
        return { text: 'Supply ' + usd(ws) + ' to Rhea Lending with collateral off. At 10.30% held constant, that nets about ' + usd(n) + ' over ' + s.horizon + ' days after the cost of getting it back. The USDC vault quotes more but isn’t an approved venue, and its next exit window misses your Nov 25 payment.',
          hasProposal: true, rows: kv([['kind', 'supply'], ['amount', num(ws)], ['token', 'USDC'], ['chain', 'NEAR'], ['venue', 'rhea'], ['collateral', 'off']]), ...verd(capOk && dayOk ? 'ACCEPTED BY ENGINE' : 'REJECTED', capOk && dayOk ? 'ok' : 'bad'),
          checks: [chk(true, 'Holdback ' + usd(holdback) + ' stays in wallet'), chk(capOk, 'Per-action cap ' + usd(P.perAction)), chk(dayOk, 'Daily cap ' + usd(P.daily)), chk(P.venues.rhea, 'Rhea is allowlisted')],
          sent: 'wallet and Rhea USDC balances, holdback total, payment dates. Not sent: recipients.', hasAction: capOk && dayOk, actionLabel: 'Review supply →', onAction: () => self.openOp('supply', ws.toFixed(2)) };
      }
      if (type === 'stress') return { text: 'If ETH falls 50%, your 0.62 ETH drops from $2,000.00 to $1,000.00, so net worth falls by $1,000.00. Nothing in the plan changes: ETH is protected, nothing is borrowed against it, and usable cash stays ' + usd(cashNow) + '.',
        hasProposal: true, rows: kv([['kind', 'hold'], ['amount', '0.62'], ['token', 'ETH'], ['chain', 'Arbitrum'], ['scenario', 'ETH −50%'], ['net worth', '−$1,000.00'], ['usable cash', 'no change']]), ...verd('NO ACTION NEEDED', 'ok'),
        checks: [chk(true, 'No debt against ETH'), chk(true, 'Holdback unaffected'), chk(true, 'ETH stays protected')], sent: 'ETH position, debt summary, usable cash total.', hasAction: true, actionLabel: 'Open the credit simulation →', onAction: () => self.setState({ screen: 'credit', asst: { ...s.asst, open: false } }) };
      if (type === 'blocked') { const a = 6000; const c1 = a <= P.perAction, c2 = a <= walletSurplus;
        return { text: (c1 && c2) ? 'Under policy rev ' + P.rev + ' a 6,000 USDC supply would pass.' : 'The engine refused it at prepare. ' + (!c1 ? 'It is over your ' + usd(P.perAction) + ' per-action cap (policy rev ' + P.rev + ')' : '') + (!c1 && !c2 ? ', and it' : !c2 ? 'It' : '') + (!c2 ? ' would leave ' + usd(Math.max(0, s.wallet - a)) + ' in your wallet, below the ' + usd(holdback) + ' holdback' : '') + '. The largest supply that passes today is ' + usd(Math.min(P.perAction, walletSurplus)) + '.',
          hasProposal: true, rows: kv([['kind', 'supply'], ['amount', '6,000.00'], ['token', 'USDC'], ['chain', 'NEAR'], ['venue', 'rhea']]), ...verd(c1 && c2 ? 'ACCEPTED BY ENGINE' : 'REJECTED BY ENGINE', c1 && c2 ? 'ok' : 'bad'),
          checks: [chk(c1, 'Per-action cap ' + usd(P.perAction)), chk(c2, 'Holdback ' + usd(holdback) + ' stays in wallet'), chk(P.used + a <= P.daily, 'Daily cap ' + usd(P.daily))],
          sent: 'the proposed supply, wallet balance, holdback total, policy limits.', hasAction: true, actionLabel: 'Open policy →', onAction: () => self.setState({ screen: 'policy', asst: { ...s.asst, open: false } }) }; }
      return { text: 'Example responses only: typed questions aren’t sent to a model in this build. Try one of these:', hasProposal: false, hasChips: true, chips: QS_LIST.map(([q, sh, t]: any) => ({ short: sh, onClick: () => self.ask(q, t) })), sent: 'nothing', hasAction: false };
    };
    const asstMsgs = s.asst.msgs.map((m: any) => m.role === 'user' ? { isUser: true, isAi: false, text: m.text, hasProposal: false, hasAction: false, hasChips: false, chips: [] } : { isUser: false, isAi: true, hasChips: false, chips: [], ...aiFor(m.type) });
    const asstSuggest = QS_LIST.map(([q, sh, t]: any) => ({ q, onClick: () => self.ask(q, t) }));
    const asstChips = QS_LIST.map(([q, sh, t]: any) => ({ short: sh, onClick: () => self.ask(q, t) }));
    const EB: any = { overview: 'OBSERVE · YOUR CAPITAL, WITH A PLAN', calendar: 'CONFIGURE · DATED PAYMENTS', strategies: 'DECIDE · PUT THE SURPLUS TO WORK', activity: 'ACCOUNT · VERIFIED HISTORY' };

    const MD = ['#2B4233', '#D8B98F', '#4E7A4A', '#9DB48C', '#8A9285'];
    const ovMetrics = pfBalances.map((b: any, i: any) => ({ label: b.label, value: b.value, sub: b.sub, dot: MD[i], border: i ? '1px solid #EEF0E8' : 'none' }));
    const grp = (name: any, icon: any, iconBg: any, iconColor: any, rows: any, exit: any, action: any, onAction: any, isLabel?: any) => rows.length ? { icon, iconBg, iconColor, name, sub: rows.map((x: any) => x.name + (x.chain !== 'NEAR' ? ' · ' + x.chain : '')).join(', '), balance: usd(sumU(rows)), exit, action, onAction, isBtn: !isLabel, isLabel: !!isLabel } : null;
    const ovPositions = [
      grp('Cash', '$', '#E2EAD6', '#3F6B3C', owned.filter((x: any) => x.kind === 'cash'), 'Available now · the NEAR wallet holds your holdback', 'Supply surplus', () => self.openOp('supply', supplyMax.toFixed(2))),
      grp('Earning', '↑', '#E2EAD6', '#3F6B3C', owned.filter((x: any) => x.name === 'Rhea USDC supply'), 'Withdrawable now, liquidity-dependent', 'Withdraw', () => self.openOp('withdraw', Math.min(s.rhea, 1000).toFixed(2))),
      grp('Staking', 'N', '#ECE8F4', '#6B5E99', owned.filter((x: any) => ['Staked NEAR', 'Unstaking NEAR', 'LiNEAR', 'rNEAR'].includes(x.name)), '8 NEAR back Nov 14 · staked NEAR needs ~2–3 days', 'Compare staking', () => self.go('strategies')),
      grp('Pending', '◷', '#E7ECF3', '#3F5A7A', owned.filter((x: any) => x.kind === 'pending'), 'Payout in flight · refunds if it fails', 'Open activity', () => self.go('activity')),
      grp('Protected', 'Ξ', '#ECE8F4', '#5B4F8A', owned.filter((x: any) => x.kind === 'protected'), 'Never sold or pledged', 'Edit in Policy', () => self.go('policy')),
      grp('Fees', 'N', '#EEF0E8', '#4A5349', owned.filter((x: any) => x.kind === 'fees'), 'Gas and fees · 0.50 NEAR exit reserve', 'Gas and fees only', () => {}, true),
      HD.some((x: any) => x.watched) ? { icon: '◎', iconBg: '#F4F5EF', iconColor: '#8A9285', name: 'Watched', sub: HD.filter((x: any) => x.watched).map((x: any) => x.name).join(', '), balance: 'Excluded', exit: 'Other people’s accounts · not in net worth', action: 'Open portfolio', onAction: () => self.go('portfolio'), isBtn: true, isLabel: false } : null,
    ].filter(Boolean);
    const intRecips: any = []; const seen: any = {};
    [...s.obs].sort((a: any, b: any) => Number(b.chain === 'BNB Chain') - Number(a.chain === 'BNB Chain')).forEach((o: any) => { const key = o.recipient + o.chain; if (seen[key]) return; seen[key] = 1; const nm = o.name.split(' · ').pop(); intRecips.push({ id: 'r' + intRecips.length, label: nm + ' · ' + o.chain + ' · ' + short(o.recipient), name: nm, recipient: o.recipient, chain: o.chain }); });
    const I = s.intent || { amount: '1000', asset: 'USDT', rid: 'r0', addr: '', chain: 'BNB Chain', due: iso(7), save: true, repeats: 'none' };
    const iAmt = parseFloat(I.amount) || 0; const iRec = I.rid === 'new' ? null : intRecips.find((r: any) => r.id === I.rid);
    const iAddr = I.addr.trim(); const iAddrOk = I.rid !== 'new' || (I.chain === 'NEAR' ? isNear(iAddr) : isEvm(iAddr));
    const intentInvalid = !(iAmt > 0 && I.due && days(I.due) >= 0 && (iRec || (I.rid === 'new' && iAddrOk)));
    const setI = (k: any) => (e: any) => { const v = k === 'save' ? e.target.checked : e.target.value; const nx: any = { ...I, [k]: v }; if (k === 'rid') { const r = intRecips.find((x: any) => x.id === v); if (r) nx.chain = r.chain; } self.setState({ intent: nx }); };
    const whyKeys = ['supply', 'pay', 'test', 'strat'];
    const why = Object.fromEntries(whyKeys.map((k: any) => [k, !s.whyOff[k]]));
    const dismissWhy = Object.fromEntries(whyKeys.map((k: any) => [k, () => { const off: any = { ...s.whyOff, [k]: true }; try { sessionStorage.setItem('fv-why', JSON.stringify(off)); } catch (e) {} self.setState({ whyOff: off }); }]));
    const onbS = (done: any, active: any) => ({ bg: done ? '#F4F7EE' : '#fff', dotBg: done ? '#4E7A4A' : active ? '#2B4233' : '#EEF0E8', dotColor: done || active ? '#fff' : '#5B6458' });
    const d1 = s.connected || !!s.watchAddr, d2 = s.reserveSet ?? s.reserve > 0, d3 = s.obs.length > 0;
    const onb: any = { s1: { ...onbS(d1, !d1), glyph: d1 ? '✓' : '1', sub: s.connected ? 'Connected ' + LIVE_ACC + ' · can approve' : 'Connecting proves the account is yours. FlowVault reads only accounts you connect, and you approve every action.' },
      s2: { ...onbS(d2, d1 && !d2), glyph: d2 ? '✓' : '2' }, s3: { ...onbS(d3, d2 && !d3), glyph: d3 ? '✓' : '3', sub: d3 ? s.obs[0].name + ' · ' + num(s.obs[0].amount) + ' ' + AS(s.obs[0]) + ' · ' + dlabel(s.obs[0].due) : 'Amount the recipient receives, chain, address and due date.' },
      s4: { ...onbS(false, d1 && d2 && d3), glyph: '4', btnBg: d1 && d2 && d3 ? '#2A4034' : '#B9C0B2' }, notReady: !(d1 && d2 && d3) };
    const stmtDays: any = { a1: 9, a2: 10, a3: 15, a4: 22 };
    const stmtList = s.ops.map((o: any) => { const d = stmtDays[o.id] || 0; const gas = 0.0011 * NP; const f = FEES[o.chain] || NOFEE;
      if (o.kind === 'Supply') return { o, title: 'Supply · Rhea Lending', sub: o.sub + ' · open, earning', flow: o.amount, y: o.amount * 0.103 * d / 365, fee: gas };
      if (o.kind === 'Withdrawal') return { o, title: 'Withdrawal · Rhea Lending', sub: o.sub + ' · exited to wallet', flow: -o.amount, y: 0, fee: gas };
      if (o.status === 'refunded' || o.status === 'failed') return { o, title: 'Payout · ' + o.title, sub: o.sub + ' · refunded, not paid', flow: 0, y: 0, fee: gas };
      if (o.status === 'stuck') return { o, title: 'Payout · ' + o.title, sub: o.sub + ' · pending', flow: -(o.deposit || o.amount), y: 0, fee: gas };
      return { o, title: 'Payout · ' + o.title, sub: o.sub + ' · delivered, buffer refunded', flow: -o.amount, y: 0, fee: f.fee + gas }; });
    const sgn = (n: any) => (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n));
    const stmtRows = stmtList.map((x: any) => ({ title: x.title, sub: x.sub, flow: sgn(x.flow), yieldF: x.y ? '+' + num(x.y) : '0.00', price: '0.00', inc: '0.00', fees: '−' + num(x.fee), debt: '0.00', onOpen: () => self.setState({ actTab: 'timeline', openOp: x.o.id }) }));
    const sumY = stmtList.reduce((a: any, x: any) => a + x.y, 0), sumF = stmtList.reduce((a: any, x: any) => a + x.fee, 0);
    const stmtSummary = [{ k: 'Cash yield · estimated', v: '+' + usd(sumY), color: '#3F6B3C' }, { k: 'Price change', v: '$0.00', color: '#1E2A22' }, { k: 'Incentives', v: '$0.00', color: '#1E2A22' }, { k: 'Fees paid', v: '−' + usd(sumF), color: '#8A5F25' }, { k: 'Debt remaining', v: '$0.00', color: '#1E2A22' }];
    const actTabs = [['timeline', 'Timeline'], ['statement', 'Statement']].map(([id, l]: any) => ({ label: l, bg: s.actTab === id ? '#fff' : 'transparent', shadow: s.actTab === id ? '0 1px 3px rgba(0,0,0,.08)' : 'none', onClick: () => self.setState({ actTab: id }) }));
    const PST: any = { pending: ['WAITING FOR YOU', '#F6EBDD', '#8A5F25'], approved: ['APPROVED FOR REVIEW', '#E2EAD6', '#3F6B3C'], rejected: ['REJECTED BY YOU', '#EEF0E8', '#5B6458'], refused: ['REFUSED BY ENGINE', '#F6E3DE', '#9A3F32'] };
    const setProp = (id: any, st: any) => self.setState({ proposals: s.proposals.map((p: any) => p.id === id ? { ...p, status: st } : p) });
    const proposals = s.proposals.map((p: any) => ({ ...p, stLabel: PST[p.status][0], stBg: PST[p.status][1], stColor: PST[p.status][2], isPending: p.status === 'pending',
      onReject: () => { setProp(p.id, 'rejected'); self.toastMsg('Proposal rejected. The agent is told why.'); }, onApprove: () => { setProp(p.id, 'approved'); self.openOp('supply', p.amount.toFixed(2)); } }));
    const protExposure = [s.rhea > 0 ? { k: 'Rhea USDC supply', sub: 'collateral off · withdrawable, liquidity-dependent', v: usd(s.rhea) } : null, !fresh ? { k: 'rNEAR', sub: 'priced by a Rhea pool', v: usd(26.5 * NP) } : null].filter(Boolean);
    const protSum = (s.rhea > 0 ? s.rhea : 0) + (!fresh ? 26.5 * NP : 0);
    const protExits = s.rhea > 0 ? [
      { k: 'Withdraw all USDC from Rhea', sub: 'back to your wallet in about one block · reserve unaffected', cost: '≈ $0.004', tag: 'Built · you approve', tagColor: '#3F6B3C' },
      { k: 'Withdraw half, keep watching', sub: num(s.rhea / 2) + ' USDC back now', cost: '≈ $0.004', tag: 'Built · you approve', tagColor: '#3F6B3C' },
      { k: 'Swap rNEAR to NEAR outside Rhea', sub: 'removes pool exposure · needs a swap leg', cost: '~0.2% · ' + usd(26.5 * NP * 0.002), tag: 'Preview', tagColor: '#8A5F25' },
      { k: 'Stay and monitor', sub: 'no cost now; risk depends on how the incident develops', cost: '$0.00', tag: 'Option', tagColor: '#8A9285' },
    ] : [{ k: 'Nothing to exit', sub: 'none of your positions are on the affected venue', cost: '$0.00', tag: '', tagColor: '#8A9285' }];
    const navItem = (id: any, label: any, icon: any, badge?: any) => { const a = s.screen === id; return { label, icon, badge: badge || '', badgeBg: badge ? '#F6EBDD' : 'transparent', bg: a ? '#E2EAD6' : 'transparent', color: a ? '#1E2A22' : '#4A5349', weight: a ? 600 : 400, bar: a ? '#4E7A4A' : 'transparent', go: () => self.go(id), mBg: a ? '#fff' : 'transparent', mBorder: a ? '#9DB48C' : '#DDE1D4', isLink: true, isStatic: false }; };
    const navStatic = (label: any, icon: any, badge: any) => ({ label, icon, badge, isLink: false, isStatic: true });
    const soonCount = sorted.filter((o: any) => days(o.due) <= s.lead).length;
    const crumbs: any = { overview: 'Observe / Overview', portfolio: 'Observe / Portfolio', calendar: 'Configure / Calendar', policy: 'Configure / Policy', strategies: 'Decide / Strategies', credit: 'Decide / Credit', pay: 'Execute / Pay on a date', activity: 'Account / Activity', replays: 'Account / Replays', roadmap: 'Roadmap', opps: 'Decide / Opportunities', protection: 'Execute / Protection' };
    const outcomes = [['success', 'Delivered'], ['expired', 'Quote expires'], ['refunded', 'Refunded'], ['stuck', 'Status unknown']].map(([k, label]: any) => { const on = pay && pay.outcome === k; return { label, bg: on ? '#2A4034' : '#fff', color: on ? '#fff' : '#4A5349', border: on ? '#2A4034' : '#DDE1D4', onClick: () => self.setState({ pay: { ...s.pay, outcome: k, expires: k === 'expired' && s.pay.step === 'quote' ? 8 : s.pay.expires } }) }; });
    const chunks = r.length > 20 ? r.match(/.{1,4}/g).join(' ') : r;

    let NG: any;
    const out: any = {
      navGroups: NG = [
        { n: '1', title: 'OBSERVE', items: [navItem('overview', 'Overview', '▦'), navItem('portfolio', 'Portfolio', '◎')] },
        { n: '2', title: 'CONFIGURE', items: [navItem('calendar', 'Calendar', '▤', soonCount ? soonCount + ' due' : ''), navItem('policy', 'Policy', '◇', polClean ? '' : 'unsaved')] },
        { n: '3', title: 'DECIDE', items: [navItem('strategies', 'Strategies', '◈'), navItem('credit', 'Credit', '◐', 'sim'), navItem('opps', 'Opportunities', '✧', 'P3')] },
        { n: '4', title: 'EXECUTE', items: [navItem('pay', 'Pay on a date', '↗'), navItem('protection', 'Protection', '⛉', 'P4')] },
        { n: '5', title: 'ACCOUNT', items: [navItem('activity', 'Activity', '◷'), navItem('replays', 'Replays', '↻')] },
        { n: '·', title: 'LATER', items: [navItem('roadmap', 'Roadmap', '→'), navStatic('Exchanges and perps', '⇄', 'P4'), navStatic('Cards', '▭', 'P5'), navStatic('Speculative sleeve', '◌', 'P7')] },
      ],
      ovMetrics, ovPositions, headline: this.props.headline || 'Your whole portfolio, one plan.', barSrc: judge ? 'Example figures · example workspace' : 'Observed USDC · wallets + Rhea · block 224067523',
      goPortfolio: () => self.go('portfolio'), goPay: () => self.go('pay'), tryRisky: () => self.setState({ screen: 'policy', test: { kind: 'supply', amount: '6000', asset: 'usdc', venue: 'rhea' } }),
      stressRows: stRows, stTotalF: usd(stTotal), stHp: hpv.toFixed(1), why, dismissWhy,
      isIntent: s.modal === 'intent', intent: I, intentRecips: intRecips, intentNew: I.rid === 'new', intentInvalid, intentBtnBg: intentInvalid ? '#B9C0B2' : '#2A4034',
      intentAddrMsg: !iAddr ? (I.chain === 'NEAR' ? 'NEAR account, e.g. name.near' : 'EVM address: 0x + 40 hex characters') : iAddrOk ? 'Valid ' + I.chain + ' address format' : 'Doesn’t match the ' + I.chain + ' address format', intentAddrColor: !iAddr ? '#8A9285' : iAddrOk ? '#3F6B3C' : '#9A3F32',
      intentNote: (I.save ? 'Saved to your calendar' + (I.repeats !== 'none' ? ', repeating ' + I.repeats : '') + '. Holdback rises by ' + usd(iAmt) + ' if it’s due within ' + s.horizon + ' days. ' : 'One-off: not added to your calendar. ') + 'Next you see every source compared; nothing moves until you approve each leg.',
      onIntent: { amount: setI('amount'), asset: setI('asset'), rid: setI('rid'), chain: setI('chain'), due: setI('due'), addr: setI('addr'), save: setI('save'), repeats: setI('repeats') },
      openIntent: () => { self.remember(); self.setState({ modal: 'intent', intent: null, asst: { ...s.asst, open: false } }); },
      submitIntent: () => { if (intentInvalid) return; const rcp = iRec ? iRec.recipient : iAddr; const nm = iRec ? iRec.name : short(iAddr);
        const ob: any = { id: 'i' + Date.now(), name: (I.save ? 'Pay ' : 'One-off · ') + nm, amount: iAmt, asset: I.asset, chain: I.chain, recipient: rcp, due: I.due, note: I.repeats !== 'none' ? 'Repeats ' + I.repeats : 'Added from Pay or move money', status: 'upcoming' };
        if (I.save) self.setState({ obs: [...s.obs, ob], version: s.version + 1, modal: null, screen: 'pay', payPick: ob.id }); else self.setState({ intents: [ob, ...(s.intents || [])], modal: null, screen: 'pay', payPick: ob.id });
        self.refocus(); },
      onb, watchDraft: s.watchDraft, onWatchDraft: (e: any) => self.setState({ watchDraft: e.target.value }),
      connectFirst: () => { if (s.ws === 'live') return self.liveCall(() => self.props.actions.connect());  const first = s.ds === 'empty' && s.ws === 'live' && s.wallet === 0; self.setState({ connected: true, ...(first ? { wallet: 4200 } : {}) }); self.toastMsg(first ? 'Connected ' + LIVE_ACC + '. Read 4,200.00 USDC (example read).' : 'Connected ' + LIVE_ACC + '.'); },
      finishFirstRun: () => { if (onb.notReady) return; self.setState({ firstRun: false, screen: 'portfolio', pfDate: s.obs[0] ? s.obs[0].id : 'now' }); },
      goOverview: () => self.go('overview'),
      pfHas: HD.length > 0, pfEmpty: HD.length === 0, stratHas: total > 0, stratEmpty: total <= 0, creditHas: !fresh, creditEmpty: fresh,
      actTabs, actTimeline: s.actTab !== 'statement', actStatement: s.actTab === 'statement', stmtRows, stmtSummary,
      proposals, revokeAgent: () => self.toastMsg('Revoking deletes the agent’s function-call key. In this preview nothing is sent on-chain.'),
      isOpps: s.screen === 'opps', isProt: s.screen === 'protection', protExposure, protTotal: usd(protSum), protExits, protNone: s.rhea <= 0,
      requestExit: () => s.rhea > 0 && self.openOp('withdraw', s.rhea.toFixed(2)),
      isPolicy: s.screen === 'policy', isPay: s.screen === 'pay', isReplays: s.screen === 'replays', isRoadmap: s.screen === 'roadmap',
      layerEyebrow: EB[s.screen] || '', judge, dataTag: judge ? 'EXAMPLE WORKSPACE' : 'LIVE READS · MAINNET', dataTagBg: judge ? '#F6EBDD' : '#E2EAD6', dataTagColor: judge ? '#8A5F25' : '#3F6B3C',
      toggleJudge: () => self.setWorkspace(judge ? 'live' : 'demo'), leaveDemo: () => self.setWorkspace('live'), replayOn: !!s.replay, acc: ACC, todayLabel: dlabel(iso(0)), goPolicy: () => self.go('policy'), judgeBg: judge ? '#F6EBDD' : '#fff', judgeBorder: judge ? '#EBD9BF' : '#E3E6DB', judgeTrack: judge ? '#8A5F25' : '#CDD3C2', judgeKnob: judge ? '14px' : '2px',
      netLabel: judge ? 'Example workspace · no wallet' : s.connected ? 'Mainnet · wallet connected' : 'Not connected · read only', netColor: judge ? '#8A5F25' : s.connected ? '#4E7A4A' : '#8A9285',
      navFlat: NG.flatMap((g: any) => g.items).filter((n: any) => n.isLink), isMobile: L === 'm', notMobile: L !== 'm', shellDir: L === 'm' ? 'column' : 'row', asideW: L === 'r' ? '76px' : '264px', asidePadX: L === 'r' ? '12px' : '18px', lblDisp: L === 'r' ? 'none' : 'block', fullFlex: L === 'r' ? 'none' : 'flex', railDivider: L === 'r' ? 'block' : 'none', navJustify: L === 'r' ? 'center' : 'flex-start', padX: L === 'm' ? '16px' : L === 'r' ? '24px' : '44px', padTop: L === 'm' ? '24px' : '40px',
      wsName: s.ws === 'demo' ? 'Example workspace' : 'Personal workspace', wsRole: s.ws === 'demo' ? 'Demo Mode · no wallet' : s.connected ? 'Owner · can approve' : 'Read only · not connected', wsInitial: s.ws === 'demo' ? 'E' : 'P', wsInitBg: s.ws === 'demo' ? '#F6EBDD' : '#E2EAD6',
      wsMenuOpen: s.menu === 'ws', wsMenuLeft: L === 'm' ? '16px' : L === 'r' ? '84px' : '18px', wsMenuTop: L === 'm' ? '58px' : L === 'r' ? '64px' : '136px',
      toggleWsMenu: () => { self.remember(); self.setState({ menu: s.menu === 'ws' ? null : 'ws' }); }, closeMenu: () => self.closeMenu(),
      wsItems: [['live', 'Personal workspace', 'Your wallet · live reads'], ['demo', 'Example workspace', 'Demo Mode · example data, no wallet']].map(([id, t, d]: any) => ({ t, d, check: s.ws === id ? '✓' : '', onClick: () => self.setWorkspace(id) })),
      acctLabel: s.ws === 'demo' ? DEMO_ACC : s.connected ? LIVE_ACC : 'Connect wallet', acctMenuOpen: s.menu === 'acct', toggleAcct: () => { self.remember(); self.setState({ menu: s.menu === 'acct' ? null : 'acct' }); },
      acctMenuNote: s.ws === 'demo' ? 'Example account · no real wallet' : s.connected ? 'Signed in on NEAR mainnet' : 'No wallet connected',
      acctItems: s.ws === 'demo' ? [{ label: 'Copy example address', color: '#1E2A22', onClick: () => { try { navigator.clipboard.writeText(DEMO_ACC); } catch (e) {} self.closeMenu(); self.toastMsg('Copied ' + DEMO_ACC + '. It is an example account.'); } }, { label: 'Leave example workspace', color: '#1E2A22', onClick: () => self.setWorkspace('live') }]
        : s.connected ? [{ label: 'Switch wallet', color: '#1E2A22', onClick: () => { self.closeMenu(); self.toastMsg('MyNearWallet or Meteor would open to pick another account. Prepared actions would be cancelled.'); } }, { label: 'Copy address', color: '#1E2A22', onClick: () => { try { navigator.clipboard.writeText(LIVE_ACC); } catch (e) {} self.closeMenu(); self.toastMsg('Copied ' + LIVE_ACC + '.'); } }, { label: 'Disconnect', color: '#9A3F32', onClick: () => { self.setState({ menu: null, connected: false }); self.toastMsg('Disconnected. Balances stay visible; nothing can be approved.'); } }]
        : [{ label: 'Connect wallet', color: '#3F6B3C', onClick: () => { self.setState({ menu: null, connected: true }); self.toastMsg('Connected ' + LIVE_ACC + ' through MyNearWallet.'); } }],
      walletApprove: () => (s.connected || s.ws === 'demo') ? wallet.onApprove() : self.toastMsg('Connect a wallet first. Nothing was signed.'),
      isConfirm: s.modal === 'confirm', confirmText: s.confirm ? s.confirm.text : '',
      confirmYes: () => { const c = s.confirm; if (c) setDraft((d: any) => { if (!d.assets.eth.uses.includes(c.u)) d.assets.eth.uses.push(c.u); return d; }); self.setState({ modal: null, confirm: null }); self.refocus(); self.toastMsg('ETH protection removed in your draft. Save the revision to apply it.'); },
      footLabel: judge ? 'Example workspace · replays from recorded responses' : 'Observed mainnet data · block 224067523',
      goReplays: () => self.go('replays'), goRoadmap: () => self.go('roadmap'),
      pfDateTabs, pfDlUpper: pfDl.toUpperCase(), pfStake, pfStakeNote,
      polRev: P.rev, polNextRev: P.rev + 1, polD: D, polClean, polSave, polAssets, polVenues, revisions: s.revisions,
      onPerAction: setLim('perAction'), onDaily: setLim('daily'), onMaxMove: setLim('maxMove'),
      polUsedLabel: usd(P.used) + ' of ' + usd(D.daily), polUsedPct: Math.min(100, P.used / Math.max(1, D.daily) * 100) + '%', polHoldLabel: 'Reserve ' + usd(s.reserve) + ' · ' + inH.length + ' payments held back',
      polBorrowLabel: D.borrow ? 'Allowed to propose · tap to turn off' : 'Off · tap to allow proposals',
      toggleBorrow: () => setDraft((d: any) => { d.borrow = !d.borrow; return d; }),
      savePolicy: () => { if (polClean) return; const rev = P.rev + 1; const np: any = { ...clone(D), rev }; self.setState({ pol: np, polDraft: clone(np), revisions: [{ rev, when: 'Nov 12 · just now', what: diffs.join(' · ') }, ...s.revisions] }); self.toastMsg('Policy saved as revision ' + rev + '. Actions prepared under rev ' + P.rev + ' must be re-checked.'); },
      test: T, onTest: { kind: setT('kind'), amount: setT('amount'), asset: setT('asset'), venue: setT('venue') }, testRows: tc, testVerdict, testAgainst: polClean ? 'Checked against revision ' + P.rev : 'Checked against your unsaved draft',
      hasPy: !!pyOb, noPy: !pyOb, pyTabs, pyPlans, pyChecks, pyHead,
      stkSub: 'Idle NEAR 42.10 · 0.50 kept as exit reserve · max 41.60', stkAmt: s.stk.amt, onStkAmt: (e: any) => self.setState({ stk: { ...s.stk, amt: e.target.value } }), stkTabs, stakeCards, stkDueUpper: stDl.toUpperCase(), lead: s.lead,
      replays, roadmap, stretch,
      asstOpen: !!s.asst.open, asstEmpty: s.asst.msgs.length === 0, asstHasMsgs: s.asst.msgs.length > 0, asstMsgs, asstSuggest, asstChips, asstInput: s.asst.input,
      openAssistant: () => { self.remember(); self.setState({ asst: { ...s.asst, open: true } }); }, closeAssistant: () => self.closeAsst(),
      onAsstInput: (e: any) => self.setState({ asst: { ...s.asst, input: e.target.value } }), asstSend: () => self.ask(s.asst.input), onAsstKey: (e: any) => { if (e.key === 'Enter') self.ask(s.asst.input); },
      crumb: crumbs[s.screen], planLabel: 'Plan v' + s.version + ' · updated today', version: s.version, nextVersion: s.version + 1, horizon: s.horizon, horizonEnd: dlabel(new Date(TODAY + s.horizon * 864e5).toISOString().slice(0, 10)),
      isOverview: s.screen === 'overview', isCalendar: s.screen === 'calendar', isStrategies: s.screen === 'strategies', isActivity: s.screen === 'activity', isPortfolio: s.screen === 'portfolio', isCredit: s.screen === 'credit',
      showOnboarding: !!s.firstRun, showPlanView: !s.firstRun,
      ob1Bg: (s.reserveSet ?? s.reserve > 0) ? '#F4F7EE' : '#fff', ob1DotBg: (s.reserveSet ?? s.reserve > 0) ? '#4E7A4A' : '#EEF0E8', ob1DotColor: (s.reserveSet ?? s.reserve > 0) ? '#fff' : '#5B6458', ob1Glyph: (s.reserveSet ?? s.reserve > 0) ? '✓' : '1',
      reserveDraft: s.reserveDraft, onReserveDraft: (e: any) => self.setState({ reserveDraft: e.target.value }),
      saveReserve: () => { const v = parseFloat(s.reserveDraft) || 0; if (s.ws === 'live') return self.liveCall(() => self.props.actions.savePlan({ reserve: String(s.reserveDraft).trim() }), 'Reserve floor set to ' + usd(v) + '.'); self.setState({ reserve: v, planDraft: { ...s.planDraft, reserve: String(v) }, version: s.version + 1 }); self.toastMsg('Reserve floor set to ' + usd(v) + '.'); },
      rec, metrics, bar, strip, upcoming, positions, obsCountLabel: inH.length + ' payments · ' + usd(obsSum) + ' held back',
      obGroups, noObs: s.obs.length === 0,
      planDraft: pd, onPlanReserve: setPd('reserve'), onPlanHorizon: setPd('horizon'), onPlanLead: setPd('lead'),
      holdbackDraftF: usd(holdbackDraft), holdbackCountDraft: hbDraftObs.length, planClean, savePlanBg: planClean ? '#B9C0B2' : '#2A4034',
      savePlan: () => { self.setState({ reserve: parseFloat(pd.reserve) || 0, horizon: +pd.horizon, lead: +pd.lead, version: s.version + 1 }); self.toastMsg('Plan saved as v' + (s.version + 1) + '. Earlier drafts were superseded.'); },
      cmpAmount: cmpStr, onCmpAmount: (e: any) => self.setState({ cmpAmount: e.target.value }), cmpTabs, cmpDays, cmpDue: dlabel(cmpOb.due), cmpDueUpper: dlabel(cmpOb.due).toUpperCase(), strategies, walletSurplusF: usd(walletSurplus),
      openWithdrawDefault: () => self.openOp('withdraw', '1000'),
      ops, noOps: ops.length === 0, legend,
      pfBalances, pfAccounts, pfRows, credit, sliders, creditUses, creditPrio,
      goCalendar: () => self.go('calendar'), goStrategies: () => self.go('strategies'),
      goActivityClose: () => self.endModal({ screen: 'activity' }),
      openAdd: () => { self.remember(); self.setState({ modal: 'add', form: { name: '', amount: '', chain: 'Arbitrum', token: 'USDC', recurrence: 'none', recipient: '', due: iso(13), note: '', confirmed: false } }); },
      closeModal: () => self.endModal(), stop: (e: any) => e.stopPropagation(),
      modalOpen: !!s.modal, m, wallet,
      isAdd: s.modal === 'add', form: f, onForm: { name: setF('name'), amount: setF('amount'), chain: setF('chain'), due: setF('due'), recipient: setF('recipient'), note: setF('note'), confirmed: setF('confirmed'), token: setF('token'), recurrence: setF('recurrence') },
      addrPlaceholder: evm ? '0x…' : 'name.near', addrValid: !!addrValid, addrMsg, addrMsgColor: !r ? '#8A9285' : addrValid ? '#3F6B3C' : '#9A3F32', addrBorder: !r ? '#DDE1D4' : addrValid ? '#9DB48C' : '#E0B4A8',
      addrChunks: chunks, addrEnds: r.length > 10 ? r.slice(0, 6) + ' … ' + r.slice(-4) : r, impact, formInvalid, saveObBg: formInvalid ? '#B9C0B2' : '#2A4034',
      saveOb: () => { if (formInvalid) return; const ob: any = { id: 'u' + Date.now(), name: f.name.trim(), amount: fAmt, chain: f.chain, recipient: r, due: f.due, note: f.note, status: 'upcoming' }; self.setState({ obs: [...s.obs, ob], modal: null, version: s.version + 1 }); self.toastMsg(ob.name + ' added. Plan is now v' + (s.version + 1) + '; earlier drafts were superseded.'); },
      op: s.op || { amount: '', ack: false }, opv, opIsSupply: s.op && s.op.kind === 'supply', opIsWithdraw: s.op && s.op.kind === 'withdraw',
      isOpReview: s.modal === 'op' && s.op && s.op.step === 'review', isOpPrepared: s.modal === 'op' && s.op && s.op.step === 'prepared', isOpTracking: s.modal === 'op' && s.op && s.op.step === 'tracking',
      onOpAmount: (e: any) => self.setState({ op: { ...s.op, amount: e.target.value } }), onOpAck: (e: any) => self.setState({ op: { ...s.op, ack: e.target.checked } }),
      opMax: () => self.setState({ op: { ...s.op, amount: (s.op.kind === 'supply' ? supplyMax : s.rhea).toFixed(2) } }),
      opPrepare: () => self.setState({ op: { ...s.op, step: 'prepared' } }), opBack: () => self.setState({ op: { ...s.op, step: 'review' } }), opToWallet: () => self.setState({ op: { ...s.op, step: 'wallet' } }),
      exitRows: [
        { k: 'Rhea available liquidity now', v: '1,428,310.55 USDC', src: 'Capped by protocol token cash · Rhea view · 18:24:05', color: '#1E2A22', retryDisplay: 'none', onRetry: () => {} },
        { k: 'Withdrawable today from this position', v: 'All of it', src: 'Same computation as withdrawal preflight', color: '#3F6B3C', retryDisplay: 'none', onRetry: () => {} },
        { k: 'Return-to-cash to ' + cmpOb.chain + ' (' + dlabel(cmpOb.due) + ')', v: usd(rtc) + ' fee · ' + (FEES[cmpOb.chain] || NOFEE).time, src: 'Dry exact-output quote · 18:24:07 · buffer ' + usd((FEES[cmpOb.chain] || NOFEE).buf) + ' refundable, shown separately', color: '#1E2A22', retryDisplay: 'none', onRetry: () => {} },
        { k: 'Collateral', v: 'Off · your reserve can never be liquidated', src: 'Supplied USDC is not pledged', color: '#3F6B3C', retryDisplay: 'none', onRetry: () => {} },
      ],
      wdChecks: [
        { glyph: '✓', color: '#4E7A4A', k: 'Collateral and debt on this position', v: 'None' },
        { glyph: '✓', color: '#4E7A4A', k: 'Rhea available liquidity', v: '1,428,310.55 USDC' },
        { glyph: '✓', color: '#4E7A4A', k: 'Arrives as', v: 'native USDC · ' + ACC + '' },
        { glyph: '◷', color: '#8A5F25', k: 'Timing', v: 'Unverified · usually 1 block' },
      ],
      payConfirm: s.modal === 'pay' && !wallet.show && pay && pay.step === 'confirm', paySources: s.modal === 'pay' && !wallet.show && pay && pay.step === 'sources',
      payQuote: s.modal === 'pay' && !wallet.show && pay && pay.step === 'quote', payTracking: s.modal === 'pay' && pay && pay.step === 'tracking', pv,
      payToSources: () => self.setState({ pay: { ...pay, step: 'sources' } }),
      payBack: () => self.setState({ pay: { ...pay, step: pay.step === 'quote' ? 'sources' : 'confirm' } }),
      payRecheck: () => self.toastMsg('Still unknown at 18:38. Checking again every 30 s; nothing will be re-sent.'),
      showOutcome: s.modal === 'pay' && pay && !pay.final, outcomes,
      hasToast: !!s.toast, toast: s.toast,
      watchOpen: !!s.watchOpen, toggleWatch: () => self.setState({ watchOpen: !s.watchOpen, screen: s.screen }), pfStakeHead: 'aurora.pool.near · native', asstTag1: 'NEAR AI CLOUD · PRIVATE INFERENCE', asstTag2: 'EXAMPLE RESPONSES', replaysIntro: 'Each replay runs the real flow against a recorded 1Click, Rhea or RPC response. Nothing is signed or sent, and results appear in Activity labeled as replays.', creditPermNote: 'Read from policy rev ' + s.pol.rev + '. Change them in Policy.', stratEmptyTitle: 'No surplus to put to work yet.', stratEmptyBody: 'Once your reserve and dated payments are covered, whatever is left shows up here, ranked by what it nets by your next payment date.', stratEmptyCta: 'Finish your plan', stratEmptyAction: () => self.go('overview'), creditEthLine: '0.62 ETH · $2,000.00 · example price, 18:24', planMoveCost: usd(s.pol.maxMove) + ' per move', planBorrowLabel: s.pol.borrow ? 'Allowed to propose · preview only' : 'Off · needs verification', planRheaLabel: (s.pol.venues.rhea ? '✓ ' : '') + 'Rhea Lending · USDC',
    };
    if (!LV) return out;
    out.dialogLabel = ({ intent: 'Pay or move money', add: 'Add a payment', op: s.op && s.op.kind === 'replay' ? 'Replay' : s.op && s.op.kind === 'withdraw' ? 'Withdraw USDC from Rhea' : 'Supply USDC to Rhea', pay: 'Pay on a date', confirm: (s.confirm && s.confirm.title) || 'Confirm', wallet: 'Wallet' } as any)[s.modal] || 'FlowVault dialog';
    const lctx = { self, s, example: s.ws === 'demo' };
    return { ...out, ...liveVals(LV, out, lctx), ...liveConfigure(LV, out, lctx), ...liveDecide(LV, out, lctx), ...liveExecute(LV, out, lctx), ...livePreviews(LV, out, lctx) };
  }
  render() {
    return <Shell v={this.renderVals()} />;
  }
}
