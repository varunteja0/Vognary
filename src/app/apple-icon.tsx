import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon — the Vognary mark ("The Resolve") on a graphite field.
 * Rendered as a raster PNG because iOS home-screen icons do not support SVG.
 */
export default function AppleIcon() {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 48 48"><path d="M13 14 24 34 35 14" fill="none" stroke="#e9eaee" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="34" r="4" fill="#d8b87a"/></svg>`;
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
          background: "#14161b",
        }}
      >
        <img src={markSrc} width={112} height={112} alt="" />
      </div>
    ),
    { ...size },
  );
}
