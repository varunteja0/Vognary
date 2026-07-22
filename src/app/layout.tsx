import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import PwaRegister from "./pwa-register";
import "./globals.css";

const grotesk = Geist({
  variable: "--font-grotesk",
  subsets: ["latin"],
  display: "optional",
  preload: false,
});

const monoData = Geist_Mono({
  variable: "--font-mono-data",
  subsets: ["latin"],
  display: "optional",
  preload: false,
});

const display = Fraunces({
  variable: "--font-display-serif",
  subsets: ["latin"],
  display: "optional",
  preload: false,
  axes: ["opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.vognary.com"),
  applicationName: "Vognary",
  title: {
    default: "Vognary - Review recurring payments",
    template: "%s - Vognary",
  },
  description:
    "Vognary helps you find subscriptions, mandates, and recurring charges, review the proof, and decide what to keep, change, or cancel.",
  keywords: [
    "recurring payments",
    "subscription audit",
    "recurring money",
    "mandates",
    "UPI AutoPay",
    "cancel subscriptions",
    "spend audit",
    "Vognary",
  ],
  authors: [{ name: "Vognary" }],
  creator: "Vognary",
  appleWebApp: {
    capable: true,
    title: "Vognary",
    statusBarStyle: "black-translucent",
    startupImage: [
      { url: "/pwa/startup/750x1334", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/pwa/startup/1170x2532", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/pwa/startup/1179x2556", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/pwa/startup/1290x2796", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/pwa/startup/2048x2732", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
  openGraph: {
    type: "website",
    siteName: "Vognary",
    url: "/",
    title: "Vognary - Review recurring payments",
    description:
      "Find subscriptions and mandates, review the proof, and decide what to keep, change, or cancel.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vognary - Review recurring payments",
    description:
      "Find subscriptions and mandates, review the proof, and decide what to keep, change, or cancel.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0c0f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${monoData.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-(--glow) focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-(--ink-on-gold)"
        >
          Skip to main content
        </a>
        <div id="main-content" tabIndex={-1} className="relative z-10 flex min-h-full flex-col outline-none">{children}</div>
      </body>
    </html>
  );
}
