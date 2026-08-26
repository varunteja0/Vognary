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
    default: "Vognary - Decide before the obligation exists",
    template: "%s - Vognary",
  },
  description:
    "Vognary is Commitment Control for India-first 5–100 person AI-native companies: propose the spend, see cited exposure and policy, then a named human freezes a cap.",
  keywords: [
    "Commitment Control",
    "software authorizations",
    "recurring vendor commitments",
    "human-approved spend",
    "Vognary",
  ],
  authors: [{ name: "Vognary" }],
  creator: "Vognary",
  alternates: { canonical: "/" },
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
    title: "Vognary - Decide before the obligation exists",
    description:
      "Vognary is Commitment Control for India-first 5–100 person AI-native companies: propose the spend, see cited exposure and policy, then a named human freezes a cap.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vognary - Decide before the obligation exists",
    description:
      "Vognary is Commitment Control for India-first 5–100 person AI-native companies: propose the spend, see cited exposure and policy, then a named human freezes a cap.",
  },
};

export const viewport: Viewport = {
  themeColor: "white",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${grotesk.variable} ${monoData.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <div id="main-content" tabIndex={-1} className="relative z-10 flex min-h-full flex-col outline-none">{children}</div>
      </body>
    </html>
  );
}
