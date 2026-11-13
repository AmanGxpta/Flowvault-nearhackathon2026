import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPendingOutflows } from "../lib/flowvault/pending-outflows.ts";

test("a verified, not-yet-finalized deposit leaves the matching wallet position at once", () => {
  const positions: { id: string; asset: string; chain: string; amount: string; accountId: string; kind: string; pendingOutflow?: string }[] = [
    { id: "eth-usdc-a", asset: "USDC", chain: "eth", amount: "15.399542", accountId: "0x32E54827dca55754ea9cc1cc8455b2b6a7be004a", kind: "wallet" },
    { id: "eth-usdc-b", asset: "USDC", chain: "eth", amount: "3", accountId: "0x1ed73ee055b7b5379ccd398748281c5a82e9a41e", kind: "wallet" },
    { id: "base-usdc-a", asset: "USDC", chain: "base", amount: "1", accountId: "0x32e54827dca55754ea9cc1cc8455b2b6a7be004a", kind: "wallet" },
  ];
  const out = applyPendingOutflows(positions, [{ chain: "eth", accountId: "0x32e54827dca55754ea9cc1cc8455b2b6a7be004a", asset: "USDC", amountRaw: "5000000", decimals: 6 }]);
  assert.equal(out[0].amount, "10.399542");
  assert.equal(out[0].pendingOutflow, "5");
  assert.equal(out[1].amount, "3");
  assert.equal(out[2].amount, "1");
  const drained = applyPendingOutflows(positions, [{ chain: "eth", accountId: positions[1].accountId, asset: "USDC", amountRaw: "9000000", decimals: 6 }]);
  assert.equal(drained[1].amount, "0");
});
