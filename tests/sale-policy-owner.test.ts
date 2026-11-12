import {test} from "node:test";
import assert from "node:assert/strict";
import {canWriteSalePermissions,requireSalePermissionOwner} from "../lib/flowvault/sale-policy-owner.ts";
test("sale policy requires authenticated matching NEAR workspace owner",()=>{
 const s={slot:"personal",account:"owner.near",workspace:{mode:"live",accountId:"owner.near"}};
 assert.equal(canWriteSalePermissions(s),true);
 for(const denied of [{...s,account:null},{...s,account:"other.near"},{...s,workspace:{mode:"live",accountId:null}},{...s,slot:"example"}]) {
  assert.equal(canWriteSalePermissions(denied),false);
  assert.throws(()=>requireSalePermissionOwner(denied),/Connect and sign in/);
 }
});
