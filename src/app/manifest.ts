import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Equity Flow Group",
    short_name: "Equity Flow",
    description: "Mortgage refinance and home equity education and inquiry routing.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F8F6",
    theme_color: "#0E6B4F",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/brand/logo-mark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/logo-mark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
