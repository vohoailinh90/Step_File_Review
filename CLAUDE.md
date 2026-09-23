# QuickSTEP — instructions for Claude Code

A two-file local STEP viewer: `stepview.py` tessellates and serves, `viewer.html`
displays. `README.md` is the user-facing documentation and is accurate; read it
before changing behavior it describes.

## Read this first: viewer.html is generated

`viewer.html` is **796 KB, and about 99% of it is vendored three.js**. It is
assembled by `build.py` from `src/` and `vendor/`, and it is committed because
shipping it *is* the product — a user gets two files, no npm, no build step, no
internet.

**Never open `viewer.html` to work, and never edit it.** Reading it spends an
enormous amount of context on a minified library; editing it produces a change
that the next `python build.py` silently discards and that
`python build.py --check` then fails on in CI. A `PreToolUse` hook blocks the
write once `.claude/settings.json` is installed — copy it from
`.claude/settings.example.json`. The hook runs under `python`, the same command
README.md tells users to run, because a python.org install on Windows provides
`python.exe` and not `python3.exe`; a hook that cannot launch protects nothing and
says nothing. On a machine that only has `python3`, change it in your local
`settings.json` — that is a one-line local edit, not a change to make here.

Never edit `vendor/` either. Those files are upstream libraries pinned by
`vendor/SHA256SUMS`; patch around them in `src/app/`.

**Upgrading a vendored library** means refreshing `vendor/SHA256SUMS` — which is
exactly why the hash cannot vet an upgrade: it is re-baselined on the very commit
that brings in new third-party code. `vendor/URLS` lists every remote URL in
`vendor/`, each reviewed; `tests/check_invariants.py` fails on any URL not listed,
by name. So an upgrade that adds a network endpoint shows up as a readable line in
the diff rather than an opaque hash change. `vendor/NETWORK_APIS` does the same for
network-capable APIs — `fetch`, `WebSocket`, `Worker`, an image's `.src` — counted
per file, because a URL assembled at runtime is invisible to `vendor/URLS` while the
API that would carry it is not. A loader path is safe only when its URL goes through
`manager.resolveURL()`, which `src/app/10-load.js` routes through `sameOrigin()`.
**Add only the URLs and counts the checks name, after reading the code around
each** — never regenerate either file wholesale. The `PreToolUse` hook must let an
upgrade edit every metadata file in `vendor/`; an invariant asks it about each one.

## Where the code lives

862 lines of application code, in one shared closure, split by concern:

| file | lines | owns |
|---|---|---|
| `src/app/00-scene.js`    | 69  | renderer, scene, camera, lights, `unitScale`, `L()`/`A2()`, framing |
| `src/app/10-load.js`     | 121 | `sameOrigin()` runtime URL guard, format sniffing, GLB/GLTF/STL load, dispose, load status |
| `src/app/20-parts.js`    | 42  | part list, visibility, isolate, hover |
| `src/app/30-select.js`   | 155 | pick modes, raycast, face flood-fill (20° break angle) |
| `src/app/40-geometry.js` | 196 | edge chaining, `fitCircle`, `polylineLength`, `fmt`, info panel |
| `src/app/50-section.js`  | 144 | section planes, plane-from-circle, stencil caps |
| `src/app/60-io.js`       | 135 | drag & drop, `/convert`, `/status`, screenshot, keyboard, autoload |
| `src/ui/viewer.css`      | 92  | all styling |
| `src/ui/layout.html`     | 112 | toolbar, sidebar, section panel, status bar |
| `src/viewer.template.html` | — | the shell and the concatenation order |
| `stepview.py`            | 422 | tessellation, cache, CLI, loopback server |

`.claude/skills/viewer-change/SKILL.md` maps a symptom to a file. Use it.

## The loop

```bash
python build.py                 # regenerate viewer.html after any src/ edit
python tests/run_checks.py      # build fidelity, invariants, launcher, geometry
python tests/run_checks.py --mutations   # also prove those checks can fail
python stepview.py              # look at it, for anything visual
```

Modules are script fragments sharing one closure, concatenated in **filename
order**. No `import`/`export`. Functions hoist across modules; top-level `const`
and `addEventListener` do not, so order matters for those. Keep each module under
250 lines — add `70-<name>.js` rather than growing one past the budget.

## Constraints that are product features

Breaking any of these breaks the product, not just a test. `tests/check_invariants.py`
enforces the ones a script can:

- **Offline.** The viewer must run air-gapped: nothing fetched from the network,
  by any route. `tests/check_invariants.py` enforces the whole class rather than
  a hostname list — every URL-bearing HTML attribute (`src`, `srcset`, `href`,
  `poster`, `action`, …), every CSS `url()` and `@import`, and any remote string
  literal assigned to a URL property in JS. Each scan runs over **every** source
  file's full text — stylesheet, markup, template and `src/app/*.js` alike — so a
  `style=""` attribute, an inline `<style>` block, a `.style.background` string
  and an `innerHTML` fragment are all covered. `data:` and `blob:` are allowed
  because they never leave the page; `xmlns` is not a load and is not flagged.
  A URL that exists only **at runtime** — the `?model=` query, a buffer or image
  uri inside a dropped `.gltf` — cannot be judged by any scan, so every such route
  goes through one guard, `sameOrigin()` in `src/app/10-load.js`: `fetch()` takes
  a quoted literal or a `sameOrigin()` call and nothing else, and three.js's
  default loading manager resolves every loader URL through it. Both are enforced
  by an invariant, and the guard itself is tested in `tests/viewer.test.mjs`.
  Element **sinks** are held to a closed safe set of values: a URL sink (`.src`,
  `.href`, `setAttribute('src', …)`, `location =`) takes a literal, `sameOrigin()`
  or `URL.createObjectURL()`; a markup sink (`innerHTML`, `insertAdjacentHTML`,
  `.style.*`) takes only markup written in source, UPPER_CASE constants and the
  number formatters `L`/`A2`/`fmt`. **Text from a model file — a part name — goes in
  through `textContent`, never markup.**
- **No user-facing toolchain.** `build.py` is stdlib Python. Do not add a
  bundler, `package.json`, TypeScript or a preprocessor.
- **Local only.** The helper server binds `127.0.0.1`. Tessellation happens in
  the local Python process; no data leaves the machine.
- **`stepview.py` stays stdlib + `cascadio`, and never reaches the network.**
  No new pip dependency. The install line also names `numpy` only because
  `cascadio` 0.1.1 imports it without declaring it — cascadio's dependency, not
  the launcher's. `stepview.ENGINE_PACKAGES` is the one list, and
  `tests/check_invariants.py` holds every install command in README, the
  launcher, the page and CI to it. Its imports are allowlisted at *submodule* level —
  `urllib.parse`, not `urllib`; `http.server`, not `http` — because allowing
  `urllib` wholesale let `urllib.request.urlopen("https://…")` pass every check.
  Its `socket` may listen, never connect. README promises tessellation happens
  "never in the cloud"; those two checks are what hold the launcher to it.
- **Python 3.9 is the floor**, because `README.md` promises it. PEP 604 unions
  (`str | None`) are evaluated at runtime before 3.10, so every script here
  carries `from __future__ import annotations`. Dropping it makes `stepview.py`
  fail at *import* on 3.9 with a bare `TypeError` — which is exactly how it
  shipped until CI on `windows-latest`/py3.9 caught it.
  `tests/check_invariants.py` now enforces the pairing.
- **three.js is pinned** to a bundled r13x-era build: `renderer.outputEncoding`,
  `THREE.sRGBEncoding`, and the `THREE.OrbitControls` / `THREE.GLTFLoader`
  globals. Post-r152 names (`outputColorSpace`, `SRGBColorSpace`, ESM imports)
  do not exist here and throw at runtime. Upgrading three.js is its own T3
  requirement, never a step inside another change.
- **The cache is the performance bet.** Anything that changes the cache key makes
  every existing user's next open slow again. Treat it as a migration.

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

## Untrusted input reaching the filesystem

`convert_bytes()` builds its cache filename from the browser's `X-Filename`
header, which is untrusted. Two properties are load-bearing and both are pinned
in `tests/test_stepview.py`:

- **Legality.** `safe_stem()` replaces every Win32-illegal character
  (`< > : " / \ | ? *` and the C0 range). A PDM-style name such as
  `HOUSING:REV-B.step` otherwise produced an unwritable Windows path and a bare
  `OSError`. POSIX accepts the colon, which is why it went unnoticed for so long
  — a reminder that a green run on Linux says little here.
- **Containment.** `Path().stem` discards directory components, so
  `../../evil.step` cannot escape the cache directory. Do not replace it with
  raw string handling.

`safe_stem()` must also leave ordinary names untouched: every existing user has
a warm cache keyed on the old naming, and shifting a stem silently reconverts a
large assembly. That is asserted too.

**Test Windows path parsing from whatever machine you are on.** `pathlib` reads
a single letter followed by `:` as a *drive*, so `"a:b.step"` has stem `"b"` on
Windows and `"a:b"` on Linux. That divergence was found by CI on
`windows-latest` after a local run and an independent review — both on Linux —
had called the change clean. It did not need a Windows box to find: the
`WindowsPathSemantics` class in `tests/test_stepview.py` swaps `stepview.Path`
for `PureWindowsPath` and re-runs the assertions anywhere. Any new path or
filename logic belongs in that class as well as the native one.

## Choosing how much process a change deserves

Most changes here need no agents at all. The roster exists for the few that do.
Pick the smallest row that honestly fits; escalate if implementation reveals more.

| tier | looks like | who does it | agents | budget |
|---|---|---|---|---|
| **T0** | a label, a colour, a README line, a keyboard shortcut, a tooltip | main session only | none | 0 |
| **T1** | one module, no reported number changes: a new toolbar toggle, a part-list affordance, a CLI flag | main session implements | `code-reviewer` | 1 |
| **T2** | selection, section planes, the loader, the cache, the server, or anything touching a reported number | main session implements | `geometry-reviewer` **or** `code-reviewer`, plus `windows-verifier` if it touches paths/filenames/console/server | 2 |
| **T3** | assembly tree, point-to-point measurement, B-rep-accurate faces, a three.js upgrade, a cache-format change | main session designs, then implements | `architecture-critic` before implementation, then the T2 reviewer | 3 |

Three rules override the table:

1. **Any change to a number the viewer reports** — diameter, length, area,
   bounding box, units, the 20° face break, the `rms < 0.03` circle gate — gets
   `geometry-reviewer`, at any tier. Someone checks a bore here and then drills.
2. **Any change to `stepview.py`'s paths, filenames, console output or server**
   gets `windows-verifier`. That is the platform this runs on.
3. **A three.js upgrade is always T3.** It is a simultaneous breaking migration
   across three vendored loaders with nothing rendering in CI.

The budget counts every subagent invocation, resumed agents included. Reaching it
with work outstanding is a signal to report the partial result and the remaining
risk — not to spawn past it. `architecture-critic` runs **one** round; a second
round requires unresolved critical findings and must resume the same critic.

`.claude/agents/` holds the roster. `test-engineer` is **escalation only**:
invoke it after a reviewer reports that verification needs designing (a
headless-WebGL harness, a large-assembly rehearsal, a concurrency probe), never
as a routine second reviewer.

## Deterministic work is not agent work

If the answer is computable, compute it. Counting, hashing, threshold comparison,
conformance a validator can assert, and any lint/test run whose output is already
a verdict all belong in a script — `tests/check_invariants.py` or
`tests/mutation_check.py` — not in a reviewer's turn. A reviewer asked to eyeball
796 KB for a stray CDN reference will sometimes miss it; the script never will.

**Mutation checking is the worked example.** A passing test proves nothing on its
own; a test that would still pass with the behavior deleted reports safety that
is not there. `tests/mutation_check.py` breaks each behavior and requires the
suite to notice — 89 mutations, all currently caught. When you ship a fix with a
test, add the mutation that would have caught it.

This is not theoretical. The first version of this suite reported 20/20 caught
while `src/app/00-scene.js` and `src/app/30-select.js` had no tests at all, so
two silent defects passed everything: `unitScale` 1000 → 1 (every reported length
1000x wrong) and the face break angle 20° → 85° (every reported face area
inflated). An independent review found them by trying to defeat the suite rather
than by running it. **A green suite is evidence about the mutations you wrote,
not about the code.** When you add a module, add a suite that loads it.

The same shape recurred in the offline check, twice, and independent review found
it both times. Round 1: it matched `<script src>` and a short CDN hostname
allowlist, so a remote `<img src>` or a CSS `background:url(https://…)` rebuilt
cleanly and passed all 12 checks. The fix enumerated the attributes and the
stylesheet — and round 2 then found `style="background:url(https://…)"` and an
inline `<style>` block still passing all 13. Probing for the rest of the class
turned up two more nobody had named: `.style.background = "url(https://…)"` and
an `innerHTML` string carrying a remote `<img src>`.

Round 3 then found the same mistake one level up: the fix scanned every source
file's whole text, but `SCANNED_SOURCES` was still a hardcoded tuple of three UI
files, so a *newly included* `src/ui/probe.html` shipped a remote `url()` past all
13 checks.

Three rounds, three versions of one mistake: **enumerating**. Hostnames, then
attributes and the one stylesheet, then the file list. The check now derives its
inputs from `build.py`'s own template directives — what ships is what is scanned,
so a new source is covered the moment it is included — and is pinned by 34 probes
and 7 mutations. **Do not list the places a problem can appear. Decide what the
problem looks like, then derive where to look from what actually ships.**

Round 5 found the same mistake in a *sibling* check: the source-derivation fix had
been applied to one check and not to `_same_origin_only`, which still globbed
`src/app/*.js`. An audit then found three more siblings on hardcoded file sets.
Round 5 also found `EventSource` unlisted — and listing network APIs is listing an
open set. So the offline checks now **invert the enumeration**: they list the
*safe* side, which is small and closed — a remote URL may appear only as an XML
namespace declaration — and treat a remote URL anywhere else in any shipped source
as a violation, whichever API would consume it. That catches APIs nobody named.
`NETWORK_APIS` remains a list only for URLs built at runtime, which no static scan
can see, and says so. **When the dangerous set is open, enumerate the safe one.**

Round 6 then tested the *safe* list itself, and found it too loose: the `xmlns`
exemption keyed on the text before a URL, so `const xmlns = 'https://…';
fetch(xmlns)` passed. An allowlist is only as narrow as its matching. It now
requires all three of: a known W3C namespace URI, as the value of an `xmlns`
attribute, inside an open tag in a markup file. JS gets no exemption at all.
**Enumerating the safe side only helps if "safe" is recognised precisely.**

**Where the static checks end.** A URL does not have to be spelled `https://` to be
fetched: the JS engine decodes `\x68ttps`, `\u0068ttps`, `\u{68}ttps`; the CSS
parser decodes `\68ttps`; the HTML parser decodes `&#104;ttps` and
`https&colon;//`. All seven passed every check. There are three decoders, and
the scan reads every line under every ordering of them, raw text included — not
one fixed order, because a decoder that does not belong to a file can *hide* a URL:
CSS reads `\e` as a hex escape, so the JS literal `'\\\\evil.com'` (at runtime
`\\evil.com`, a host) lost a backslash to it and escaped. After the decoders comes
a fourth transformation, the **URL parser**, and round 8 found the check still
pattern-matching one spelling of its output: it wanted a dotted host after `//`, so
`//intranet/leak` passed — and so did `//[::1]`, `//u@host`, `///host`,
`\\host`, `/\host`, `' //host'`, `https:host` and `https:\\host`, thirteen
escapes in all. `resolves_off_page()` now models the parser's own rules (strip
C0 and space, delete tab/CR/LF, `\` is `/`, skip any run of slashes before a
special scheme's host) and asks one question — *is there a host?* — for every
quoted string, attribute, `url()` and `@import`. **Model the consumer, don't
match its input.** What remains is a URL **assembled at runtime**
(`"ht" + "tps://"`, `String.fromCharCode`), which no static scan can see. That is
not a gap to keep patching; it is the boundary of what static analysis can do.
Round 9 found that boundary already crossed in shipped code: `fetch(modelUrl)` took
whatever `?model=` named — `?model=https://example.com/x.glb` requested it, in a
real browser — and a `.gltf`'s buffer uri was fetched the same way, so opening a
supplier's file could reach the network. Both were on `main`. A value known only at
runtime cannot be checked statically, so the check stopped trying: it now requires
every such value to pass through `sameOrigin()`, which *is* checked — statically
that it is used, and by a test that it refuses other hosts. **What a scan cannot
judge, route through one thing it can.**
The fix beyond it is a Content-Security-Policy in `viewer.html`, so the browser
itself refuses every off-origin connection — a change to the shipped artifact,
and so a decision for the maintainer rather than a check to add here.

Round 8 also found the vendor side of `scanned_sources()`'s old mistake, still
open: the three vendor checks globbed `vendor/*.js`, so an included
`vendor/lib/probe.js` carrying a fetch was unhashed, its URLs unreviewed, and —
being under `vendor/` — skipped by the ordinary scans too. `vendor_sources()` now
derives the vendor set the same way: every `vendor/` include the build ships, by
resolved path, plus every `.js` under `vendor/` at any depth. The vendor review
also reads `url()` and attributes the way the app scan does, through one shared
extractor; with only the quoted-literal scan it missed `url(//host/x)` in a
vendored stylesheet. **A derivation fixed in one place is an enumeration
everywhere it was not applied.** Round 10 found it once more: the runtime-API scan
(`NETWORK_APIS`) covered app code only, so a vendored `new WebSocket('ws' + 's://…')`
passed all 20 checks. It now has a vendor counterpart, `vendor/NETWORK_APIS`.
Round 11 found the sink side: `img.src = location.hash` passed all 22 checks, and
probing it found a live route on `main` — `showInfo()` joined a part name from the
model file into `innerHTML`, and a `.gltf` part named
`<style>@import'\68ttps\3a…'</style>` (it survives three.js's name sanitiser)
fetched off the machine when clicked, in a real browser. Sinks are an open set, so
the check lists the safe *values* instead.

**The harness must never destroy what it did not create.** `mutation_check.py`
edits the working tree on purpose. Its `create` field first shipped overwriting a
pre-existing file at the fixture path and then deleting it — reporting the
mutation as *caught* while destroying a contributor's uncommitted work, which git
cannot recover because the file was untracked. It now refuses any fixture path
that already exists (reported as DRIFT, nothing touched), creates files
exclusively, and removes only the files and directories it made.
`tests/test_mutation_harness.py` pins all of that — including by restoring the
original destructive behaviour and confirming the tests fail.

**A mutation must be caught by the check it names, not by any check.** For most of
this PR the harness never rebuilt `viewer.html`, so every mutation to `src/` was
"caught" by the build-fidelity check simply because `viewer.html` had gone stale.
Disabling eight offline and structure checks outright left twelve mutations still
reporting *caught* — every "N/N caught" claim made about the offline checks until
then was measuring nothing. The checks themselves did work (separate probes,
scoped to each check, showed it), but the harness offered as proof did not prove it.

Two fields now make a mutation honest. `rebuild` (default on) runs `build.py`
after the edit, as a contributor would, and restores `viewer.html` afterwards.
`expect` names the check that must be the one to fail; a failure anywhere else is
reported as a miss, naming what actually failed. Repeating the disabled-checks
experiment now reports exactly those twelve as `MISS` and nothing else.
**To trust a mutation suite, switch off what it claims to test and watch it
fail.**

**A check that cannot fail hides what it exists to find.** `--check` exited 0
whatever happened, so the CI job that installs `cascadio` the way README says
stayed green over an install that did not work: cascadio 0.1.1 imports numpy
without declaring it, and on a clean Python the engine could not load. The first
run after `--check` learned to fail found it. The launcher then misreported it —
every `ImportError` was "not installed", and the fix it prescribed was the install
that had just succeeded. **An import failure is not proof a package is missing:
read `ModuleNotFoundError.name` before prescribing a fix.**

## Verification rule

Code written is not work finished.

- **T0** — look at it; `python build.py --check` if you touched `src/`.
- **T1** — `python tests/run_checks.py` green, plus an independent diff review.
- **T2** — the above, plus the geometry suite, plus a reviewer who *ran* the
  checks rather than reading them.
- **T3** — the above, plus whatever the change specifically endangers
  (a rendered check, a large-assembly measurement, a cache-migration rehearsal),
  and an explicit statement of what remains unverified.

Never describe an unrun check as passing. `node` may be absent, in which case the
viewer tests skip and `run_checks.py` says so — that run is not green for
anything touching geometry or units.

`tests/harness.mjs` is how a viewer module is tested outside a browser: the
modules load into one `node:vm` context against THREE and DOM stubs, in filename
order, exactly as `build.py` concatenates them. Its `Vector3` must keep three.js
semantics (mutate in place, return `this`); an unfaithful stub would silently
void every test that uses it. Nothing there renders, so nothing there proves a
pixel — that needs headless Chromium and belongs to `test-engineer`.

## Scope of this file

This file records the platform note, the build contract, the repo map and the
routing policy. The earlier version deliberately defined no routing policy or
agent roster, on the grounds that inventing rules nobody agreed to is worse than
silence. That reasoning still stands — the roster below exists because it was
asked for, and the Windows note above is unchanged. Do not invent a different
tier model or add roles beyond `.claude/agents/` without being asked.
