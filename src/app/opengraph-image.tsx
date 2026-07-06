import { ImageResponse } from "next/og";

export const alt = "Vognary — see the money leaving in the dark";
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
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 48 48"><path d="M13 14 24 34 35 14" fill="none" stroke="#edeef1" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="34" r="4" fill="#d8b87a"/></svg>`;
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
            <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Vognary</div>
            <div style={{ fontSize: 17, color: "#8a8e98", letterSpacing: 4 }}>RECURRING MONEY, AUDITED</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 78, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3 }}>See the money</div>
          <div style={{ display: "flex", fontSize: 78, fontWeight: 700, lineHeight: 1.06, letterSpacing: -3 }}>
            <span>leaving in the</span>
            <span style={{ color: "#d8b87a", marginLeft: 20 }}>dark.</span>
          </div>
          <div style={{ fontSize: 26, color: "#a6aab4", marginTop: 26, maxWidth: 780, lineHeight: 1.4 }}>
            Find every silent subscription and mandate, read the evidence, and cut it before the next debit.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 6, height: 12 }}>
            {spectrum.map(([color, weight], index) => (
              <div key={index} style={{ width: weight * 3, height: "100%", borderRadius: 4, background: color }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 18, color: "#8a8e98", letterSpacing: 3 }}>VOGNARY.COM</div>
            <div style={{ fontSize: 18, color: "#8a8e98" }}>Private beta</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
