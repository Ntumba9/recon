import type { ReactNode } from "react";

export const metadata = {
  title: "RECON",
  description: "Payment reconciliation findings (synthetic demo data only).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f7f7f8", color: "#1a1a1a" }}>
        {children}
      </body>
    </html>
  );
}
