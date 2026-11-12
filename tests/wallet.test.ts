import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { assertWalletSigner } from "../lib/flowvault/wallet-guards.ts";
import { patchMeteorSource } from "../scripts/patch-meteor-sdk.mjs";
test("The shared signer boundary for both helpers requires matching selector and wallet accounts on mainnet", () => {
  assert.doesNotThrow(() =>
    assertWalletSigner(
      "mainnet",
      "owner.near",
      [{ accountId: "other.near" }, { accountId: "owner.near" }],
      "owner.near",
    ),
  );
  assert.throws(
    () =>
      assertWalletSigner(
        "testnet",
        "owner.near",
        [{ accountId: "owner.near" }],
        "owner.near",
      ),
    /mainnet/,
  );
  assert.throws(
    () =>
      assertWalletSigner(
        "mainnet",
        "other.near",
        [{ accountId: "owner.near" }],
        "owner.near",
      ),
    /account changed/,
  );
  assert.throws(
    () =>
      assertWalletSigner(
        "mainnet",
        "owner.near",
        [{ accountId: "other.near" }],
        "owner.near",
      ),
    /account changed/,
  );
  assert.throws(
    () => assertWalletSigner("mainnet", null, [], "owner.near"),
    /account changed/,
  );
  assert.throws(
    () => assertWalletSigner("mainnet", "owner.near", [], "owner.near"),
    /account changed/,
  );
  assert.throws(
    () =>
      assertWalletSigner(
        "mainnet",
        "owner.near",
        [{ accountId: "owner.near" }],
        "",
      ),
    /account changed/,
  );
});
test("Meteor SDK ESM/CJS key-log patch is installed, hash-checked, idempotent and refuses unreviewed code", () => {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("@meteorwallet/sdk/package.json"));
  const manifest = JSON.parse(
    readFileSync(
      new URL("../scripts/vendor/meteor-sdk-patch.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version,
    manifest.version,
  );
  for (const entry of manifest.files) {
    const source = readFileSync(resolve(root, entry.path), "utf8");
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      entry.patchedSha256,
    );
    assert(!source.includes("console.log(accessKey)"));
    assert.equal(patchMeteorSource(source, entry), source);
    const original = source.replace(
      "/* FlowVault: never log a wallet connection key. */",
      "console.log(accessKey);",
    );
    assert.equal(patchMeteorSource(original, entry), source);
    assert.throws(
      () => patchMeteorSource(source + "\n// changed", entry),
      /bytes changed/,
    );
  }
});
