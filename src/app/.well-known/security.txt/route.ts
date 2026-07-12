export const dynamic = "force-static";

export function GET() {
  return new Response([
    "Contact: mailto:security@vognary.com",
    "Expires: 2027-07-11T00:00:00.000Z",
    "Preferred-Languages: en",
    "Canonical: https://www.vognary.com/.well-known/security.txt",
    "Policy: https://www.vognary.com/security",
    "Hiring: https://www.vognary.com/",
    "",
  ].join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
