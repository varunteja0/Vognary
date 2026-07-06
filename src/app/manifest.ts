import type { MetadataRoute } from "next";

/**
 * Web App Manifest — makes Vognary installable and completes the brand
 * metadata (name, colours, icons) for OS/browser surfaces.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vognary - Review recurring payments",
    short_name: "Vognary",
    description:
      "Find subscriptions, mandates, and recurring charges, review the proof, and decide what to keep, change, or cancel.",
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
