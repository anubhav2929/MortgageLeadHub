import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Equity Flow Group",
    short_name: "Equity Flow",
    description: "Mortgage refinance and home equity education and inquiry routing.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7faf8",
    theme_color: "#176b45",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
