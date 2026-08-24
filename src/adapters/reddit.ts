import { decryptSecret } from "@/core/secretBox";
import { getConfigValue } from "@/lib/runtimeConfig";
import type { RedditConnection } from "@/domain/types";
import { DISCOVERY_SUBREDDITS, selectSignals, type RawCandidate } from "@/core/discoveryQuery";
import type { DiscoveryResult } from "@/adapters/leadDiscovery";

export async function getRedditAccessToken(connection: RedditConnection): Promise<string> {
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  const clientId = await getConfigValue("REDDIT_CLIENT_ID");
  const clientSecret = await getConfigValue("REDDIT_CLIENT_SECRET");
  if (!refreshToken || !clientId || !clientSecret) throw new Error("The Reddit connection cannot be decrypted or its client credentials are missing.");
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "EquityFlowGroup/1.0" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) throw new Error(`Reddit token refresh failed (${body.error ?? response.status}).`);
  return body.access_token;
}

export async function searchApprovedReddit(connection: RedditConnection, query?: string): Promise<DiscoveryResult> {
  const token = await getRedditAccessToken(connection);
  const candidates: RawCandidate[] = [];
  const failures: string[] = [];
  const chunks: string[][] = [];
  for (let index = 0; index < DISCOVERY_SUBREDDITS.length; index += 6) chunks.push(DISCOVERY_SUBREDDITS.slice(index, index + 6).map((item) => item.name));
  await Promise.all(chunks.map(async (subreddits) => {
    const url = new URL(`https://oauth.reddit.com/r/${subreddits.join("+")}/new`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("raw_json", "1");
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, "user-agent": "EquityFlowGroup/1.0" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { data?: { children?: Array<{ data?: { permalink?: string; author?: string; title?: string; selftext?: string; subreddit?: string; created_utc?: number; removed_by_category?: string | null; over_18?: boolean } }> } };
      for (const child of body.data?.children ?? []) {
        const item = child.data;
        if (!item?.permalink || !item.author || item.removed_by_category || item.over_18) continue;
        const title = item.title ?? "";
        const bodyText = item.selftext ?? "";
        if (query && !`${title}\n${bodyText}`.toLowerCase().includes(query.toLowerCase())) continue;
        candidates.push({
          sourceUrl: `https://www.reddit.com${item.permalink}`, subreddit: item.subreddit ?? "", authorHandle: `u/${item.author}`,
          title, body: bodyText, postedAt: new Date((item.created_utc ?? 0) * 1000).toISOString(), kind: "POST",
        });
      }
    } catch (error) {
      failures.push(`${subreddits.join("+")}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }));
  const selected = selectSignals(candidates, new Date());
  return {
    signals: selected.map((item) => ({
      source: "REDDIT", sourceUrl: item.sourceUrl, subreddit: item.subreddit, authorHandle: item.authorHandle,
      title: item.title, snippet: item.body.slice(0, 2000) || item.title, postedAt: item.postedAt,
      intentScore: item.intentScore, matchedKeywords: item.matchedKeywords, kind: item.kind, sourceLabel: `r/${item.subreddit}`,
    })),
    simulated: false,
    error: failures.length ? `${failures.length} approved API request(s) failed` : undefined,
    stats: { fetched: candidates.length, kept: selected.length, queries: chunks.length, sources: DISCOVERY_SUBREDDITS.length },
  };
}

export async function publishRedditComment(input: { connection: RedditConnection; sourceUrl: string; text: string }) {
  const token = await getRedditAccessToken(input.connection);
  const headers = { authorization: `Bearer ${token}`, "user-agent": "EquityFlowGroup/1.0" };
  const infoUrl = new URL("https://oauth.reddit.com/api/info");
  infoUrl.searchParams.set("url", input.sourceUrl);
  const infoResponse = await fetch(infoUrl, { headers, signal: AbortSignal.timeout(10_000) });
  const info = await infoResponse.json().catch(() => ({})) as { data?: { children?: Array<{ data?: { name?: string } }> } };
  const parent = info.data?.children?.[0]?.data?.name;
  if (!infoResponse.ok || !parent) throw new Error("Reddit could not resolve the approved source URL to a post/comment.");
  const response = await fetch("https://oauth.reddit.com/api/comment", {
    method: "POST", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_type: "json", thing_id: parent, text: input.text, return_rtjson: "true" }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as {
    json?: { errors?: unknown[]; data?: { things?: Array<{ data?: { id?: string; name?: string; permalink?: string } }> } };
  };
  const errors = body.json?.errors ?? [];
  const thing = body.json?.data?.things?.[0]?.data;
  if (!response.ok || errors.length > 0 || !thing?.id) throw new Error(`Reddit rejected the comment${errors.length ? `: ${JSON.stringify(errors)}` : ` (${response.status})`}.`);
  return { commentId: thing.name ?? thing.id, permalink: thing.permalink ? `https://www.reddit.com${thing.permalink}` : undefined, providerResponse: { id: thing.id, name: thing.name } };
}

export async function revokeRedditConnection(connection: RedditConnection) {
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  const clientId = await getConfigValue("REDDIT_CLIENT_ID");
  const clientSecret = await getConfigValue("REDDIT_CLIENT_SECRET");
  if (!refreshToken || !clientId || !clientSecret) return;
  await fetch("https://www.reddit.com/api/v1/revoke_token", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "EquityFlowGroup/1.0" },
    body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }), signal: AbortSignal.timeout(10_000),
  });
}
