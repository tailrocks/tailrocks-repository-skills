# Compatibility and verification

`tailrocks-repository-skills` version `0.6.4` publishes 10 skills from
one `skills/<id>/SKILL.md` tree. Each skill keeps its references, scripts,
and assets in the installed package.

## Install routes

| Host | Tailrocks distribution | Explicit invocation |
| --- | --- | --- |
| Claude Code | Native marketplace plugin | `/tailrocks-repository-skills:tailrocks-pr-create` |
| Codex | Native marketplace plugin | `$tailrocks-repository-skills:tailrocks-pr-create` in the CLI |
| Grok Build | Native marketplace plugin | `/tailrocks-pr-create` or `invocableAs` |
| Muse Code | Native marketplace snapshot | `/tailrocks-pr-create` or picker entry |
| omp | Native marketplace plugin | `/skill:tailrocks-pr-create` or resolved name |
| OpenCode V2 | Git package with server plugin | `@tailrocks-pr-create` |
| Amp | Directory plugin | Ask to load `tailrocks-repository-skills:tailrocks-pr-create` |
| Antigravity | Native local plugin install | `/tailrocks-pr-create` |
| pi | Native Git package | `/skill:tailrocks-pr-create` |
| Kimi Code | Additional native marketplace plugin | `/skill:tailrocks-repository-skills:tailrocks-pr-create` |

Claude Code, Grok Build, and omp read the shared Claude catalog. Its URL
sources carry a full commit SHA and a package version. Codex and Muse read
the full commit in the Codex catalog's `source.ref`.

Muse's portable importer reads the root Agent Plugins manifest. Keep every
skill one directory below `skills/`. Muse refuses symlinks in plugin packages.
[Portable plugin compatibility][muse]

OpenCode V2 and Amp execute small registrars at plugin load. OpenCode reads
the installed Markdown and registers the skill with its canonical file path.
Amp registers each skill directory with `registerSkill`.

The registrars add skills only. Loading this package makes no model request
and starts no background task, hook, or MCP server. A selected skill may use
its bundled scripts when the workflow calls for them.

Each host controls implicit skill selection and runtime permissions. Preserve
any explicit-user-invocation rule in the skill. Discovering or registering a
skill supplies no authority to perform the actions in its instructions.

## Invocation controls and authorization

A public skill marked user-only requires an explicit human request on every
host. Codex reads `policy.allow_implicit_invocation` from `agents/openai.yaml`.
The generated OpenCode and Amp registrars map that policy to `autoinvoke` and
`listed`, respectively.

Public skills do not set `disable-model-invocation` in `SKILL.md`. On other
hosts, their descriptions and workflow instructions carry the user-only rule.
Uniform native suppression of model discovery is not established. [Muse][muse-skills]
and [pi][pi-skills] document separate frontmatter controls for that purpose.

Discovery settings are not permission controls. A visible or loaded skill does
not authorize its workflow. Preserve the user's scope and each skill's explicit
invocation requirement even when the host can load a known skill ID.

## Verified scope

See [package verification](verification.md) for the tested revision,
tools, results, and remaining host-specific limits.

The shared pinning tests used Claude Code `2.1.328`, Codex CLI
`0.167.0-alpha.4`, Grok Build `1.0.89`, and Muse Code `1.4.24`.
Each host installed an older commit while the default branch pointed elsewhere.

A separate OpenCode `2.3.2` fixture loaded skills through its live server
registry and resolved installed script paths. The Amp registrar fixture used
an API test double. These are distinct from package-specific verification.

All 11 Antigravity manifests passed the [official schema][agy-schema].
A native test used `agy` 1.5.12 and [contribution 0.29.1 at f8a276a4][agy-test].
The CLI validated the package, installed it, and listed all five skills as
part of the enabled plugin. It loaded `.antigravity-plugin/plugin.json` ahead
of the portable manifest. Antigravity loads plugin rules from `rules/`. The
root `AGENTS.md` remains a repository maintenance file.

A registry listing establishes discovery. To verify a workflow, exercise its
specified inputs, permissions, and expected result in the intended host.
Private Git sources and hosted workspace installations require separate access.

See the [installation guide](installation.md) for install, update, and removal
commands. The [central distribution guide][distribution] records host-specific
source formats and test evidence.

[muse]: https://meta-models.github.io/muse-code-sdk/1.4/guides/plugins/concepts/compatibility/
[muse-skills]: https://meta-models.github.io/muse-code-sdk/1.4/guides/extend/skills/
[pi-skills]: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md
[distribution]: https://github.com/tailrocks/tailrocks-skills/blob/main/docs/standards/distribution.md
[agy-schema]: https://antigravity.google/schemas/v1/plugin.json
[agy-test]: https://github.com/tailrocks/tailrocks-contribution-skills/tree/f8a276a401ca58855e2c687f2bb60c120e25acc4
