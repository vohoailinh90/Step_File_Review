# QuickSTEP — instructions for Claude Code

## Platform this is run on — Windows

QuickSTEP is developed and run on **Windows**. That is where it is used, where
it is verified, and where a bug that matters will be seen.

This is a statement about where effort belongs, **not** a claim that the tool
only works elsewhere. `README.md` documents prebuilt `cascadio` wheels for
Windows, macOS and Linux, and the viewer is a self-contained HTML file — none
of that changes, and none of it should be removed.

What it means in practice:

- **Do not spend analysis, implementation or review effort on Linux/macOS-only
  behavior** — POSIX paths, case-sensitive filesystems, permission bits and
  `chmod`, symlinks, signals, `sh`/`bash` quoting, POSIX locale defaults.
- **A defect that only reproduces on Linux or macOS is not worth chasing
  here.** Record it in a single line and move on: do not widen scope to fix
  it, and do not let it block a review. Portability is not a requirement of
  this project, so it never becomes a review finding on its own.
- **Windows behavior is fully in scope** — console encoding (`cp1252` vs
  UTF-8), CRLF line endings, file locking, UNC paths such as
  `\\server\projects\`, the `~/.stepview_cache` location under a Windows user
  profile, and path-length limits. These are where this tool actually breaks.
- **Existing cross-platform code stays as it is.** This rule stops new effort;
  it is not a licence to strip working non-Windows branches, drop the
  macOS/Linux wheels, or narrow the packaging. Removing them is a behavior
  change that buys nothing.

A requirement that explicitly asks for verified non-Windows support is a
change to this note: confirm with the user before doing the work.

## Scope of this file

This file records the platform note and nothing else. It deliberately does not
define a routing policy, agent roster or review process — this repository has
not adopted one, and inventing rules nobody agreed to would be worse than the
silence it replaces. Follow the conventions already in the code and in
`README.md`.
