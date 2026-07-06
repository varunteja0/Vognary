import type { Metadata } from "next";
import { Syne, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import RevealController from "./reveal-controller";

const display = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const grotesk = Space_Grotesk({
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
  title: "Vognary — See the money leaving in the dark",
  description:
    "Vognary is a blacklight for your money: it reveals the silent recurring charges you can't see, shows the evidence, and helps you cut them before the next debit.",
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
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-(--glow) focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#0a0c10]"
        >
          Skip to audit
        </a>
        <div className="relative z-10 flex min-h-full flex-col">{children}</div>
        <RevealController />
      </body>
    </html>
  );
}
