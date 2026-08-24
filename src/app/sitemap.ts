import type { MetadataRoute } from "next";

const origin = "https://www.vognary.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/security`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${origin}/privacy`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${origin}/contact`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${origin}/terms`, changeFrequency: "monthly", priority: 0.4 },
  ];
}
