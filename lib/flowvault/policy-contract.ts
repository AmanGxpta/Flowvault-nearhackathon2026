// P2: the optional FlowVault policy contract id (server setting FLOWVAULT_POLICY_CONTRACT). Unset means
// not deployed; nothing on-chain records or limits an action then, and the API says so.
export function policyContractId(read: (name: string) => unknown): string | null {
  const v = read("FLOWVAULT_POLICY_CONTRACT");
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
