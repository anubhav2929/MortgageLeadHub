// Lead discovery adapter — searches public forum posts for refinance/equity
// intent signals. Deliberately read-only and one-way: it finds and surfaces
// candidate posts for a human to review, and never creates a contactable CRM
// record on its own. See domain/types.ts (DiscoveredSignal) and
// domain/actions.ts (runLeadDiscoveryAction) for the rest of the pipeline.

import { getCapabilities, getConfigValue } from "@/lib/runtimeConfig";

export interface RawSignal {
  source: "REDDIT";
  sourceUrl: string;
  subreddit: string;
  authorHandle: string;
  title: string;
  snippet: string;
  postedAt: string;
}

export interface DiscoveryResult {
  signals: RawSignal[];
  simulated: boolean;
}

const SUBREDDITS = ["personalfinance", "Mortgages", "RealEstate", "HomeImprovement"];
const DEFAULT_QUERY = "refinance OR \"cash out refi\" OR \"home equity loan\"";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const basic = Buffer.from(`${await getConfigValue("REDDIT_CLIENT_ID")}:${await getConfigValue("REDDIT_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "equityflowgroup-discovery/1.0",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

export async function searchForSignals(query = DEFAULT_QUERY): Promise<DiscoveryResult> {
  if (!(await getCapabilities()).hasLeadDiscovery) {
    return { signals: simulateSignals(), simulated: true };
  }
  try {
    const token = await getRedditToken();
    const subredditPath = SUBREDDITS.join("+");
    const url = `https://oauth.reddit.com/r/${subredditPath}/search?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=15`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "equityflowgroup-discovery/1.0" },
    });
    if (!res.ok) throw new Error(`Reddit search failed: ${res.status}`);
    const data = (await res.json()) as {
      data: { children: { data: { id: string; subreddit: string; author: string; title: string; selftext: string; permalink: string; created_utc: number } }[] };
    };
    const signals: RawSignal[] = data.data.children.map((c) => ({
      source: "REDDIT",
      sourceUrl: `https://reddit.com${c.data.permalink}`,
      subreddit: c.data.subreddit,
      authorHandle: `u/${c.data.author}`,
      title: c.data.title,
      snippet: (c.data.selftext || c.data.title).slice(0, 400),
      postedAt: new Date(c.data.created_utc * 1000).toISOString(),
    }));
    return { signals, simulated: false };
  } catch (err) {
    console.error("[Reddit discovery] falling back to simulated signals:", err);
    return { signals: simulateSignals(), simulated: true };
  }
}

function simulateSignals(): RawSignal[] {
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  return [
    {
      source: "REDDIT",
      sourceUrl: "https://www.reddit.com/r/personalfinance/",
      subreddit: "personalfinance",
      authorHandle: "u/throwaway_homeown3r",
      title: "Is now a good time to refinance? Rate is 7.1% from 2023",
      snippet:
        "We bought in 2023 at 7.1% and I keep hearing rates have come down. Trying to figure out if it's worth it to refinance our mortgage or if we should just wait it out. Anyone done this recently?",
      postedAt: hoursAgo(3),
    },
    {
      source: "REDDIT",
      sourceUrl: "https://www.reddit.com/r/RealEstate/",
      subreddit: "RealEstate",
      authorHandle: "u/kitchen_remodel_2026",
      title: "Cash out refi to pay for a kitchen remodel — bad idea?",
      snippet:
        "We have about 200k in equity and want to do a cash out refi to fund a kitchen remodel instead of a HELOC. Rates on both seem similar right now. Anyone have experience comparing the two?",
      postedAt: hoursAgo(9),
    },
    {
      source: "REDDIT",
      sourceUrl: "https://www.reddit.com/r/Mortgages/",
      subreddit: "Mortgages",
      authorHandle: "u/first_gen_buyer",
      title: "HELOC vs home equity loan for tuition costs",
      snippet:
        "Trying to decide between a home equity loan and a HELOC to cover my daughter's tuition for the next two years. Want something with a fixed payment. Any lenders people recommend?",
      postedAt: hoursAgo(20),
    },
    {
      source: "REDDIT",
      sourceUrl: "https://www.reddit.com/r/HomeImprovement/",
      subreddit: "HomeImprovement",
      authorHandle: "u/diy_deck_builder",
      title: "Best way to seal a deck before winter?",
      snippet: "Built a deck this summer and want to get a sealant on it before the weather turns. Any product recommendations?",
      postedAt: hoursAgo(30),
    },
  ];
}
