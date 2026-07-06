import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

const grotesk = Hanken_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const monoData = JetBrains_Mono({
  variable: "--font-mono-data",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vognary — The Silent Ledger",
  description:
    "A forensic audit for recurring money. Vognary finds silent subscriptions and mandates, shows the evidence, and helps you issue a verdict before the next debit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${grotesk.variable} ${monoData.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#ledger-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-(--ink) focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-(--paper)"
        >
          Skip to audit
        </a>
        <div className="relative z-10 flex min-h-full flex-col">{children}</div>
      </body>
    </html>
  );
}
