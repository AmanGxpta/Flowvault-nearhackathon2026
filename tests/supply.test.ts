import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareSupply } from "../lib/flowvault/supply.ts";
import type { SupplyState } from "../lib/flowvault/supply.ts";
const state = (): SupplyState => ({
  accountId: "example.near",
  mode: "Running",
  canDeposit: true,
  decimals: 6,
  walletUsdc: "1000000000",
  nativeAmount: "1000000000000000000000000",
  storageUsage: 1000,
  registered: true,
  registrationMinimum: "100000000000000000000000",
  reserve: "100",
});
test("Supply preparation uses six-decimal token amounts, one yocto and no collateral message", () => {
  const p = prepareSupply(state(), "12.345678");
  const tx = p.transactions[0];
  assert.equal(tx.actions[0].params.methodName, "ft_transfer_call");
  assert.equal(tx.actions[0].params.deposit, "1");
  assert.deepEqual(tx.actions[0].params.args, {
    receiver_id: "contract.main.burrow.near",
    amount: "12345678",
    msg: "",
  });
  assert.equal(p.collateral, false);
});
test("An unregistered account gets the observed registration minimum before supply", () => {
  const s = state();
  s.registered = false;
  const p = prepareSupply(s, "100");
  assert.equal(p.transactions.length, 2);
  assert.equal(
    p.transactions[0].actions[0].params.deposit,
    s.registrationMinimum,
  );
});
test("Protocol pause or disabled supply blocks preparation", () => {
  assert.throws(
    () => prepareSupply({ ...state(), mode: "Paused" }, "1"),
    /Running/,
  );
  assert.throws(
    () => prepareSupply({ ...state(), canDeposit: false }, "1"),
    /enabled/,
  );
});
test("Token precision changes cannot silently change the supplied amount", () =>
  assert.throws(
    () => prepareSupply({ ...state(), decimals: 18 }, "1"),
    /precision/,
  ));
test("A supply cannot consume the cash reserve", () =>
  assert.throws(() => prepareSupply(state(), "950"), /reserve floor/));
test("Attached gas balance respects account storage and registration", () =>
  assert.throws(
    () =>
      prepareSupply(
        { ...state(), nativeAmount: "10000000000000000000000" },
        "1",
      ),
    /spendable NEAR/,
  ));
