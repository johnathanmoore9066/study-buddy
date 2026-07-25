import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aster — Socratic study companion",
  description:
    "A study companion that helps you build the answer and map what you learn.",
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
