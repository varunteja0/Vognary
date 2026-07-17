import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon — the Vognary "Ledger to Verdict" mark on graphite.
 * Rendered as a raster PNG because iOS home-screen icons do not support SVG.
 */
export default function AppleIcon() {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="124" height="124" viewBox="0 0 64 64" fill="none"><path d="M7 11h17l5 7H12l-5-7ZM13 23h15l5 7H18l-5-7Z" fill="#f0f1f5"/><path d="M57 11H40l-5 7h17l5-7ZM51 23H36l-5 7h15l5-7Z" fill="#f0f1f5"/><path d="m20.5 35 11.5 14L43.5 35" stroke="#d8b87a" stroke-width="8" stroke-linecap="square" stroke-linejoin="miter"/><path d="m23 35 9 11 9-11" stroke="#f1dca6" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" opacity=".72"/></svg>`;
  const markSrc = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at 50% 70%, rgba(216,184,122,0.14), transparent 46%), #08090c",
        }}
      >
        <img src={markSrc} width={124} height={124} alt="" />
      </div>
    ),
    { ...size },
  );
}
