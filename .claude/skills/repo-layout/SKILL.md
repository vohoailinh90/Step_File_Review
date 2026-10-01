---
name: repo-layout
description: Keep a repository's root to the files a user needs to run the app — entry-point launchers, README, dependency files — and put tests, library modules, helpers and data in their own directories. Use whenever a requirement adds a new Python file, test, script or module to a repository created from this template, when scaffolding a new app or tool, when the user says the root is cluttered, hard to tell which file starts the app, "sắp xếp lại thư mục", "dọn thư mục gốc", "フォルダ構成を整理", or asks to restructure/reorganize a repository's layout.
---

# Repository layout

A user opening the repository must see, in the root, which file starts the app.
Forty `.py` files side by side — the app, its helpers and every test — hide
that. This skill fixes where each kind of file goes, and
`python3 scripts/layout_check.py` (repository root) is the gate: whether a root
`.py` is a test, a library module or an entry point is computable, so it is a
script and a CI step, not something a reviewer eyeballs.

Like `ui-kit` and `bilingual`, this changes what the implementation step
produces, not who performs it: it adds no role and raises no rubric dimension.

## The layout

```text
<repo>/
├── README.md  CLAUDE.md  AGENTS.md  LICENSE  .gitignore
├── requirements.txt  requirements-dev.txt  (or pyproject.toml)
├── <app>.py              # entry point(s) only — thin launchers, at most 3
├── <app>_gui.py          #   e.g. one CLI + one GUI
├── <app>/                # the app's package: every module the launchers import
│   ├── __init__.py
│   ├── core.py
│   ├── report.py
│   └── locales/          # ja.json + en.json (see the bilingual skill)
├── tests/                # every test_*.py, conftest.py
│   ├── support/          # test helpers, fakes (was test_support/)
│   └── fixtures/         # sample input files
├── scripts/              # developer/ops tooling that is not the app
├── docs/
└── data/ or samples/     # sample inputs a user may need; never generated output
```

Rules, each one checked by `layout_check.py` unless marked *(judgement)*:

1. **Tests live in `tests/`.** `test_*.py`, `*_test.py`, `conftest.py`, and
   anything named like a test (`run_tests_sample.py`) never sit in the root.
   Test helper directories go under `tests/` (`tests/support/`), never a root
   `test_support/`.
2. **A root `.py` is an entry point**, i.e. it has a top-level
   `if __name__ == "__main__":`, or it is a Streamlit app (imports
   `streamlit` at the top level; `streamlit run app.py` is how it starts). A
   file that is neither is a library module and belongs in the package.
   `setup.py` and `noxfile.py` are exempt.
3. **At most 3 root entry points** (`--max-root-scripts` changes the limit when
   a repository genuinely ships more launchers; record why in its CLAUDE.md).
4. **A launcher stays thin** *(judgement)*: parse arguments, call into the
   package. Logic in a launcher cannot be imported by a test without running
   the launcher.
5. **Generated output never lands in the root** *(judgement)*: reports, logs,
   exports go to an `output/` (gitignored) or a user-chosen path.

Use a plain `<app>/` package, not `src/<app>/`, for a tool users run from a
checkout: `python <app>.py` then imports it with no install step. Switch to
`src/` only when the project is installed as a distribution
(`pip install .`).

## Making tests find the package

With modules in `<app>/` and tests in `tests/`, `import <app>` must work from
a test run started in the root. Pick the one that matches the test runner:

- **pytest** (7.0+, for `pythonpath`) — `pytest.ini` (or `[tool.pytest.ini_options]`):
  ```ini
  [pytest]
  testpaths = tests
  pythonpath = .
  ```
- **unittest** — run from the root: `python -m unittest discover -s tests -t .`
  (add an empty `tests/__init__.py`).

## Restructuring an existing repository

1. **Inventory.** `python3 scripts/layout_check.py` lists every file that must
   move. For each remaining root `.py`, decide: launcher users run (stays),
   module (→ package), tool (→ `scripts/`).
2. **Move with history.** `git mv test_x.py tests/`, `git mv x.py <app>/x.py`
   — never delete-and-recreate, which loses `git log --follow`.
3. **Fix imports.** `import x` → `from <app> import x`; inside the package use
   relative or absolute `<app>.` imports. Grep for the old module names,
   including string uses (`importlib`, `mock.patch("x.func")`, PyInstaller
   specs, `.bat`/`.sh` launchers, CI workflows, README commands).
4. **Fix paths.** Code that reads files with `Path(__file__).parent` now sits
   one level deeper; tests that build paths from the root likewise.
5. **Verify.** The full test suite, `python3 scripts/layout_check.py`, and
   each launcher started once (`python <app>.py --help`). A test suite that
   passes but was never collected from its new place proves nothing — check
   the collected count did not drop.
6. **Commit the move alone**, separate from any behavior change, so a reviewer
   can confirm it is a pure move (`git diff -M --stat`).

## Guardrails

- A restructure touches every import; it is not a T0 change. Route it through
  the normal flow (usually T1: scope 1, verification 1).
- Do not rename public entry points a user or a scheduled task already calls
  (`.bat` shortcuts, Task Scheduler, cron) without keeping a launcher at the
  old name or telling the user.
- Do not move agent tooling (`scripts/`, `.claude/`, `agent-routing/`,
  `evals/`) as part of a layout restructure.
