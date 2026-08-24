import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encryptSecret } from "@/core/secretBox";
import { safeCompare } from "@/core/auth";
import { audit } from "@/domain/audit";
import { getOptionalUser } from "@/domain/session";
import { getDb, newId, nowIso, saveDb } from "@/domain/store";
import { getAppUrl, getConfigValue } from "@/lib/runtimeConfig";

export async function GET(request: Request) {
  const user = await getOptionalUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const store = await cookies();
  const state = url.searchParams.get("state") ?? "";
  const expected = store.get("reddit_oauth_state")?.value ?? "";
  const verifier = store.get("reddit_oauth_verifier")?.value;
  if (!state || !expected || !safeCompare(state, expected) || !verifier) return NextResponse.json({ error: "Invalid or expired OAuth state." }, { status: 400 });
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "Reddit authorization was denied." }, { status: 400 });
  const [clientId, clientSecret, appUrl] = await Promise.all([getConfigValue("REDDIT_CLIENT_ID"), getConfigValue("REDDIT_CLIENT_SECRET"), getAppUrl()]);
  if (!clientId || !clientSecret) return NextResponse.json({ error: "Reddit client credentials are incomplete." }, { status: 409 });
  const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "EquityFlowGroup/1.0" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${appUrl}/api/integrations/reddit/callback`, code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = await tokenResponse.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token || !token.refresh_token) return NextResponse.json({ error: `Reddit token exchange failed (${token.error ?? tokenResponse.status}).` }, { status: 502 });
  const scopes = (token.scope ?? "").split(" ").filter(Boolean);
  if (!["identity", "read", "submit"].every((scope) => scopes.includes(scope))) return NextResponse.json({ error: "Reddit did not grant the required least-privilege scopes." }, { status: 409 });
  const meResponse = await fetch("https://oauth.reddit.com/api/v1/me", { headers: { authorization: `Bearer ${token.access_token}`, "user-agent": "EquityFlowGroup/1.0" }, signal: AbortSignal.timeout(10_000) });
  const me = await meResponse.json().catch(() => ({})) as { name?: string };
  if (!meResponse.ok || !me.name) return NextResponse.json({ error: "Reddit account verification failed." }, { status: 502 });
  const db = await getDb();
  for (const connection of db.redditConnections.values()) if (!connection.revokedAt) connection.revokedAt = nowIso();
  const id = newId("reddit");
  db.redditConnections.set(id, { id, accountName: me.name, encryptedRefreshToken: encryptSecret(token.refresh_token), scopes, connectedAt: nowIso(), connectedById: user.id });
  await audit(user.id, user.name, "REDDIT_CONNECTED", "RedditConnection", id, "ALLOW", { accountName: me.name, scopes });
  await saveDb();
  const response = NextResponse.redirect(`${appUrl}/workspace/discovery?reddit=connected`);
  response.cookies.set("reddit_oauth_state", "", { path: "/api/integrations/reddit", maxAge: 0, httpOnly: true, sameSite: "lax", secure: appUrl.startsWith("https://") });
  response.cookies.set("reddit_oauth_verifier", "", { path: "/api/integrations/reddit", maxAge: 0, httpOnly: true, sameSite: "lax", secure: appUrl.startsWith("https://") });
  return response;
}
