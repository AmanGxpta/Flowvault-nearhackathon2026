import type { Metadata } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./fv.css";
export const metadata: Metadata = {
  title: "FlowVault — Capital, with a plan",
  description:
    "A capital workspace for cash needs, approved earning strategies and cross-chain cash requests.",
  icons: { icon: "/favicon.svg" },
};
const THEME_BOOT =
  'try{var t=localStorage.getItem("fv-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}';
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply a saved light/dark choice before first paint (ThemeToggle writes it). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
