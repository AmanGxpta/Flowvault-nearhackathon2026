/** Saved browser accounts are not authentication; only the NEAR session owns sale permissions. */
export function canWriteSalePermissions(s:{slot:string;account:string|null;workspace:{mode:string;accountId:string|null}}):boolean {
  return s.slot==="personal"&&s.workspace.mode==="live"&&!!s.workspace.accountId&&s.account===s.workspace.accountId;
}
export function requireSalePermissionOwner(s:Parameters<typeof canWriteSalePermissions>[0]):void {
  if(!canWriteSalePermissions(s))throw new Error("Connect and sign in to your workspace’s NEAR account before saving sale permissions.");
}
