// Maps the design's literal colours to theme variables so dark mode can restyle them.
// Light values equal the design's exact hex colours (app/fv.css).
const KNOWN = new Set<string>(["111144","1E2A22","1F2A24","22352A","26392E","2A4034","2B4233","2F552D","3F5A7A","3F6B3C","4A5349","4E7A4A","5B4F8A","5B6458","5E2419","6B5E99","6E4A1A","6E9A5E","6F786B","7A521E","7F3528","8A5F25","8A9285","93A68B","9A3F32","9AA195","9DB48C","A0A79A","A9BDA0","B4543F","B9C0B2","C08A45","C9D5E4","C9D6C1","C9D9BF","C9E86B","CDD3C2","CDD6C1","D5DACB","D5DEC8","D6EF86","D8B98F","D9DDCF","DCE4D0","DDBDB4","DDC6A4","DDE1D4","DFE7D2","E0B4A8","E0E3D7","E2E5DA","E2EAD6","E3E6DB","E5EADC","E6E8DF","E7ECF3","E8EBE1","E9EEDF","EAF0E2","EBCFC8","EBD9BF","ECE8F4","EEF0E8","EEF3F9","F1F2EB","F3F4EE","F4ECE9","F4F5EF","F4F7EE","F6E3DE","F6EBDD","F6F6F1","F7F8F3","FBF6EE","FFF6E8","FFFFFF"]);
const HEX = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
function norm(h: string) {
  let x = h.slice(1).toUpperCase();
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  return x;
}
/** Theme a runtime style value. `role` is fg for text, fill and stroke; bg for surfaces and borders. */
export function tc(value: unknown, role: "fg" | "bg"): string {
  if (typeof value !== "string") return value === undefined || value === null ? "" : String(value);
  return value.replace(HEX, (m) => {
    const k = norm(m);
    return KNOWN.has(k) ? `var(--fv${role === "fg" ? "c" : "b"}-${k})` : m;
  });
}
