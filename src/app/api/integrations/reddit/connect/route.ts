import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getOptionalUser } from "@/domain/session";
import { getAppUrl, getConfigValue } from "@/lib/runtimeConfig";

function randomBase64Url(bytes = 32) { return randomBytes(bytes).toString("base64url"); }

export async function GET() {
  const user = await getOptionalUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if ((await getConfigValue("REDDIT_COMMERCIAL_APPROVED")) !== "true") return NextResponse.json({ error: "Written Reddit commercial approval is required." }, { status: 409 });
  const clientId = await getConfigValue("REDDIT_CLIENT_ID");
  if (!clientId) return NextResponse.json({ error: "REDDIT_CLIENT_ID is not configured." }, { status: 409 });
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${await getAppUrl()}/api/integrations/reddit/callback`;
  const url = new URL("https://www.reddit.com/api/v1/authorize");
  for (const [key, value] of Object.entries({ client_id: clientId, response_type: "code", state, redirect_uri: redirectUri, duration: "permanent", scope: "identity read submit", code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/integrations/reddit", maxAge: 600 };
  response.cookies.set("reddit_oauth_state", state, cookie);
  response.cookies.set("reddit_oauth_verifier", verifier, cookie);
  return response;
}
