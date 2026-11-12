import type { Metadata } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./fv.css";
export const metadata: Metadata = {
  title: "FlowVault — Capital, with a plan",
  description:
    "A capital workspace for cash needs, approved earning strategies and cross-chain cash requests.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
