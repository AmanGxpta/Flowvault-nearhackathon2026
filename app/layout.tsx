import type { Metadata } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./fv.css";
export const metadata: Metadata = {
  title: "FlowVault — Capital, with a plan",
  description:
    "A capital workspace for cash needs, approved earning strategies and cross-chain cash requests.",
  icons: { icon: "/favicon.svg" },
};
// Light unless the owner picked dark with the toggle: the system preference is not followed.
const THEME_BOOT =
  'var t="light";try{if(localStorage.getItem("fv-theme")==="dark")t="dark"}catch(e){}document.documentElement.setAttribute("data-theme",t)';
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body>
        {/* Apply the theme before first paint: light, or dark when it was picked with the toggle (ThemeToggle writes it). It runs as the first thing
            in <body>, before any content, and lives outside <head> because wallet extensions inject scripts there
            before hydration, which made React match this script against theirs. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}
      </body>
    </html>
  );
}
