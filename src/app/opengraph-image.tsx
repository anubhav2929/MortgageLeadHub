import { ImageResponse } from "next/og";

export const alt = "Equity Flow Group — mortgage refinance and home equity";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", padding: 80, background: "#111918", color: "white", fontFamily: "sans-serif" }}>
      <svg width="170" height="160" viewBox="0 0 160 150" style={{ marginRight: 54, flexShrink: 0 }}>
        <path d="M25 83V43L80 4l55 39v38" fill="none" stroke="#FFFFFF" strokeWidth="13" />
        <path d="M45 102V63h20v39zM72 110V43h20v67zM99 103V25h20v78z" fill="#22A06B" />
        <path d="M7 104c28-12 43 13 68 12 29-1 37-29 78-31-24 11-32 47-70 51-31 3-48-26-76-32Z" fill="#22A06B" />
        <path d="M0 105c29-5 48 31 83 31 27 0 48-19 67-34-18 27-40 45-67 47-35 2-56-36-83-44Z" fill="#FFFFFF" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: 8, color: "#75D5AC", marginBottom: 22 }}>EQUITY FLOW GROUP</div>
        <div style={{ fontSize: 67, fontWeight: 700, lineHeight: 1.05 }}>A clearer path to your home equity.</div>
        <div style={{ fontSize: 28, color: "#C9D2CE", marginTop: 26 }}>Mortgage inquiry review by a licensed loan officer.</div>
      </div>
    </div>,
    size
  );
}
