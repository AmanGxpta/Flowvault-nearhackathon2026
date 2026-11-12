/** Applies to every selector module: neither selector state nor a wallet account list suffices alone. */
export function assertWalletSigner(
  networkId: string,
  activeAccountId: string | null,
  accounts: { accountId: string }[],
  preparedAccountId: string,
) {
  if (networkId !== "mainnet")
    throw new Error("Connect a NEAR mainnet wallet.");
  if (
    !preparedAccountId ||
    activeAccountId !== preparedAccountId ||
    !accounts.some((a) => a.accountId === preparedAccountId)
  )
    throw new Error(
      "Your wallet account changed. Reconnect the prepared account.",
    );
}
