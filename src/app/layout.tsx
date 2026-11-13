import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "RECON",
  description: "Payment reconciliation findings (synthetic demo data only).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
