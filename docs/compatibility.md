# Compatibility

This record covers each client and route. The default outcome is
unverified. Each unverified row names its reason. A route is never
unsupported only because its binary is absent. A route is never
verified only because a different client accepted the same files.

## Results

| Client | Version | Route | Outcome |
| --- | --- | --- | --- |
| Claude Code | 2.1.289 | Marketplace | Unverified: not run. |
| Claude Code | 2.1.289 | Local path | Trial result below. |
| Codex | 0.160.1 | Marketplace | Unverified: not run. |
| Codex | 0.160.1 | Local path | Unverified: not run. |
| Amp | unversioned | Per-skill add | Unverified: CLI absent. |
| Muse Code | 1.4.3 | Marketplace | Unverified: not run. |
| Muse Code | 1.4.3 | Local path | Unverified: not run. |
| OpenCode V1 | unversioned | Skills copy | Unverified: CLI absent. |
| OpenCode V2 | unversioned | Skills copy | Unverified: CLI absent. |
| Antigravity | unversioned | Local path | Unverified: CLI absent. |
| Antigravity | unversioned | Skills copy | Unverified: CLI absent. |
| Grok Build | unversioned | Marketplace | Unverified: CLI absent. |
| Grok Build | unversioned | Skills copy | Unverified: CLI absent. |
| Kimi Code | unversioned | Manager pin | Unverified: CLI absent. |

The trial ran on 2026-10-07 with Claude Code 2.1.289 in an
isolated HOME. Marketplace add passed and install passed. The list
showed the plugin enabled with all seven skills of 0.4.1 and no hooks or MCP
servers. Uninstall passed and marketplace remove passed. The closing
list was empty. The trial used a throwaway local marketplace built
from the branch checkout.
The real user config was untouched. No model task ran and no skill
executed.

## User-only enforcement

This table records documented support, not runtime verification. The
frontmatter of all ten skills holds `name`, `description`, and
`license` only: that is the set that every client loads. No skill
carries `disable-model-invocation`, `user-invocable`,
`disableModelInvocation`, `when_to_use`, or `argument-hint`. The two
user-only skills (`tailrocks-repository-recover` and
`tailrocks-repository-merge`) express user-only entry in two places:
their description starts with "Use only when the user explicitly
asks", and their `agents/openai.yaml` sets
`policy.allow_implicit_invocation: false`. Enforced means the client
blocks automatic model invocation from the package files. Prompt-only
means the client reads the description and the body rule. A hard block
needs a key that this package no longer ships. The notes below the
table name that key and where the user can set it, if the client
supports it.

| Client | Recover and repository-merge entry |
| --- | --- |
| Codex | Enforced (`allow_implicit_invocation: false`). |
| Claude Code | Prompt-only. User setting can enforce (note 1). |
| Kimi Code | Prompt-only. Local frontmatter key needed (note 2). |
| Grok Build | Prompt-only. Local frontmatter key needed (note 2). |
| Cursor | Prompt-only. Local frontmatter key needed (note 2). |
| Amp | Limited: lists every skill to the model. |
| Antigravity | Limited: frontmatter holds `name` and `description` only. |
| Muse Code | Limited: recall observer can surface skills. |
| OpenCode V1 | Gated by `permission.skill: ask`. |

1. Claude Code documents the user setting `skillOverrides` set to
   `user-invocable-only`.
2. The hard block is a frontmatter key: `disableModelInvocation` on
   Kimi Code, `disable-model-invocation` on Grok Build and Cursor. This
   package no longer ships these keys. The user adds the key in a local
   copy of the skill, if the client supports it.

## Static fit

These facts were observed on 2026-10-07 from the package files. They
are not install proofs:

- All ten frontmatter names match their skill directories. Each
  frontmatter holds `name`, `description`, and `license` only.
- All names are 28 characters or less. All descriptions are 1024
  characters or less. The Amp, OpenCode, and Kimi caps fit.
- The root manifest carries the Agent Plugins 1.0.0 schema id.
- The Kimi manifest sets `skills` to `./skills/`.
- Every payload file under `skills/` is text. No file carries the
  executable bit.
- Six skills carry a `scripts/` directory with TypeScript files. Bun
  runs them. A plugin delivers files, not runtimes: the user installs
  Bun 1.4 or newer. No manifest adds a hook or an MCP server.
