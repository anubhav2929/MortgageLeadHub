import { ImageResponse } from "next/og";

export const alt = "Equity Flow Group — mortgage refinance and home equity";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#071b2c", color: "white", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 30, color: "#64d2b6", marginBottom: 28 }}>EQUITY FLOW GROUP</div>
      <div style={{ fontSize: 70, fontWeight: 700, lineHeight: 1.05 }}>A clearer path to your home equity.</div>
      <div style={{ fontSize: 30, color: "#c8d6e2", marginTop: 28 }}>Mortgage inquiry review by a licensed loan officer.</div>
    </div>,
    size
  );
}
