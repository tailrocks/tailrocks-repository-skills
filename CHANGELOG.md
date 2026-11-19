# Changelog

## 0.6.4 - 2026-11-20

- Complete the shared model API controls and reasoning-state guidance.
- State the native discovery limits for user-invoked workflows.
- Preserve the portable author in the Claude manifest and validate that match.
- Use the shared release procedure with full commit pins and optional tags.

## 0.6.3 - 2026-11-20

- Refresh the shared validator for user-invoked policy packages and the
  retirement of the standalone Vitalik Mode package.

## 0.6.2 - 2026-11-20

- Enforce portable description characters and the shared 500-line skill limit.
- Clarify native Grok confirmation and record Antigravity installation evidence.

## 0.6.1 - 2026-11-20

- Replace backtracking in package validation with bounded parsing.
- Commit and ship the resolved dependency graph with pinned Bun 1.4.4.

## 0.6.0 - 2026-11-20

- Documented pinned native installs across the Tailrocks hosts, including
  OpenCode V2, Amp, Antigravity, omp, and pi.
- Added shared model guidance, portable skill metadata, and native package
  validation.
- Aligned generated CI on Velnor Actions 0.1.80 with offline link and anchor
  checks.
- Kept the Bun checks and vendored helper files in the shared package layout.

## 0.5.1 - 2026-11-19

Fixed the frontmatter of the four kept skills. omp 18.20.2 skipped
`tailrocks-repository-recover`, `tailrocks-repository-merge`,
`tailrocks-pr-template`, and `tailrocks-review-pr`, because the Agent Plugins
loader rejects `argument-hint`. The Codex validator rejects the same keys.

Changed:

- The frontmatter of all ten skills now holds `name`, `description`, and
  `license` only. The four skills lost `argument-hint`, `user-invocable`,
  `disable-model-invocation`, `disableModelInvocation`, and `when_to_use`.
- The trigger text of `tailrocks-pr-template` and `tailrocks-review-pr` moved
  into the description, trigger first. The argument syntax of
  `tailrocks-pr-template` moved into its body. The other three skills already
  listed their arguments in the body.
- `tailrocks-repository-recover` and `tailrocks-repository-merge` stay
  user-only. Their description now starts "Use only when the user explicitly
  asks", the body keeps the explicit-request rule, and `agents/openai.yaml`
  keeps `policy.allow_implicit_invocation: false`. Codex enforces that flag.
  On Claude Code, Kimi Code, Grok Build, and Cursor, the package no longer
  sets a frontmatter gate. Those keys are frontmatter keys that the package no
  longer ships. For a hard block, the user adds the key in a local copy of the
  skill, or on Claude Code sets the `skillOverrides` user setting. See
  `docs/compatibility.md`.

Added:

- A test that fails when any `skills/*/SKILL.md` frontmatter holds a key other
  than `name`, `description`, and `license`.

## 0.5.0 - 2026-11-19

Replaced the prose-only pull-request skills with script-backed skills. A
script computes each gate. The agent no longer decides from memory which gates
exist. Design: `docs/design/pr-skills.md`.

Added:

- `tailrocks-pr-status`: one verdict per PR (READY, WAITING, or BLOCKED), with
  the next action and its owner for each blocker. Read-only.
- `tailrocks-pr-create`: create one draft PR under the policy, with signed
  commits and pre-push checks.
- `tailrocks-pr-refresh`: sync with the base, fix sign-off, and reconcile the
  title and body.
- `tailrocks-pr-threads`: triage review threads, reply, and resolve them under
  the policy.
- `tailrocks-pr-merge`: guarded `ready`, `merge`, `dequeue`, and `watch` steps.
  It writes only after `--confirm`.
- `tailrocks-pr-fleet`: rank all open PRs, plan work under a CI budget, and
  apply it through the other skills. It writes only with `--apply`.
- The repository policy file `.config/pr-policy.toml`. The skills read it from
  the default branch at its current commit, never from a PR head or from the
  base of a stacked PR. `schemas/pr-policy.schema.json` holds the contract.
  `examples/` holds example policies. Without the file, built-in defaults and
  the rules that GitHub enforces apply.
- Bun 1.4 or newer as the runtime of the script-backed skills. The scripts are
  TypeScript, call only `gh` and `git`, and have no runtime dependencies.
  `bun run vendor` copies the shared library `lib/` into each script-backed
  skill.

Removed, with no aliases:

- `tailrocks-create-pr`: use `tailrocks-pr-create`.
- `tailrocks-refresh-pr`: use `tailrocks-pr-refresh`.
- `tailrocks-merge-pr`: use `tailrocks-pr-merge`.

Changed:

- `tailrocks-review-pr`, `tailrocks-pr-template`, `tailrocks-repository-merge`,
  and `tailrocks-repository-recover` link to the new skill ids.
- The package holds ten skills.

## 0.4.1 - 2026-10-08

Applied the common active-package structure on branch
`standardize/common-package`:

- Rewrote `plugin.json` as the portable Agent Plugins 1.0.0 manifest.
  It is now the source of truth for name, version, and description.
- Trimmed `.claude-plugin/plugin.json` to name, version, and
  description.
- Rewrote `.kimi-plugin/plugin.json` with `skills` set to `./skills/`
  and a four-field interface block.
- Removed the component marketplace file
  `.claude-plugin/marketplace.json`. The central `tailrocks`
  marketplace is now the only catalog.
- Removed the legacy host manifests `.codex-plugin/` and
  `.muse-plugin/`. Codex uses the portable manifest. Muse reads the
  Claude manifest through its foreign-adapter import.
- Removed the dead root files `catalog.json` and `index.ts`. Nothing
  referenced them.
- Added `.alint.yml`, pinned to the shared active profile.
- Restructured `README.md` into the eight required sections.
- Replaced the old docs/client-invocation.md install guide with the
  six standard guides under `docs/`.
- Added `AGENTS.md` and `.github/PULL_REQUEST_TEMPLATE.md`.
- Rewrote all seven `skills/*/SKILL.md` files in ASD-STE100
  Simplified Technical English: `tailrocks-create-pr`,
  `tailrocks-refresh-pr`, `tailrocks-review-pr`,
  `tailrocks-merge-pr`, `tailrocks-pr-template`,
  `tailrocks-repository-recover`, `tailrocks-repository-merge`.
  Restated each procedure as numbered imperative steps with one
  result section and one completion-check list. Kept every skill
  task unchanged. Updated the companion reference files to match
  the new prose. Retargeted the install-guide links in
  `skills/tailrocks-repository-merge/SKILL.md`.
- Regenerated CI with Velnor Actions 0.1.4.
- Replaced the `.github/CLAUDE.md` symlink with a regular pointer
  file. Installers that reject symlinks now accept the package.

## 0.4.0 - 2026-10-07

Seven-skill package at commit `759849769249b5a4ada95595914ab8e81daf618b`
("recovery skill plus user-only merge migration"). Five skills are
model-selectable. `tailrocks-repository-recover` and
`tailrocks-repository-merge` are user-only and need an explicit human
command.
