// Picks which channel to reach a borrower on, per person, at send time.
//
// The cadence plan used to hardcode this: "T+0 SMS, T+60 VOICE, T+1440 EMAIL".
// That decision was made by whoever authored the plan, months before this
// borrower existed, and it ignored everything we actually know about them —
// which channels they consented to, which one they already replied on, what
// time it is where they live, and whether they're worth a (much more
// expensive) AI voice minute at all. When the plan named a channel the
// borrower hadn't consented to, PolicyGate simply blocked the step and the
// touch was wasted rather than re-routed to a channel that would have worked.
//
// So the plan now says WHEN to reach out and the router says HOW.
//
// Scores are additive and every rule that fires is reported in `reasons`.
// That matters beyond debugging: an officer looking at a lead — or a
// compliance reviewer asking why the system chose to call someone — gets a
// plain-language answer instead of "the model decided".
//
// Pure function. No db, no I/O, no clock — the caller passes localHour so
// this stays testable and so quiet-hours logic has a single owner (PolicyGate).

import type { Channel } from "@/domain/types";
import type { ThreadChannel, ThreadMessage } from "@/core/conversationThread";
import { lastOutboundChannel, repliedChannels } from "@/core/conversationThread";

export const CHANNEL_RULE_WEIGHTS = {
  /** They replied here before. Strongest signal we have — a channel someone
   *  actually answers on beats every assumption we could make. */
  repliedHere: 40,
  /** They explicitly asked for this channel (post-submit screen, or said so). */
  statedPreference: 25,
  /** Async channels are safe near the edges of the day; a call is not. */
  asyncNearQuietHours: 15,
  /** Voice is the most expensive touch — reserve it for leads worth it. */
  voiceForHotLead: 20,
  /** Last touch went out here and got nothing back. Try somewhere else. */
  silentOnThisChannel: -30,
} as const;

/** Channels that don't ring a phone, and so stay acceptable close to quiet hours. */
const ASYNC_CHANNELS: Channel[] = ["SMS", "EMAIL"];

export interface ChannelRouteInput {
  /** Channels this borrower has consented to AND PolicyGate would allow right
   *  now. The router never overrides consent — it only picks among what's
   *  already permitted. */
  allowedChannels: Channel[];
  thread: ThreadMessage[];
  /** What they picked on the post-submit screen, if anything. */
  statedPreference?: Channel | null;
  /** Borrower's local hour, 0-23. Used only to prefer async channels near the
   *  quiet-hours boundary — the hard block is PolicyGate's job, not ours. */
  localHour: number;
  /** 0-100 lead quality score. */
  leadScore: number;
  /** At or above this, the lead earns a voice attempt. */
  hotLeadThreshold: number;
}

export interface ChannelRouteResult {
  channel: Channel | null;
  reasons: string[];
  /** Every channel's score, so the UI can show the runner-up. */
  scores: Record<string, number>;
}

/** Hours where a phone call is unwelcome even if technically permitted. */
function isNearQuietHours(localHour: number): boolean {
  return localHour < 9 || localHour >= 19;
}

export function selectBestChannel(input: ChannelRouteInput): ChannelRouteResult {
  const { allowedChannels, thread, statedPreference, localHour, leadScore, hotLeadThreshold } = input;

  if (allowedChannels.length === 0) {
    return {
      channel: null,
      reasons: ["No channel is currently permitted — consent, suppression, or quiet hours."],
      scores: {},
    };
  }

  const replied = repliedChannels(thread);
  const lastOut = lastOutboundChannel(thread);
  const nearQuiet = isNearQuietHours(localHour);

  const scores: Record<string, number> = {};
  const reasonsByChannel: Record<string, string[]> = {};

  for (const channel of allowedChannels) {
    let score = 0;
    const reasons: string[] = [];

    if (replied.has(channel as ThreadChannel)) {
      score += CHANNEL_RULE_WEIGHTS.repliedHere;
      reasons.push(`they've replied on ${channel.toLowerCase()} before`);
    }

    if (statedPreference === channel) {
      score += CHANNEL_RULE_WEIGHTS.statedPreference;
      reasons.push("it's the channel they asked for");
    }

    if (nearQuiet && ASYNC_CHANNELS.includes(channel)) {
      score += CHANNEL_RULE_WEIGHTS.asyncNearQuietHours;
      reasons.push("it's late where they are, so an async channel is kinder than a call");
    }

    if (channel === "VOICE" && leadScore >= hotLeadThreshold) {
      score += CHANNEL_RULE_WEIGHTS.voiceForHotLead;
      reasons.push(`they scored ${leadScore}, which earns a live call`);
    }

    // Only penalise repetition if the last touch here actually went unanswered.
    if (lastOut === channel && !replied.has(channel as ThreadChannel)) {
      score += CHANNEL_RULE_WEIGHTS.silentOnThisChannel;
      reasons.push(`last touch was ${channel.toLowerCase()} and went unanswered`);
    }

    scores[channel] = score;
    reasonsByChannel[channel] = reasons;
  }

  // Highest score wins; ties break on the allowedChannels order, which the
  // caller controls, so behaviour is deterministic rather than arbitrary.
  let best: Channel = allowedChannels[0];
  for (const channel of allowedChannels) {
    if (scores[channel] > scores[best]) best = channel;
  }

  const why = reasonsByChannel[best];
  return {
    channel: best,
    reasons: why.length > 0 ? why : [`${best.toLowerCase()} is the available channel with nothing arguing against it`],
    scores,
  };
}

/** One-line, human-readable explanation for the officer UI and the audit log. */
export function describeRoute(result: ChannelRouteResult): string {
  if (!result.channel) return result.reasons[0] ?? "No channel available.";
  return `Chose ${result.channel.toLowerCase()} — ${result.reasons.join("; ")}.`;
}
