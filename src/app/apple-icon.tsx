import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon — the Vognary mark ("The Resolve") on a graphite field.
 * Rendered as a raster PNG because iOS home-screen icons do not support SVG.
 */
export default function AppleIcon() {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 48 48" fill="none"><path d="M11.5 13.5 21.7 29.6" stroke="#e9eaee" stroke-width="5" stroke-linecap="round"/><path d="M36.5 13.5 26.3 29.6" stroke="#e9eaee" stroke-width="5" stroke-linecap="round"/><path d="M24 26 29.4 31.8 24 37.6 18.6 31.8Z" fill="#d8b87a"/><path d="M24 26 29.4 31.8 18.6 31.8Z" fill="#efdcae"/></svg>`;
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
