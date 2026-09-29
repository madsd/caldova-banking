import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caldova — Agentic finance",
  description:
    "A customer-controlled agentic banking experience powered by Microsoft Foundry.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
