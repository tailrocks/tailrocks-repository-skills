# Maintenance

## Verify commands

Run these commands from the package root.

```sh
python3 scripts/validate-package.py
alint check --fail-on-warning
npm pack --dry-run --json
```

The Python validator checks native manifests, adapters, skill metadata, and
packaged resource paths. Inspect the npm file list when runtime files change.
CI checks strict JSON and skill frontmatter. See [verification](verification.md)
for the expected results and host evidence.

Use Markdownlint CLI2 `0.23.3` to check Markdown formatting. Review meaning,
policy, and authority in the changed instructions.

## TypeScript tooling

The script-backed skills use Bun and TypeScript. `mise.toml` and the
`packageManager` key in `package.json` pin Bun 1.4.4. The development tools are
`typescript` and `@types/bun`. The OpenCode adapter uses its SDK and YAML parser
as package dependencies. Run each command from the repository
root. Every command must exit 0.

Install the dependencies:

```sh
bun install --frozen-lockfile
```

Type check:

```sh
bun run typecheck
```

Expected result: no errors.

Tests:

```sh
bun test
```

Expected result: all tests pass. The tests cover the process layer, the
safety guards, the policy loader, the vendored copies, and the
generic-name rule.

Copy the shared library into each script-backed skill:

```sh
bun run vendor
```

The source is `lib/` and `schemas/`. A skill is script-backed when
`skills/<id>/scripts/` holds a `.ts` file. The command writes
`skills/<id>/scripts/lib/` and `skills/<id>/scripts/schemas/`. Never
edit a copy by hand. `bun test` fails when a copy differs from its
source. Run `bun run tools/vendor-lib.ts --check` to list the
differences without a write.

## Policy version and update

The generated CI uses Alint `0.21.0`. The `.alint.yml` file pins the central
`standards/alint/active.yml` profile by source revision and SHA-256. Review
changes to that profile. Update both parts of the pin together. Repeat the
verification commands after the update.

## CI source and regeneration

Use Velnor Actions `0.1.80` from source commit
`b71a0045e42f6a8b620aa9283d0106bed622fe3b`. The
[release manifest](../.velnor/release-manifest.json) records the binary digests.
The input is `.velnor/config.toml`. CI runs Alint, strict JSON, frontmatter ID,
and Lychee `0.15.1` with `--offline --include-fragments`. The link check covers
local files and anchors. Generated Jactionlint and the plan feed the same
required verdict.

Change the generator input and run `velnor-actions generate`. Keep the
input and generated files together. The generator preserves the repository's
`.github/PULL_REQUEST_TEMPLATE.md` file.

Compare the generated files with a fresh preview.

```sh
package_preview="$(mktemp -d)"
velnor-actions generate --output-dir "$package_preview"
diff -r --brief .github "$package_preview/.github"
```

An empty diff confirms the recorded generator can reproduce the files.

Repository Skills also runs the `ci:bun-checks` Mise task as a required
verification job. The task uses `aqua:oven-sh/bun` and runs the frozen dependency
install, type check, and tests. `mise.toml` and `mise.lock` supply the inputs.
Keep the lock at `lockfile_version = 3`. Use `mise lock` to update it and
regenerate the workflow after either input changes.

## Release and migration

Update the version and description in `plugin.json` when the release requires
it. Use the central generator to sync equivalent host metadata and the shared
files. From the catalog checkout, point the generator at the directory that
contains the plugin checkouts.

```sh
python3 scripts/sync-packages.py --workspace /path/to/plugin-checkouts
python3 scripts/sync-packages.py --workspace /path/to/plugin-checkouts --check
```

Review changes from `standards/native/` and `standards/models/model-routing.md`
in the catalog checkout. Update `CHANGELOG.md`. Run the package checks and regenerate
CI when its inputs change. Tag the verified release commit, publish it, and
record its exact revision in the central catalog. Regenerate the central native
catalogs after that revision is available. Check the published tag and catalog pin.
Use [installation](installation.md) to migrate or remove an installed version.

## Prohibited evaluation content

Never add evaluation content to skills, references, templates, task
definitions, or CI. This ban covers behavioral benchmarks, trigger
precision and recall, repeated model trials, scored wording
comparisons, model-family matrices, and pressure scenarios. It also
covers holdout datasets, judge or grader models, pass-rate targets,
token and latency comparisons, mandatory failing baselines, and task
trials under any name. Do not relabel such work as smoke, pressure,
or compatibility checks. A sample task never proves behavior.

Before aggregate commands, read each task definition and strip
evaluation steps. Never trust the command name. To find violations,
search case-insensitively for `benchmark`, `trigger precision`,
`trigger recall`, `model trial`, `scored output`, `model-family`,
`pressure scenario`, `holdout`, `judge`, `grader`, `pass-rate`, and
`task trial`. Read the surrounding text before a change: a
prohibition or a historical explanation is not an active
requirement.
