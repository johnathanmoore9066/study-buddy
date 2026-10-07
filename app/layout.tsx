import type { Metadata } from "next";
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  Bodoni_Moda,
} from "next/font/google";
import "./globals.css";

const display = Bodoni_Moda({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-bodoni",
  display: "swap",
});

// Next has no metric overrides for the Atkinson families yet, so name the
// fallbacks directly instead of letting it try to generate adjusted ones.
const text = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Segoe UI", "Helvetica", "Arial", "sans-serif"],
});

const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-atkinson-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Consolas", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "Aster · Socratic study companion",
  description:
    "A study companion that helps you build the answer and map what you learn.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${text.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  // untitled-ignore
  );
}
