import type { MetadataRoute } from "next";

/**
 * Web App Manifest — makes Vognary installable and completes the brand
 * metadata (name, colours, icons) for OS/browser surfaces.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vognary — Recurring money, audited",
    short_name: "Vognary",
    description:
      "Find every silent subscription, mandate, and recurring charge, read the evidence, and cut it before the next debit.",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0c0f",
    theme_color: "#0b0c0f",
    categories: ["finance", "productivity", "business"],
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180", purpose: "maskable" },
    ],
  };
}
