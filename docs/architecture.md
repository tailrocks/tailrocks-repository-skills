# Package structure

`plugin.json` owns the package name, version, and description. The Claude,
Kimi, and Antigravity manifests repeat the shared fields and include their
host requirements. The central catalog records the exact source revision.

| Path | Purpose |
| --- | --- |
| `skills/<id>/SKILL.md` | Authoritative procedure and portable frontmatter |
| `skills/<id>/agents/openai.yaml` | OpenAI host metadata and invocation policy |
| `skills/<id>/references/model-routing.md` | Shared model and effort guidance |
| `skills/<id>/references/` and `skills/<id>/assets/` | Skills' supporting files |
| `.antigravity-plugin/plugin.json` | Antigravity package metadata |
| `bun.lock` | Resolved dependency graph maintained with Bun 1.4.4 |
| `package.json` | Private ESM package, OpenCode server export, and pi skills path |
| `adapters/opencode/index.js` | OpenCode V2 skill registration |
| `index.js` | Amp directory plugin registration |
| `scripts/validate-package.py` | Package structure check |

The npm export points to `./adapters/opencode/index.js`. It uses the pinned
`@opencode/plugin` version `2.3.2` and YAML parser version `2.9.1`. OpenCode reads
installed canonical skill files. Amp registers their paths in the plugin
checkout. Pi reads `pi.skills` with `./skills`. These routes share one skill tree.

Use `name` and `description` in portable skill frontmatter. Add `license` when
it applies and use string values in `metadata`. Use OpenAI metadata and the
registration entries to retain explicit-only selection where the host supports
it. The procedure enforces its own user-intent rules.
Keep complete directories and package-root resources. See [runtime](runtime.md).

Run the shared package generator as described in [maintenance](maintenance.md)
to refresh native files and model guidance.

Keep the script source and schema in `lib/` and `schemas/`. The vendor command
copies them into each script-backed skill. See [runtime](runtime.md).
