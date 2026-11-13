import {test} from "node:test";
import assert from "node:assert/strict";
import {holderVaultAlerts,type MonitoredVault} from "../lib/flowvault/holder-vault-alerts.ts";
import {reconcile} from "../lib/flowvault/monitor-store.ts";
const now=1_000_000;
const v:MonitoredVault={contractId:"vault.near",config:{max_nav_age_ms:"180000",capacity_raw:"100"},nav:{nav_raw:"90",pending_deposits_raw:"10",liquid_assets_raw:"10",report:{observed_at_ms:"1"},report_required:false,busy:null,unresolved:{kind:"supply"},reasons:[]},requests:[{kind:"redemption",status:"queued",not_before_ms:"1",claimable_raw:"0"}]};
test("vault monitor emits stable distinct NAV, unresolved, backlog and capacity warnings",()=>{
 const rows=holderVaultAlerts([v],now);assert.equal(rows.length,4);assert.equal(rows.find(r=>r.dedupeKey.endsWith(":operation"))?.severity,"urgent");assert.ok(rows.every(r=>r.kind==="vault_attention"));assert.deepEqual(rows,holderVaultAlerts([v],now));
});
test("failed vault read preserves alerts; successful clear resolves only vault group",()=>{
 const candidates=holderVaultAlerts([v],now);
 const existing=reconcile([],candidates,["vaults"],"now",k=>k).upserts;
 assert.equal(reconcile(existing,[],["plans"],"later",k=>k).resolves.length,0);
 assert.equal(reconcile(existing,[],["vaults"],"later",k=>k).resolves.length,4);
 const clear={...v,requests:[],nav:{...v.nav,nav_raw:"1",pending_deposits_raw:"0",report:{observed_at_ms:String(now)},unresolved:null}};
 assert.equal(holderVaultAlerts([clear],now).length,0);
});
