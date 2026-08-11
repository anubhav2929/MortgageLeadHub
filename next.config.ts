import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Forces HTTPS for a year on any browser that has seen this host
          // once. Ignored on http://localhost, so it is safe in development.
          // CSP is the other header worth adding (see docs/SOC2-READINESS.md
          // S4) but it is deliberately NOT here — a wrong directive blanks the
          // page, so it needs a report-only soak first, not a pre-demo edit.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
