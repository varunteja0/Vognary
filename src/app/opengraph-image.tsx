import { ImageResponse } from "next/og";

export const alt = "Vognary recurring payment review";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const spectrum: Array<[string, number]> = [
  ["#f0705e", 26],
  ["#43c6a0", 18],
  ["#e0a54e", 14],
  ["#8891e8", 11],
  ["#d8b87a", 9],
  ["#43c6a0", 7],
  ["#f0705e", 6],
  ["#3a3f48", 9],
];

export default function OpengraphImage() {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 48 48" fill="none"><path d="M11.5 13.5 21.7 29.6" stroke="#edeef1" stroke-width="5" stroke-linecap="round"/><path d="M36.5 13.5 26.3 29.6" stroke="#edeef1" stroke-width="5" stroke-linecap="round"/><path d="M24 26 29.4 31.8 24 37.6 18.6 31.8Z" fill="#d8b87a"/><path d="M24 26 29.4 31.8 18.6 31.8Z" fill="#efdcae"/></svg>`;
  const markSrc = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(1200px 520px at 80% -12%, rgba(216,184,122,0.16), transparent 60%), #0b0c0f",
          padding: "70px 80px",
          fontFamily: "sans-serif",
          color: "#edeef1",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <img src={markSrc} width={88} height={88} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 0 }}>Vognary</div>
            <div style={{ fontSize: 17, color: "#8a8e98", letterSpacing: 0 }}>Recurring payments, reviewed</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.08, letterSpacing: 0 }}>Find recurring payments</div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0 }}>
            <span>before they</span>
            <span style={{ color: "#d8b87a", marginLeft: 20 }}>renew.</span>
          </div>
          <div style={{ fontSize: 26, color: "#a6aab4", marginTop: 26, maxWidth: 780, lineHeight: 1.4 }}>
            Review subscriptions, mandates, and recurring charges with proof you can verify.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 6, height: 12 }}>
            {spectrum.map(([color, weight], index) => (
              <div key={index} style={{ width: weight * 3, height: "100%", borderRadius: 4, background: color }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 18, color: "#8a8e98", letterSpacing: 0 }}>vognary.com</div>
            <div style={{ fontSize: 18, color: "#8a8e98" }}>Evidence-first audit</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
