# artifacts/

Where roles hand work to each other in writing, so that a design, a critique and
a review survive the session that produced them.

| path | written by | cap |
|---|---|---|
| `architecture/<id>.md` | the main session (design proposals) | 200 lines |
| `critiques/<id>.md`    | `architecture-critic`                |  80 lines |
| `plans/<id>.md`        | the main session (implementation plan) | 120 lines |
| `reviews/<id>.md`      | `code-reviewer`, `geometry-reviewer`, `windows-verifier` | 120 lines |

Every downstream reader pays for length, so an artifact over its cap is **cut
down**, not split across more files. Record unresolved issues explicitly — an
artifact that only lists what went well is not a handover.

These are working notes, not repository documentation. Durable facts about how
the code works belong in `CLAUDE.md` or `README.md`.
