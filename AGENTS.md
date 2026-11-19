# AGENTS.md

This package holds ten repository and pull-request skills. Install it
as one unit. Do not copy one `SKILL.md` file out of its skill directory.
Six skills (`pr-status`, `pr-create`, `pr-refresh`, `pr-threads`,
`pr-merge`, `pr-fleet`) carry a `scripts/` directory that runs with Bun.

## Structure

- `plugin.json` is the portable manifest. It is the source of truth
  for name, version, and description.
- Keep the Claude, Kimi, and Antigravity manifests and `package.json`
  aligned with the portable manifest.
- `skills/` holds one directory per skill id. Each directory holds its
  own `SKILL.md` file plus its own references. A script-backed skill
  also holds `scripts/`. Its `scripts/lib/` and `scripts/schemas/` are
  copies of `lib/` and `schemas/`. Run `bun run vendor` after a change
  to either source. Never edit a copy.
- `docs/` holds the package guides. Start at [the package guide](docs/README.md).
- `lib/`, `schemas/`, `examples/`, `tools/`, and `tests/` hold the
  shared TypeScript library, the policy schema, example policies, the
  vendoring tool, and the tests. See `docs/maintenance.md`.
- Keep `adapters/opencode/index.js` and root `index.js` limited to
  native skill registration. Keep runtime resources in the installed package.
- Keep the OpenAI metadata and the model-routing reference with each skill.
  Use portable frontmatter. Keep explicit-only rules in the procedure,
  OpenAI policy metadata, and the generated registration entries.

## Rules for changes

- Keep the `SKILL.md` frontmatter to `name`, `description`, and
  `license`. Never add `argument-hint`, `when_to_use`,
  `user-invocable`, `disable-model-invocation`, or any other key: the
  Codex validator and omp reject them. Put trigger text in the
  description and argument syntax in the body. Express manual-only
  entry with a description that starts "Use only when the user
  explicitly asks" and `policy.allow_implicit_invocation: false` in
  `agents/openai.yaml`.
- Write all new and changed prose in ASD-STE100 Simplified Technical
  English, Issue 9 rules.
- Never hand-edit `.github/`. Change `.velnor/config.toml` and
  regenerate. The generator preserves
  `.github/PULL_REQUEST_TEMPLATE.md`. See `docs/maintenance.md`.
- Never add evaluation content: no benchmarks, no model trials, no
  scored comparisons, no pass-rate targets. See `docs/maintenance.md`.
- Keep one fact in one place. Link to `docs/` guides. Do not copy
  skill bodies into guides.

## Checks before a pull request

Run these checks from the repository root:

```sh
python3 scripts/validate-package.py
alint check
bun install --frozen-lockfile
bun run typecheck
bun test
```

See `docs/maintenance.md` for the strict-JSON check, the frontmatter
check, and the full check list with expected results.
