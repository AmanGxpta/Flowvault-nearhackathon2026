/** Integers at protocol precision. Never route financial amounts through JS floats. */
export function units(value: string, decimals = 6): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error("Enter a positive decimal amount.");
  const [whole, frac = ""] = value.split(".");
  if (frac.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places.`);
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(frac.padEnd(decimals, "0"));
  if (result > 10n ** 38n) throw new Error("Amount exceeds supported range.");
  return result;
}
export function decimal(value: bigint, decimals = 6): string {
  const negative = value < 0n;
  const n = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = (n % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${n / scale}${fraction ? "." + fraction : ""}`;
}
export function positive(value: string, decimals = 6): bigint {
  const n = units(value, decimals);
  if (n <= 0n) throw new Error("Amount must be greater than zero.");
  return n;
}
export function carry(principal: bigint, apr: string, days: number): bigint {
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("Horizon must be between 1 and 3,650 days.");
  const rate = units(
    apr.includes(".")
      ? apr.split(".")[0] + "." + apr.split(".")[1].slice(0, 12)
      : apr,
    12,
  );
  return (principal * rate * BigInt(days)) / (365n * 10n ** 12n);
}
/** Converts lending inner units (6 + extraDecimals) to native 6-decimal USDC base units.
 * Assets round down; debt rounds up so an obligation is never under-reported. */
export function innerToNative(
  inner: bigint,
  extraDecimals: number,
  roundUp = false,
): bigint {
  if (!Number.isInteger(extraDecimals) || extraDecimals < 0 || extraDecimals > 32)
    throw new Error("Lending extra_decimals is unavailable or invalid.");
  const scale = 10n ** BigInt(extraDecimals);
  return roundUp ? (inner + scale - 1n) / scale : inner / scale;
}
