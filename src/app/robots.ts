import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/apply", "/tools/", "/privacy", "/terms"],
      disallow: ["/workspace/", "/api/", "/status/", "/login", "/forgot-password", "/reset-password", "/accept-invite", "/unsubscribe"],
    }],
    sitemap: `${getAppUrl()}/sitemap.xml`,
    host: getAppUrl(),
  };
}
