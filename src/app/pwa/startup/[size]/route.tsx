/* eslint-disable @next/next/no-img-element -- ImageResponse renders its supported image primitive directly. */
import { ImageResponse } from "next/og";

export const dynamic = "force-static";

const allowedSizes = new Map([
  ["750x1334", { width: 750, height: 1334 }],
  ["1170x2532", { width: 1170, height: 2532 }],
  ["1179x2556", { width: 1179, height: 2556 }],
  ["1290x2796", { width: 1290, height: 2796 }],
  ["2048x2732", { width: 2048, height: 2732 }],
]);

export function generateStaticParams() {
  return [...allowedSizes.keys()].map((size) => ({ size }));
}

export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size: requestedSize } = await context.params;
  const size = allowedSizes.get(requestedSize);
  if (!size) return new Response("Unsupported startup image size.", { status: 404 });
  const markSize = Math.round(Math.min(size.width, size.height) * 0.22);
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="${markSize}" height="${markSize}" viewBox="0 0 64 64" fill="none"><path d="M7 11h17l5 7H12l-5-7ZM13 23h15l5 7H18l-5-7Z" fill="#f0f1f5"/><path d="M57 11H40l-5 7h17l5-7ZM51 23H36l-5 7h15l5-7Z" fill="#f0f1f5"/><path d="m20.5 35 11.5 14L43.5 35" stroke="#d8b87a" stroke-width="8"/><path d="m23 35 9 11 9-11" stroke="#f1dca6" stroke-width="2" opacity=".72"/></svg>`;
  const markSrc = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 50% 58%, rgba(216,184,122,0.15), transparent 30%), #08090c", color: "#f0f1f5" }}>
        <img src={markSrc} width={markSize} height={markSize} alt="" />
        <div style={{ display: "flex", marginTop: Math.round(markSize * 0.22), fontSize: Math.round(markSize * 0.22), fontWeight: 700, letterSpacing: "-0.03em" }}>Vognary</div>
        <div style={{ display: "flex", marginTop: Math.round(markSize * 0.08), color: "#aaaeb8", fontSize: Math.round(markSize * 0.065), letterSpacing: "0.16em", textTransform: "uppercase" }}>Recurring payments, reviewed</div>
      </div>
    ),
    { ...size, headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
