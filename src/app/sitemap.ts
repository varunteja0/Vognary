import type { MetadataRoute } from "next";

const origin = "https://www.vognary.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/private-audit`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${origin}/sources`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/security`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/guide`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/privacy`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${origin}/terms`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${origin}/integration-model`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${origin}/partners`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${origin}/beta-readiness`, changeFrequency: "weekly", priority: 0.4 },
  ];
}