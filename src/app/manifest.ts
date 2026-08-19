import type { MetadataRoute } from "next";

/**
 * Web App Manifest — makes Vognary installable and completes the brand
 * metadata (name, colours, icons) for OS/browser surfaces.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vognary - Commitment Intelligence",
    short_name: "Vognary",
    description:
      "Know which software is worth paying for before you pay again — from evidence you choose.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#0b0c0f",
    theme_color: "#0b0c0f",
    categories: ["finance", "productivity", "business"],
    icons: [
      { src: "/pwa/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/pwa/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/pwa/icon-maskable-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
