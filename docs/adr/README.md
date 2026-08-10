# Architecture decision records

One record per non-obvious decision: the context, what was decided, why the
obvious alternative was rejected, and what it costs. Records are immutable —
when a decision changes, add a new record that supersedes the old one rather
than editing history.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-derived-conversation-thread.md) | Derive the conversation thread instead of storing it | Accepted |
| [0002](0002-runtime-credential-resolution.md) | Resolve integration credentials at call time | Accepted |
| [0003](0003-credential-encryption-at-rest.md) | Encrypt stored credentials with an environment-held root key | Accepted |
| [0004](0004-support-both-telnyx-and-twilio.md) | Support both Telnyx and Twilio rather than choosing one | Accepted |
| [0005](0005-pure-core-layer.md) | Keep compliance logic in a pure, I/O-free core | Accepted |

If you are about to write a long comment explaining why the obvious approach
was rejected, write an ADR instead and link to it.
