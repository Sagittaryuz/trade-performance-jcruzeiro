import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade Performance | J. Cruzeiro",
  description: "Business Intelligence da performance comercial da J. Cruzeiro.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/j-cruzeiro-logo.png",
    shortcut: "/j-cruzeiro-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
