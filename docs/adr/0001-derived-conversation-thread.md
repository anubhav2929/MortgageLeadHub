# ADR-0001 — Derive the conversation thread instead of storing it

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

A borrower's history is spread across three stores that already existed for
independent reasons:

- `ContactAttempt` — every outbound touch, and the audit record for it
- `ConversationSession` — AI call transcripts, turn by turn
- `Note` — inbound replies (email, status-page chat) and officer notes

The workspace needs one ordered thread of everything ever said to and by a
borrower. The AI agent needs the same thread as prior context, so an outreach
message doesn't repeat something already said.

Five different code paths write to these stores: the cadence engine, the manual
dialer/SMS/email modals, the Vapi webhook, the inbound email webhook, and the
post-submit chat.

## Decision

Merge the three stores into a `ThreadMessage[]` on read
(`core/conversationThread.ts`). Do not add a fourth "messages" table.

## Rationale

The obvious alternative — a denormalised `messages` table appended to by each
path — is faster to read and worse in every other respect. With five writers, a
sixth path added later that forgets to append produces a thread that silently
disagrees with the audit log. A thread that is *quietly wrong* is worse than no
thread at all: the officer trusts it, and the AI agent is prompted from it.

Deriving makes drift structurally impossible. The cost is a merge on each read,
which at realistic per-lead message volumes (tens, not thousands) is
irrelevant.

The non-obvious part is de-duplication. An AI call exists as **both** a
`ContactAttempt` and a `ConversationSession`. A naive concatenation shows every
call twice, and because the thread feeds `buildConversationBrief()` into the
next model call, the duplication compounds into the prompt. The merge therefore
suppresses the attempt row wherever a session with a transcript is linked to it,
and falls back to the attempt row when the transcript is empty or the session is
orphaned.

Borrower-authored notes are identified by `authorId === "borrower"`. Officer
notes are excluded: they were never said *to* the borrower, and must not be fed
back to the model as conversation history.

## Consequences

- The thread cannot disagree with the underlying records, by construction.
- Adding a new message source means teaching one merge function about it, in
  one place, rather than remembering to write to a second store.
- Read cost grows with per-lead message count. If a lead ever accumulates
  thousands of messages, revisit — the migration is a materialised view over the
  same three tables, not a new writable store.
- The de-duplication rule is subtle enough that it is pinned by name in
  `tests/conversationThread.test.ts`.

## Known gap

Inbound **SMS** is not yet captured — there is no inbound SMS webhook, so the
thread shows outbound texts without borrower replies. This is a missing source,
not a flaw in the derivation; wiring the webhook to write a `Note` with
`authorId: "borrower"` is sufficient to close it.
