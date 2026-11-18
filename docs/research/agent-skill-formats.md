# Agent skill and plugin formats (researched 2026-11-19)

<!-- markdownlint-disable MD013 -->

This note compares how eight coding agents load skills (`SKILL.md`) and plugins. It covers Claude Code 2.1.325, Codex (codex-cli 0.169.0), Grok Build 1.0.70, Kimi Code 2.6.1, Muse Code 1.4.20-R8619.1, omp 18.20.2, pi 1.5.2 and Antigravity CLI (`agy`) 1.5.9. The method was the same for each agent. We read the official docs on 2026-11-19, then checked the claims against the locally installed binary: `--help` output, embedded strings, bundled docs and source, and read-only `validate` or `list` runs on throwaway fixtures. For Muse, omp, pi and agy we made no installs, logins or config changes. Most pages show no publish date, so the Sources table gives "accessed 2026-11-19" unless a date was visible.

Every fact carries one of three evidence tags.

- **[BIN]**: verified in the local binary. This means either a command was run against the installed CLI (for example `validate`, `list`, `--help`), or the fact was read from the installed binary, package, bundled docs or source.
- **[DOC]**: from the vendor's official docs. Source URLs are listed in each agent section and in the Sources table.
- **[UNVERIFIED]**: from a third-party page, or inferred, or a command that was not run in a real session.

## Summary matrix

| Agent (version) | Required skill keys | Notable optional keys | Skill discovery paths | Plugin manifest path | Reads `.claude-plugin`? | Reads `.agents/skills`? | Local test-load | Validator |
|---|---|---|---|---|---|---|---|---|
| Claude Code 2.1.325 | none in Claude Code (`name` defaults to the directory); `name` + `description` for API upload [DOC] | `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`, `metadata`, `license`, `compatibility` | `~/.claude/skills`, `.claude/skills`, nested `<subdir>/.claude/skills`, `--add-dir` dirs, plugin `skills/`, managed-settings dir [DOC] | `.claude-plugin/plugin.json` (optional) | yes, native | no (not documented; unverified in binary) | `claude --plugin-dir <path>` [BIN] | `claude plugin validate <path>` [BIN] |
| Codex 0.169.0 | `name`, `description` | validator allows only `license`, `allowed-tools`, `metadata`; optional `agents/openai.yaml` | `.agents/skills` (cwd up to repo root), `~/.agents/skills`, `/etc/codex/skills`, bundled; `$CODEX_HOME/skills` still a root in the binary | root `plugin.json` (portable); `.codex-plugin/plugin.json` fallback | yes (`.claude-plugin/plugin.json` and `marketplace.json`) | yes | `codex plugin marketplace add <path>` then `codex plugin add <plugin>@<marketplace>`; no `--plugin-dir` | skills only: embedded `quick_validate.py` via `$skill-creator`; no plugin validator |
| Grok Build 1.0.70 | none (`name` defaults to the directory, `description` to the first body paragraph) | `when-to-use`, `allowed-tools`, `argument-hint`, `user-invocable`, `disable-model-invocation`, `model`, `effort`, `license`, `compatibility`, `metadata`, `paths` [DOC] | `.grok/skills` (cwd, repo root), `~/.grok/skills`, `.agents/skills` in every tier, `.claude/skills`, `.cursor/skills` | optional; root `plugin.json`, `.grok-plugin/plugin.json`, `.claude-plugin/plugin.json` (not `.codex-plugin`) | yes | yes | `grok plugin install <abs-path> --trust` then enable; or `grok agent --no-leader --plugin-dir <path> stdio` | `grok plugin validate <path>` |
| Kimi Code 2.6.1 | `name`, `description` (directory form) | `type`, `whenToUse`, `disableModelInvocation`, `arguments` | `~/.kimi-code/skills`, `~/.agents/skills`, `.kimi-code/skills`, `.agents/skills`, `extra_skill_dirs` | `kimi.plugin.json` or `.kimi-plugin/plugin.json` | no | yes | skills: `kimi --skills-dir <dir>`; plugin: `/plugins install <abs-path>` in the TUI | none; `/plugins info <id>` diagnostics |
| Muse Code 1.4.20 | `description` (`name` is the skill id) | `license`, `metadata`, `compatibility`, `allowed-tools`, `disable-model-invocation`, `experimental-gate` | `~/.agents/skills`, `~/.claude/skills`, `$CODEX_HOME/skills` (else `~/.codex/skills`), `~/.config/muse/skills`; project `.agents/skills`, `.claude/skills`, `.codex/skills` (trusted workspace only) | `.muse-plugin/plugin.json` (native); also `.claude-plugin/`, `.codex-plugin/`, root Agent Plugins `plugin.json` | yes (verified) | yes | skill in `<ws>/.agents/skills/<id>/` plus `muse --trust-workspace`; no ephemeral plugin flag | `muse skills validate <dir> --json`; `muse plugins validate <dir> --json` |
| omp 18.20.2 | `description` in native, `omp-plugins`, `.github/skills` and custom dirs; `name` defaults to the directory | `globs`, `alwaysApply`, `hide`, `disable-model-invocation`, `enabled` | `.omp/skills` (walk up), `~/.omp/agent/skills`, `.claude/skills`, `.agents/skills`, `.agent/skills`, `~/.codex/skills`, `.codex/skills`, `.github/skills`; `~/.agents/skills` loads by default | `.omp-plugin/plugin.json`, `.claude-plugin/plugin.json`, or root `plugin.json` | yes (manifest, marketplace fallback, project `.claude/skills`); user `~/.claude/skills` is opt-in | yes | drop skill in `<repo>/.omp/skills/<name>/`; `omp -e`; `omp --plugin-dir` (effect not verified) | `omp skill list --json`; `omp skill publish --dry-run` (strict) |
| pi 1.5.2 | `description` (skill is not loaded without it); `name` falls back to the directory | `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation` | `~/.pi/agent/skills`, `~/.agents/skills`, `.pi/skills`, `.agents/skills` (cwd and ancestors), `skills` arrays in settings | `package.json` with a `pi` key, or conventional `skills/` dir | no (not mentioned in the docs read) | yes | `pi --skill <file-or-dir>`; `pi -e <path>` | none; startup diagnostics |
| Antigravity `agy` 1.5.9 | `description` (missing is only a warning); set `name` anyway | none enforced; unknown keys pass | `<ws>/.agents/skills` (also `.agent`, `_agents`, `_agent`), `~/.gemini/config/skills`, plugin `skills/`, `~/.gemini/antigravity-cli/skills`, `~/.gemini/skills` | `plugin.json` at root, `.antigravity-plugin/` or `.gemini-plugin/` | no (alone it fails validate; `plugin install` converts it) | yes | place under `<ws>/.agents/skills/` or `<ws>/.agents/plugins/`; no `--plugin-dir` or `--skill` flag | `agy plugin validate <dir> [--strict] [--json]` |

Matrix cells are tagged in the agent sections below. Where a cell has no tag, the tag in the matching agent section applies.

## Portable baseline

This section lists what loads in all eight agents without errors or warnings.

### Skill frontmatter

Use exactly two required keys and, if needed, two optional ones.

```yaml
---
name: example-skill
description: Does X. Use when the user asks for Y or mentions Z.
---
```

- `name` [DOC, agentskills.io]: 1-64 characters from `[a-z0-9-]`, no leading or trailing hyphen, no `--`, and equal to the parent directory name. Claude's API path also forbids XML tags and the words `anthropic` and `claude` in the name [DOC].
- `description` [DOC, BIN]: 1-1024 characters, no `<` or `>`. Codex's validator rejects angle brackets and a leading `[TODO:` [BIN]. Say what the skill does and when to use it.
- Optional and safe: `license`, and `metadata` as a string-to-string map. Codex's validator and the Claude API upload path both accept these two [BIN, DOC].
- `allowed-tools` is accepted by Claude, Codex's validator, Muse and pi, but it is experimental in the spec and means different things per agent. Grok says it neither grants nor restricts tools [DOC]. Leave it out unless one agent needs it.
- `compatibility` is in the spec but Codex's validator rejects it [BIN]. Leave it out.
- Layout: flat `skills/<name>/SKILL.md`. omp and agy scan one level deep, and Kimi stops at depth 8, so nesting breaks portability [DOC, BIN]. pi scans recursively and does not mind a flat layout.
- Body: under 500 lines and about 5000 tokens, references one level deep [DOC].

### Plugin manifests

A repo that ships all three manifests below is read by every agent that has a plugin concept. pi has no manifest file in this family and takes the conventional `skills/` directory of a package (see the pi section).

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "example-plugin",
  "description": "Example."
}
```

The block above is illustrative. Only the exact `$schema` string is verified [BIN]. Muse rejects any other `$schema` value as a hard error [BIN].

```json
{
  "name": "example-plugin",
  "skills": "./skills/"
}
```

The second block is the `.kimi-plugin/plugin.json` shape. Kimi does not auto-scan `skills/`. Without the `skills` field, only a root `SKILL.md` is used, and each path must start with `./` and name a directory inside the plugin root [BIN, DOC].

| Manifest file | Read by | Not read by |
|---|---|---|
| root `plugin.json` with the exact Agent Plugins 1.0.0 `$schema` | Codex, Grok, Muse, omp; agy only with its `enable-agent-plugins-spec` flag, otherwise as a native plugin [BIN, DOC] | Claude Code (docs never mention it; validator reads only `.claude-plugin/plugin.json`), Kimi |
| `.claude-plugin/plugin.json` | Claude Code, Codex, Grok, Muse, omp [BIN, DOC] | Kimi; agy rejects it alone at `validate` and converts it only at `plugin install` [BIN] |
| `.kimi-plugin/plugin.json` with `"skills": "./skills/"` | Kimi [BIN] | everyone else |

The hybrid layout (root `plugin.json` plus `.claude-plugin/plugin.json`) was tested [BIN]:

- Muse: `valid: true`, family `agent-plugins`. The duplicate fields in the overlay are reported as "inactive beside the authoritative Agent root", so the result is not diagnostics-free.
- agy: passes.
- Grok: `grok plugin validate` reported a valid manifest and one skill directory.
- Claude Code: `claude plugin validate` passed with warnings (no author, no icon).
- Kimi: the `.kimi-plugin/plugin.json` with `"skills": "./skills/"` is valid.

### Non-portable keys and what they break

| Key or practice | What happens | Evidence |
|---|---|---|
| Any key outside `name`, `description`, `license`, `allowed-tools`, `metadata` (for example `compatibility`, `when_to_use`, `argument-hint`, `user-invocable`, `model`, `disable-model-invocation`) | Codex `quick_validate.py` fails the skill | [BIN] |
| Any key outside `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` | Anthropic API and claude.ai upload hard-error | [DOC] |
| Unknown keys in general | Claude Code, Grok and Muse ignore them (Muse lists them under `unknown_fields`); agy passes them; omp preserves them in native roots | [BIN, DOC] |
| Unknown keys in an Agent Plugins package, or any key in `omp skill publish` | omp rejects them ("unexpected frontmatter field"); `hide` and `enabled` are not allowed there | [DOC, BIN] |
| `hide`, `enabled`, `globs`, `alwaysApply` | omp-only; other agents ignore or reject them as above | [DOC] |
| `disable-model-invocation` | Codex validator rejects it; Codex uses `policy.allow_implicit_invocation` in `agents/openai.yaml` instead. Kimi spells it `disableModelInvocation` and accepts the hyphen and underscore aliases | [BIN] |
| `description` over 1024 characters | pi warns but loads; Muse and agy are silent; Codex validator and spec reject; Claude Code truncates its listing at 1,536 characters | [BIN, DOC] |
| Uppercase or underscore in `name`, or `name` different from the directory | pi warns but loads; Muse and agy accept silently; spec, omp strict paths and Codex validator reject | [BIN, DOC] |
| Missing `description` | pi and Muse refuse to load; omp native refuses; Kimi gives a parse error; agy warns only; Claude Code and Grok fall back (Grok to the first body paragraph) | [BIN, DOC] |
| `<` or `>` in `description` | Codex validator rejects; Anthropic docs forbid XML tags | [BIN, DOC] |
| Nested skill directories | omp and agy read one level only | [DOC, BIN] |
| `skills/` directory without `"skills"` in the Kimi manifest | Kimi loads nothing from it | [BIN, DOC] |
| `$schema` other than the exact Agent Plugins URL | Muse hard error ("unsupported-agent-schema") | [BIN] |
| Plugin `name` starting with `claude-`, `anthropic-` or `cc-plugin-`, or containing spaces, `@`, `:` or `/` | Claude Code rejects it | [DOC] |

## Per-agent notes

### Claude Code

Version 2.1.325. Sources: <https://code.claude.com/docs/en/skills>, <https://code.claude.com/docs/en/plugins-reference>, <https://code.claude.com/docs/en/plugin-marketplaces>, <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices> (all accessed 2026-11-19).

- Skill fields: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths`, `shell`, and informational `metadata`, `license`, `compatibility` (at most 500 characters). [DOC, BIN: every key is in the binary's string table]
- Every field is optional in Claude Code. `name` defaults to the directory name. Unknown keys are silently ignored. [DOC]
- API and Agent Skills platform limits: `name` at most 64 characters of lowercase letters, digits and hyphens, no XML tags, no reserved words `anthropic` or `claude`; `description` at most 1024 characters, non-empty, no XML tags. [DOC]
- Reserved skill names: `synced`, `anthropic-skills`, and any name starting with `anthropic-skills:`. [DOC]
- Listing: `description` plus `when_to_use` is truncated at 1,536 characters per skill (`skillListingMaxDescChars`, "default: 1536"). The whole listing is budgeted at 1% of the context window by default. [BIN]
- After compaction, each skill's latest invocation is re-attached at up to 5k tokens per skill and 25k in total. [DOC]
- Substitutions: `$ARGUMENTS`, `$N`, `$name`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`, `${user_config.KEY}`. [DOC]
- Precedence: enterprise, then personal, then project. Plugin skills are namespaced `/plugin:skill`. [DOC]
- Claude Code does not scan `.agents/skills`. The docs do not mention it, and this was not checked in the binary. [UNVERIFIED]
- Manifest `.claude-plugin/plugin.json` is optional. Without it, components load from the standard layout. Required key: `name` in kebab-case. [DOC, BIN]
- Optional manifest keys include `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `userConfig`, `dependencies`, `engines{"claude-code": semver}` (needs 2.1.323 or later; 2.0.15 through 2.1.75 reject it), `skills` (adds to `skills/`), `commands`, `agents`, `outputStyles`, `workflows` (these replace their default directories), `hooks`, `mcpServers`, `lspServers` (these merge). Component paths must start with `./` and stay inside the plugin root. Unknown top-level keys are stripped with a warning. [DOC, BIN]
- Default plugin layout: `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `workflows/`, `themes/`, `monitors/monitors.json`, `bin/` (added to PATH). A root `SKILL.md` loads as one skill only when there is no `skills/` directory. [DOC, BIN]
- Marketplace: `.claude-plugin/marketplace.json` with `name`, `owner{name}` and `plugins[]` (each needs `name` and `source`). Source kinds: relative `./path`, `github`, `git-subdir`, `url`, `archive`, `npm`, `command`. [DOC, BIN]
- CLI: `claude plugin marketplace add`, `install <plugin>@<marketplace>`, `list`, `details`, `enable`, `disable`, `update`, `uninstall`, `validate [--strict] [--json]`, `init|new`, `tag`, `eval`. In session: `/plugin marketplace add`, `/plugin install`, `/reload-plugins`. [BIN]
- Local test: `claude --plugin-dir /path` lasts for one session, is repeatable, and also accepts a `.zip` or a folder of plugins. A local-path marketplace applies edits live on `/reload-plugins`. `claude plugin init <name>` scaffolds `~/.claude/skills/<name>/` with `.claude-plugin/`, and it auto-loads as `<name>@skills-dir`. [BIN, DOC]

### Codex

Version codex-cli 0.169.0. Sources: <https://learn.chatgpt.com/docs/build-skills>, <https://developers.openai.com/codex/plugins/build>, <https://learn.chatgpt.com/docs/plugins> (all accessed 2026-11-19).

- `name` and `description` are required. [DOC, BIN]
- Validator limits (embedded `skill-creator/scripts/quick_validate.py`): allowed keys are only `name`, `description`, `license`, `allowed-tools`, `metadata`. `name` matches `^[a-z0-9-]+$` with no leading, trailing or double hyphen, at most 64 characters. `description` is at most 1024 characters, has no `<` or `>`, and may not start with `[TODO:`. [BIN]
- Whether the runtime loader is as strict as the validator is not verified. The validator is the authoring tool. [UNVERIFIED]
- `metadata.short-description` is used by the system skills. [BIN]
- Optional `agents/openai.yaml`: `interface.{display_name, short_description (25-64 characters), icon_small, icon_large, brand_color, default_prompt (must mention $skill-name)}`, `policy.allow_implicit_invocation` (default true), `dependencies.tools[]`. [DOC, BIN]
- Listing budget: 2% of the context window, or 8,000 characters if the window is unknown. Descriptions are shortened first, then skills are dropped with a warning. `skills.max_context_tokens` raises the budget up to 10k tokens. [DOC]
- Invocation: `$skill-name`, `/skills`, or implicit. [DOC]
- Discovery in the docs: `.agents/skills` in every directory from cwd up to the repo root, `$HOME/.agents/skills`, `/etc/codex/skills`, bundled system skills. Same-named skills are not merged. [DOC]
- Discovery in the binary: root labels `codex-home-skills`, `.agents/skills`, `user-agent-skills`, `system-skills`, `plugins/cache`. `$CODEX_HOME/skills` is still a root, and `skill-creator` writes new skills there. System skills live in `$CODEX_HOME/skills/.system/`. [BIN]
- Disable a skill with `[[skills.config]] path=... | name=..., enabled=false` in `~/.codex/config.toml`. [DOC]
- Plugin manifest in the docs: the portable root `plugin.json` (Agent Plugins schema). `.codex-plugin/plugin.json` is a fallback used when the root manifest has no `extensions["com.openai"]`. Skills come from root `skills/`, MCP servers from root `mcp.json`. OpenAI-only keys sit under `extensions["com.openai"]` (`apps`, `hooks`, `onboardingSkill`, `interface`). [DOC]
- Plugin manifest in the binary: it probes `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json` and the root manifest, and warns "ignoring unknown Agent Plugins manifest field". Recognised raw fields: `name`, `version`, `description`, `keywords`, `author`, `homepage`, `repository`, `license`, `$schema`, `skills`, `mcpServers`, `apps`, `hooks`, `commands`, `interface.*`, `extensions`. It also reads `.mcp.json` and `.app.json`. [BIN]
- Marketplace paths: `$REPO/.agents/plugins/marketplace.json`, `~/.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json` [DOC, BIN]; also `.cursor-plugin/marketplace.json` and `.agents/plugins/api_marketplace.json` [BIN only]. Each plugin entry needs `name`, `source`, `policy.installation`, `policy.authentication` and `category`. [DOC, BIN]
- CLI: `codex plugin marketplace add|list|upgrade|remove`, `codex plugin add PLUGIN@MARKETPLACE`, `codex plugin list [--available --json]`, `codex plugin remove`. TUI: `/plugins`. [BIN, DOC]
- Local test: `codex plugin marketplace add <root>`, `codex plugin add <plugin>@<marketplace-name>`, then start a new `codex` session. There is no `--plugin-dir` flag and no plugin `validate` command. [BIN]

### Grok Build

Version 1.0.70 (f50904eaee6c). The binary bundles its own docs (`08-skills.md`, `09-plugins.md`). Source: <https://docs.x.ai/build/features/skills-plugins-marketplaces> (accessed 2026-11-19), which covers less than the bundled docs. News post: <https://x.ai/news/grok-plugin-marketplace> (2026-06-11).

- `name`: lowercase letters, digits and hyphens, at most 64 characters. Spaces and underscores are normalised to hyphens. It defaults to the directory name. `description` defaults to the first body paragraph. [BIN]
- Optional keys: `when-to-use` (alias `when_to_use`), `allowed-tools` (list or string), `argument-hint`, `user-invocable` (only a literal `true` counts), `disable-model-invocation`, `model`, `effort`, `license`, `compatibility`, `metadata` (`author` and `short-description` show in the UI). `paths` (gitignore globs) is documented online only. Extra keys are ignored. [BIN, DOC]
- Only the first 25,000 tokens of a skill body are inlined. Put long material in sibling files. Inline `` !`cmd` `` is not executed. [BIN]
- Discovery, highest first: `./.grok/skills/` (cwd), `<repo_root>/.grok/skills/`, `~/.grok/skills/`. Every tier also scans `.agents/skills/`, walking from cwd up to the repo root. Compat roots: `~/.claude/skills`, `./.claude/skills`, `.claude/commands`, `~/.cursor/skills`, `./.cursor/skills`. Turn Claude compat off with `[compat.claude] skills=false` or `GROK_CLAUDE_SKILLS_ENABLED=false`. Extra roots: `[skills] paths/ignore/disabled` in `~/.grok/config.toml`. Project skills are skipped in untrusted folders. [BIN]
- Plugin manifest is optional. Without one, Grok auto-discovers `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`. `grok plugin validate` accepted root `plugin.json`, `.claude-plugin/plugin.json` and `.grok-plugin/plugin.json`, and did not recognise `.codex-plugin/plugin.json` ("No plugin.json found"). Fields are Claude-compatible; `grok plugin tag` requires `version`. [BIN]
- Hooks get `GROK_PLUGIN_ROOT` and `GROK_PLUGIN_DATA`, plus the aliases `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`. Plugin skills may not symlink outside the plugin folder. [BIN]
- Marketplace: `.grok-plugin/marketplace.json` (the `.claude-plugin/` equivalent also works), with `name`, `description`, `owner{name,email}`, `plugins[]`. Optional `.grok-plugin/plugin-index.json`. [BIN]
- CLI: `grok plugin marketplace add <owner/repo | git URL | ./local>`, `grok plugin install <name|owner/repo[@ref][#subdir]|git URL|./path> --trust`, `list`, `uninstall`, `update`, `enable`, `disable`, `details`, `validate [PATH]`, `tag`. TUI: `/plugins` (Ctrl+L) and `/marketplace`. [BIN]
- Plugins are off by default. Enable with `[plugins] enabled=[...]` or Space in the TUI. Plugin locations: `.grok/plugins/` (needs trust), `~/.grok/plugins/` (auto-trusted), `[plugins].paths`, and the `.claude/plugins/` equivalents. [BIN]
- Local test: `grok plugin install /abs/path --trust`, enable it, then start a new session or press `r`. Session-only: `grok agent --no-leader --plugin-dir <path> stdio`, which exists only on the `grok agent` subcommand. [BIN]

### Kimi Code

Version kimi-code 2.6.1. Sources: <https://moonshotai.github.io/kimi-code/en/customization/plugins.md>, <https://moonshotai.github.io/kimi-code/en/customization/skills.md>, <https://moonshotai.github.io/kimi-code/llms.txt> (all accessed 2026-11-19). Code read: `features/skill/catalog/parser.ts`, `skillRoots.ts`, `app/plugin/manifest.ts`, `app/plugin/source.ts`.

- Directory form `<name>/SKILL.md`: `name` and `description` are required, and a missing field is a parse error. The flat form `<name>.md` works only at the top level of a skills dir; its `description` falls back to the first body line, up to 240 characters. [BIN]
- Optional keys: `type` (`prompt` default, `inline`, `flow`; other values are rejected), `whenToUse` (aliases `when-to-use`, `when_to_use`), `disableModelInvocation` (aliases with hyphens and underscores), `arguments`. [BIN]
- Kimi enforces no name or description length limits. Placeholders: `$ARGUMENTS`, `$0`, `$name`, `${KIMI_SKILL_DIR}`. Skill invocations nest at most 3 levels, and directory scans stop at depth 8 and skip dot-dirs and `node_modules`. [BIN]
- Invocation: `/skill:<name> [args]` or automatic. [DOC]
- Discovery: user `$KIMI_CODE_HOME/skills` (default `~/.kimi-code/skills`) and `~/.agents/skills` (real OS home); project (from the nearest `.git` root) `.kimi-code/skills` and `.agents/skills`; `extra_skill_dirs` in `config.toml`; built-ins. Precedence: project, user, extra, built-in. [BIN, DOC]
- `kimi --skills-dir <dir>` (repeatable) replaces the auto-discovered user and project dirs. [BIN]
- Kimi does not scan `.claude/skills`. A built-in `import-from-cc-codex` skill copies Claude and Codex skills instead. [BIN]
- Manifest: `kimi.plugin.json` at the root or `.kimi-plugin/plugin.json`. The root file wins and the other is reported as shadowed. `.claude-plugin/` and `.codex-plugin/` are not read. Required `name` matches `^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:@[A-Za-z0-9_-]+)?$`. [BIN, DOC]
- Optional manifest keys: `version`, `description`, `keywords`, `homepage`, `license`, `author`, `skills`, `agents`, `sessionStart.skill`, `skillInstructions`, `systemPrompt`/`systemPromptPath` (32 KB each, 64 KB across plugins), `mcpServers`, `hooks`, `commands`, `interface{...}`. Ignored with an info diagnostic: `tools`, `apps`, `inject`, `configFile`, `config_file`, `bootstrap`. [BIN]
- `skills` is a string or string array. If omitted, only a root `SKILL.md` is used, and `skills/` is not auto-discovered (`agents/` is). [BIN, DOC]
- There is no `kimi plugin` shell subcommand. Use the TUI: `/plugins`, `/plugins install <source>`, `/plugins list|info|enable|disable|remove|reload`, `/plugins marketplace [catalog]`. Sources: local dir, zip URL, GitHub URL. A local path must be absolute. [BIN]
- Installs are copied to `$KIMI_CODE_HOME/plugins/managed/<id>/`. Editing the source needs a reinstall. Scope is user only. Marketplace catalog JSON is `{version:"2", plugins:[{id, source, ...}]}`, and `KIMI_CODE_PLUGIN_MARKETPLACE_URL` overrides the default. [DOC]

### Muse Code

Version 1.4.20-R8619.1 (native Rust binary, Homebrew cask). Sources: <https://dev.meta.ai/docs/muse-code/extending>, <https://dev.meta.ai/docs/muse-code/changelog>, <https://dev.meta.ai/docs/muse-code> (no dates; accessed 2026-11-19). Third-party: <https://www.withone.ai/blog/muse-code-skills-not-mcp/md> (2026-08-06, updated 2026-09-11).

- `description` is required. Without it, `muse skills validate` fails with "SKILL.md frontmatter must include description". [BIN]
- `name` is the skill id. The validator accepted `Other_Name` and a name that differs from the directory, with `valid: true` and no diagnostics. [BIN]
- Profile `agent-skills-common-subset`. Known fields: `name`, `description`, `license`, `metadata`, `compatibility`, `allowed-tools`, `disable-model-invocation`, `experimental-gate`. Unknown keys are listed under `unknown_fields` and are not errors. `allowed-tools` and `disable-model-invocation` are type-checked. [BIN]
- `SKILL.md` over 262144 bytes (256 KiB) is rejected. A 1100-character description passed with no warning. The binary also caps package size and nesting depth (numbers not extracted), and `read_skill` truncates an oversized body. [BIN]
- The built-in `create-skill` skill requires stricter IDs than the validator: ASCII lowercase letters, digits, `-`, `_`, and no Windows reserved names. [BIN]
- User discovery: `~/.agents/skills`, `~/.claude/skills` (read in place; 7 skills showed as `user $HOME/.claude/skills`), `$CODEX_HOME/skills` or `~/.codex/skills`, and the managed root `$XDG_CONFIG_HOME/muse/skills` or `~/.config/muse/skills` (where `muse skills install` writes). [BIN, DOC]
- Project discovery: `.agents/skills`, `.claude/skills`, `.codex/skills`. The first two were verified. Project skills load only in a trusted workspace; `--trust-workspace` trusts it for one run. [DOC, BIN]
- Plugin skills appear as `plugin://<plugin>/skills`. Built-in skills include `create-skill`, `create-plugin`, `plan`, `git`. [BIN]
- Claimed precedence: `~/.agents` before `~/.claude` before `~/.codex`, with a duplicate reported as "skill-shadowed". [UNVERIFIED, third-party blog]
- A flag hides foreign personal skills for one run. [BIN, help]
- `muse plugins validate <dir>` accepts exactly one manifest per plugin root. [BIN]
  - Native `.muse-plugin/plugin.json`: `{"schemaVersion":1,"name","displayName","version","description","compat":{...},"capabilities":{...}}`. Capability families: `skills`, `commands`, `hooks`, `mcpServers`, `reminders`. Rejected: `tools`, `agents`, `outputStyles`, `settings`, `apps`. ID regex `^[a-z0-9][a-z0-9._-]{0,79}$`; reserved IDs `loop` and `muse-core`. Paths are relative with `/`. Packages with symlinks are refused at install.
  - Claude-compatible `.claude-plugin/plugin.json`, skills auto-found under `skills/<id>/SKILL.md` (fixture validated, family `claude-compatible`).
  - Codex-compatible `.codex-plugin/plugin.json` (read from the binary only).
  - Agent Plugins 1.0.0 root `plugin.json` with the exact `$schema`. Family `agent-plugins`, skills default to enabled. Any other `$schema` is a hard error with no fallback.
- Marketplace catalogs: `.agents/plugins/marketplace.json` or `.claude-plugin/marketplace.json`. `muse plugins marketplace add <name> <local-dir|file|git>`, then `muse plugins install <plugin>@<marketplace>`. [BIN]
- `muse plugins install <path> [--scope user|project]` copies into the cache, and the plugin then needs `muse plugins approve <id>`. There is no ephemeral `--plugin-dir`. The closest test is install with `--scope project` plus approve, which was not run. [BIN, UNVERIFIED]
- Other commands: `muse skills install <path> [--scope user] [--name N] [--force]`, `muse skills import --from claude|codex [--dry-run]`. [BIN]
- Test-load a skill: put it at `<ws>/.agents/skills/<id>/`, then run `muse --trust-workspace` or `muse skills list --source project --workspace <ws> --trust-workspace`. Validation is clean only when `valid: true` and `diagnostics: []`. [BIN]
- Vendor guidance (built-in `create-skill`, `create-plugin`): one directory per skill with `name` equal to the directory id, a one-sentence description, validate until zero diagnostics, and never write into `~/.claude/skills`, `~/.codex/skills` or `~/.agents/skills` (import-only). [BIN]
- When more skills are installed than the catalog can list, built-in and prompt-named skills keep their full descriptions first, so long descriptions risk truncation. [DOC, changelog]
- The blog's claim that plugins need `MUSE_EXPERIMENTAL_PLUGINS=1` is outdated. In 1.4.20 `muse plugins` works with no flag. [BIN]

### omp (oh-my-pi)

Version omp 18.20.2, a Bun-compiled binary from the `can1357/tap` Homebrew formula. It is a fork of Pi maintained by Stencil Labs. Upstream is at v18.22.2 (2026-11-18) with no skill-format changes since 18.20.2. Sources: <https://github.com/can1357/oh-my-pi> (README), <https://github.com/can1357/oh-my-pi/blob/main/docs/skills.md> (last commit 2026-11-05), plus the docs pages listed in the Sources table (accessed 2026-11-19).

- Each skill is `<root>/skills/<name>/SKILL.md`. Native and provider roots are scanned one level only. [DOC]
- Frontmatter: `name?`, `description?`, `globs?`, `alwaysApply?`, `hide?`, `disable-model-invocation`, `enabled: false`. Unknown keys are preserved. `name` defaults to the directory; a name containing `/` or `\` is rejected. [DOC]
- `description` is required in native `.omp`, `omp-plugins`, `.github/skills` and `skills.customDirectories`. The claude, codex, agents, opencode and claude-plugins providers accept a skill without it. [DOC]
- Agent Plugins packages use strict Agent Skills validation (required `name` and `description`, name matches directory, closed field set; `hide` and `enabled` not allowed). `omp skill publish --dry-run` is strict too: it rejected `foo:` with "unexpected frontmatter field" and requires `metadata.version`. [DOC, BIN]
- Skills show as name plus description in the system prompt, are read through `skill://<name>[/path]`, and invoked with `/skill:<name>`. `skills.manualSkills` globs or `hide: true` keep a skill out of the catalog. [DOC]
- Provider priority, highest first (collisions are namespaced `<ns>/<name>`, not dropped): native 100, skillshare 95, omp-plugins 90, claude 80, agent-plugins 75, claude-plugins / agents / codex 70, opencode 55, github 30, omp-managed 5. [DOC]
- Native roots: `<ancestor>/.omp/skills` (walk up to the repo root) and `~/.omp/agent/skills`. Agents provider: `.agent/skills` and `.agents/skills`. Codex provider: `~/.codex/skills`, `.codex/skills`. [DOC]
- Foreign user-level roots such as `~/.claude/skills` are opt-in through `enabledProviders`. Their project roots and `~/.agents/skills` load by default. `omp skill list --json` loaded 68 `agents:user` skills and did not load `~/.claude/skills`. In a test git repo it reported `native:project`, `agents:project` and `claude:project`. [DOC, BIN]
- Extension package: `package.json` with `"omp": {"extensions": [...]}`; the legacy `"pi"` key is still accepted. Bundled `skills/` load via the omp-plugins provider. [DOC]
- Marketplace plugin (Claude Code-compatible): catalog `.omp-plugin/marketplace.json`, fallback `.claude-plugin/marketplace.json`; manifest `.omp-plugin/plugin.json`, `.claude-plugin/plugin.json` or root `plugin.json`; identified as `name@marketplace`. [DOC, BIN]
- Portable Agent Plugins 1.0.0: root `plugin.json` with the exact `$schema`, `skills/<name>/SKILL.md`, and `mcp.json`. [DOC, BIN]
- Commands: `omp plugin install <npm-spec|git|name@marketplace> [--scope user|project]`, `omp install ./dir` (links a local path), `omp plugin marketplace add <owner/repo|url|./dir>`, `omp skill install @scope/name`. [BIN]
- Test-load: `omp --plugin-dir <path>` is in the help but had no effect on `omp skill list`, so it is not verified outside a real session. `omp -e <ext-file-or-pkg-dir>` loads an extension and its skills. The simplest check is a skill in `<repo>/.omp/skills/<name>/` or `<repo>/.agents/skills/<name>/` plus `omp skill list --json`. `skills.customDirectories` set through `--config` did not appear in the list. [BIN, UNVERIFIED]
- Vendor guidance: always set `name` and `description`, one directory per skill, keep assets inside the skill directory and refer to them as `skill://<name>/...`, and point `customDirectories` at the parent of grouped skills because discovery is not recursive. [DOC]

### pi

Version pi 1.5.2 (npm `@earendil-works/pi-coding-agent`, repo moved to earendil-works; release 2026-11-10). Sources: installed *docs/skills.md*, *docs/packages.md*, *docs/settings.md*, *docs/configuration.md*, *docs/cli.md*; upstream <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs> (skills.md last changed 2026-09-22; accessed 2026-11-19); <https://agentskills.io/specification>.

- pi implements the Agent Skills spec, but most violations are warnings. Fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation` (skill is invocable only through `/skill:name`). [BIN]
- Running the bundled `loadSkillsFromDir` on fixtures: a missing `description` means the skill is not loaded; an uppercase or underscore name warns but loads; a description over 1024 characters warns but loads; `name` falls back to the directory name, and a mismatch is not warned about. [BIN]
- Discovery is recursive. A directory containing `SKILL.md` is a skill root and is not descended into. Root-level `.md` files are accepted as standalone skills in some locations. On a name collision, the first discovered skill wins with a warning. [BIN]
- User paths: `~/.pi/agent/skills/` and `~/.agents/skills/`. Project paths (after project trust): `.pi/skills/` and `.agents/skills/` in cwd and every ancestor to the repo root. `skills: []` arrays in `~/.pi/agent/settings.json` or `.pi/settings.json` support globs, `!excl`, `+path`, `-path`. The config dir is `.pi`, overridable with `PI_CODING_AGENT_DIR`. [BIN]
- A pi package is an npm or git package or local directory with `extensions/`, `skills/`, `prompts/`, `themes/`. An explicit manifest goes in `package.json` under `pi` (`extensions`, `skills`, `prompts`, `themes`, ...). The `pi-package` keyword lists it at <https://pi.dev/packages>. [BIN]
- Commands: `pi install npm:@x/y@1.0.0 | git:... | https://... | ./local [-l]` (`-l` writes `.pi/settings.json`), `pi list`, `pi remove`, `pi update --extensions`, `pi config`. [BIN]
- Test-load: `pi --skill <file-or-dir>` (repeatable; works with `--no-skills`), `pi -e <path|npm:...|git:...>`, and `/reload` for edits during a session. There is no `validate` command. Read the startup diagnostics or try `/skill:name`. [BIN]
- Vendor guidance: the description must say what the skill does and when to use it ("Helps with PDFs" is the doc's bad example), refer to bundled files with relative paths, and keep the directory name equal to `name`. [BIN]

### Antigravity CLI (agy)

Version agy 1.5.9 (Go binary; config in `~/.gemini/config/` and `~/.gemini/antigravity-cli/`). Sources: <https://antigravity.google/docs/skills> and <https://antigravity.google/docs/plugins> (no dates; accessed 2026-11-19); the binary's embedded "Antigravity Customization System" guide and 1.5.x changelog.

- A skill is `skills/<name>/SKILL.md` with optional *scripts/*, *examples/*, *resources/*, *references/*. [BIN, DOC]
- `name`: required per the embedded guide (lowercase, hyphenated) [BIN]; optional with a folder-name default per the web docs [DOC]. In a plugin, a skill with no `name` draws a warning that the skill is named "SKILL". [BIN]
- `description` is required in both doc sources, but a missing one is only a warning from `agy plugin validate`. [BIN]
- No limits are enforced. `Bad_Name`, an extra key `foo`, a 1100-character description, and `allowed-tools`/`license` all passed with no findings. [BIN]
- CLI discovery: workspace `<ws>/.agents/skills/<name>/` (also `.agent/`, `_agents/`, `_agent/`; walks up to the repo root), global `~/.gemini/config/skills/<name>/`, plugin skills `~/.gemini/config/plugins/<plugin>/skills/`, CLI-only `~/.gemini/antigravity-cli/skills/` and `~/.gemini/skills/`. The IDE also reads legacy `~/.gemini/antigravity/skills/`. [DOC, BIN]
- Precedence, highest first: workspace walk-up, workspace `skills.json`/`plugins.json`, global `~/.gemini/config/`, built-ins, global declared JSON configs. [BIN]
- `skills.json` / `plugins.json` (in `.agents/` or `~/.gemini/config/`): `{"entries":[{"path","include_only?","exclude?"}],"inherits":[...]}`. Each entry is scanned one level deep; a relative path resolves against the repo root. [BIN]
- Only name and description go into context. Each skill becomes a slash command, and `/skills reload` picks up changes. [DOC, BIN]
- Native plugin layout: `plugins/<name>/plugin.json`, *mcp_config.json*, *hooks.json* (must sit at the plugin root), *rules/AGENTS.md*, `skills/<s>/SKILL.md`, *agents/*, *assets/*, *bin/*. [BIN]
- Manifest: `plugin.json` at the root, or in `.antigravity-plugin/` or `.gemini-plugin/`. A lone `.claude-plugin/plugin.json` fails validation ("This looks like a Claude Code plugin: `plugin install` converts it, but it doesn't load as is"). [BIN]
- Manifest fields: `$schema` `https://antigravity.google/schemas/v1/plugin.json`, `name` (optional), `displayName`, `version`, `description`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`. Unknown fields give "did you mean" warnings. [DOC, BIN]
- A root `plugin.json` with the Agent Plugins schema validates, and loads as an Agent Plugins plugin only while the `enable-agent-plugins-spec` flag is on. [BIN]
- Plugins are discovered in `<ws>/.agents/plugins/<name>/` and `~/.gemini/config/plugins/<name>/`. Enable state is stored in `~/.gemini/config/config.json` under `plugins.<dir>.enabled`. [BIN]
- Commands: `agy plugin install <name>[@antigravity-plugins-official]` (needs sign-in), `install <git URL>`, `install <local-dir>` (copies and converts Claude Code or Gemini CLI layouts), `import [gemini|claude|<dir>]`, `enable`, `disable`, `uninstall`, `list --json`, `validate <dir|plugin.json> [--strict] [--json]`. [BIN, DOC]
- Test-load without installing: put the skill or plugin under `<ws>/.agents/`, or point `skills.json`/`plugins.json` `entries[].path` at the directory. This was not run in a session. There is no `--plugin-dir` or `--skill` flag. [BIN, UNVERIFIED]
- Vendor guidance: third-person description saying what and when, one focused skill, progressive disclosure through *references/*, scripts as black boxes (run `--help` first, do not read the source), validation steps and decision trees, no restating of general coding knowledge. No numeric size limit is given. [DOC, BIN]

## Authoring best practice

These points are consistent across vendors. Tags show where each comes from.

### Descriptions

- Say what the skill does and when to use it. Put the main use case and trigger words first. [DOC: Anthropic, agentskills.io, pi, agy; BIN: Codex, Grok]
- Write in the third person (Anthropic, agy) and be specific. Avoid vague wording. Claude chooses among 100+ skills. [DOC]
- agentskills.io suggests imperative phrasing ("Use this skill when..."), describing user intent, and adding near-miss exclusions. It recommends about 20 trigger evals (8-10 should trigger, 8-10 should not), 3 runs each, with a 60/40 train/validation split. [DOC]
- Codex's skill-creator: keep descriptions "concise and discriminating", add exclusions only to prevent likely misrouting, and avoid catch-alls. Grok: name trigger phrases, and use `when-to-use` for extras. [BIN]
- Keep the description at or below 1024 characters everywhere, and below 1,536 characters combined with `when_to_use` for Claude. [DOC, BIN]

### Progressive disclosure

- Three levels: metadata at startup (about 100 tokens per skill), the body when the skill triggers, and resources on demand. [DOC]
- Keep references one level deep from `SKILL.md`. Give a reference file over 100 lines a table of contents. [DOC: Anthropic]
- Route by mode, so the agent loads only the relevant reference. [BIN: Codex]
- Move bulk material into *references/* (agy) or sibling files read with offset and limit (Grok). [DOC, BIN]

### Size budgets

| Agent | Budget | Evidence |
|---|---|---|
| Spec and Anthropic | `SKILL.md` under 500 lines and about 5k tokens; metadata about 100 tokens | [DOC] |
| Claude Code | listing truncated at 1,536 characters per skill; whole listing 1% of context; after compaction 5k tokens per skill, 25k total | [BIN, DOC] |
| Codex | listing 2% of context, or 8,000 characters if the window is unknown; `skills.max_context_tokens` up to 10k tokens | [DOC] |
| Grok | first 25,000 tokens of the body inlined | [BIN] |
| Muse | `SKILL.md` hard limit 256 KiB; long descriptions may be truncated in a full catalog | [BIN, DOC] |
| Kimi | no name or description limits; flat-form description fallback 240 characters | [BIN] |
| pi | warns above 1024-character descriptions | [BIN] |
| omp, agy | no numeric limit found | [DOC] |

### Scripts

- Use scripts for deterministic or repeated work. They are executed, not loaded into context. [DOC: Anthropic]
- Say explicitly whether the agent should run a script or read it. Treat scripts as black boxes: run `--help` first instead of reading the source. [DOC: Anthropic; BIN, DOC: agy]
- Scripts should handle errors themselves, document their constants and list their dependencies. Use plan, validate, then execute, with verbose validator errors. [DOC: Anthropic]
- Run a new script once to verify it (Codex). A plugin delivers files, not runtimes (Grok). Do not assume packages are installed. [BIN]
- Grok does not run `` !`cmd` `` injection, so write an explicit step instead. [BIN]
- Name tools in full, for example `Server:tool` for MCP tools. [DOC: Anthropic; BIN: Grok]

### Path resolution

- Refer to bundled files relative to the skill directory, with forward slashes. [DOC: pi, Anthropic]
- Agent-specific forms are not portable: `${CLAUDE_PLUGIN_ROOT}` (Claude; Grok aliases it), `${KIMI_SKILL_DIR}` (Kimi), `skill://<name>/...` (omp). [DOC, BIN]
- Keep assets inside the skill directory. Do not symlink outside a plugin; Grok refuses it and Muse refuses packages with symlinks. [BIN]

### Testing

- Test across the models you will use, and forward-test with an independent agent. [DOC: Anthropic; BIN: Codex]
- Validate until there are zero diagnostics where a validator exists (Muse). [BIN]

## Conflicts between docs and local behaviour

1. **Codex `~/.codex/skills`.** The docs list only `~/.agents/skills`. The 0.169.0 binary still has a `codex-home-skills` root, and its bundled skill-creator writes to `$CODEX_HOME/skills`. [DOC vs BIN]
2. **Codex manifest location.** The docs prefer root `plugin.json` with `.codex-plugin/` as fallback. The binary also accepts `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json`. [DOC vs BIN]
3. **Codex local install.** The docs say to test local plugins in the ChatGPT desktop app. The CLI has `codex plugin marketplace add ./path` and `codex plugin add name@mkt`. [DOC vs BIN]
4. **Codex frontmatter strictness.** `quick_validate.py` rejects `compatibility` and any non-spec key, unlike agentskills.io and Claude Code. The runtime's tolerance is unverified. [BIN, UNVERIFIED]
5. **Grok `--plugin-dir`.** The online docs list it as a CLI flag. Locally it exists only as `grok agent --plugin-dir ... stdio`, and top-level `grok --help` has no such flag. [DOC vs BIN]
6. **Grok manifests.** The online docs list no manifest locations. Local validate accepts root, `.grok-plugin/` and `.claude-plugin/`, and not `.codex-plugin/`. [DOC vs BIN]
7. **Grok `allowed-tools`.** The online docs say it neither grants nor restricts tools. The bundled docs say only "tools the skill uses". Do not rely on it for permissions. [DOC vs BIN]
8. **Kimi skills auto-scan.** Kimi does not scan a plugin's `skills/` unless the manifest's `skills` field names it. Claude, Codex and Grok scan it by default. Docs and source agree. [DOC, BIN]
9. **Kimi local path.** The docs say "local directory". The binary requires an absolute path and throws "Plugin root must be an absolute path". [DOC vs BIN]
10. **Claude name limits.** The Claude Code docs give no numeric `name` limit. The platform and API spec requires at most 64 characters of `[a-z0-9-]`. Use the strict form. [DOC]
11. **Claude listing length.** Claude truncates at 1,536 characters (description plus `when_to_use`), while the spec maximum is 1024. Stay at 1024 or below. [BIN, DOC]
12. **Exact Agent Plugins `$schema`.** Muse rejects any URL other than `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, with no fallback. omp and agy key on the same URL. agy's own manifest uses a different `$schema`, `https://antigravity.google/schemas/v1/plugin.json`. [BIN]
13. **`.claude-plugin/plugin.json` alone.** Muse and omp load it, but `agy plugin validate` rejects it. agy only converts it at `agy plugin install`. [BIN]
14. **Name rules.** Only the spec, omp's Agent Plugins and Skillshare paths, and Codex's validator enforce lowercase names that match the directory. pi warns but loads. Muse and agy accept anything. Muse's built-in `create-skill` is stricter than Muse's own validator. [BIN, DOC]
15. **Description over 1024 characters.** pi warns, Muse and agy are silent, the spec forbids it. [BIN, DOC]
16. **Missing `description`.** pi and Muse refuse to load the skill, and omp native refuses it. agy only warns, and omp's claude and agents providers accept it. [BIN, DOC]
17. **Recursion.** pi scans skill directories recursively. omp and agy (`entries`) scan one level. Use a flat `skills/<name>/SKILL.md`. [BIN, DOC]
18. **`~/.claude/skills`.** Muse reads it by default (verified). omp needs an opt-in. pi and the agy CLI do not read it. Kimi does not scan it. [BIN, DOC]
19. **agy `name`.** The web docs say it is optional and defaults to the folder name, the embedded guide says it is required, and the validator says a plugin skill without `name` is named "SKILL". Always set `name`. [DOC vs BIN]
20. **Muse experimental flag.** A third-party blog (2026-08-06, updated 2026-09-11) says plugins need `MUSE_EXPERIMENTAL_PLUGINS=1`. In 1.4.20 they work without it. [UNVERIFIED vs BIN]
21. **Version drift.** The omp docs track main (v18.22.2), ahead of the local 18.20.2, with no skill-format changes in between. The Muse online changelog stops at 1.4.18, while 1.4.20 is local. [DOC, BIN]
22. **omp test flags.** `omp --plugin-dir` had no effect on `omp skill list`, and `skills.customDirectories` set via `--config` did not show in the list. Neither is verified in a real session. [UNVERIFIED]

## Sources

Dates: "accessed 2026-11-19" means no publish or update date was visible on the page.

| URL | Title | Date | Agent |
|---|---|---|---|
| <https://code.claude.com/docs/en/skills> | Extend Claude with skills | accessed 2026-11-19 | Claude Code |
| <https://code.claude.com/docs/en/plugins-reference> | Plugin manifest reference | accessed 2026-11-19 | Claude Code |
| <https://code.claude.com/docs/en/plugin-marketplaces> | Create a marketplace | accessed 2026-11-19 | Claude Code |
| <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices> | Skill authoring best practices | accessed 2026-11-19 | Claude Code, all (baseline) |
| <https://agentskills.io/specification> | Agent Skills specification | accessed 2026-11-19 | all (baseline) |
| <https://agentskills.io/skill-creation/optimizing-descriptions> | Optimizing skill descriptions | accessed 2026-11-19 | all (baseline) |
| <https://learn.chatgpt.com/docs/build-skills> | Build skills (redirected from developers.openai.com/codex/skills) | accessed 2026-11-19 | Codex |
| <https://developers.openai.com/codex/plugins/build> | Build plugins | accessed 2026-11-19 | Codex |
| <https://learn.chatgpt.com/docs/plugins> | Plugins (redirected from developers.openai.com/codex/plugins) | accessed 2026-11-19 | Codex |
| <https://docs.x.ai/build/features/skills-plugins-marketplaces> | Skills, Plugins & Marketplaces | accessed 2026-11-19 | Grok Build |
| <https://x.ai/news/grok-plugin-marketplace> | Grok plugin marketplace | 2026-06-11 | Grok Build |
| <https://moonshotai.github.io/kimi-code/en/customization/plugins.md> | Plugins | accessed 2026-11-19 | Kimi Code |
| <https://moonshotai.github.io/kimi-code/en/customization/skills.md> | Agent Skills | accessed 2026-11-19 | Kimi Code |
| <https://moonshotai.github.io/kimi-code/llms.txt> | Kimi Code docs index | accessed 2026-11-19 | Kimi Code |
| <https://dev.meta.ai/docs/muse-code/extending> | Extending and automating | accessed 2026-11-19 | Muse Code |
| <https://dev.meta.ai/docs/muse-code/changelog> | Muse Code changelog (latest entry 1.4.18) | accessed 2026-11-19 | Muse Code |
| <https://dev.meta.ai/docs/muse-code> | Muse Code overview | accessed 2026-11-19 | Muse Code |
| <https://www.withone.ai/blog/muse-code-skills-not-mcp/md> | Third-party blog on Muse Code skills (not official; plugin flag claim outdated) | 2026-08-06, updated 2026-09-11 | Muse Code |
| <https://github.com/can1357/oh-my-pi> | oh-my-pi README | accessed 2026-11-19 | omp |
| <https://github.com/can1357/oh-my-pi/blob/main/docs/skills.md> | docs/skills.md | last commit 2026-11-05 | omp |
| <https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md> | docs/marketplace.md | accessed 2026-11-19 | omp |
| <https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md> | docs/extension-loading.md | accessed 2026-11-19 | omp |
| <https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md> | docs/config-usage.md | accessed 2026-11-19 | omp |
| <https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md> | docs/plugin-manager-installer-plumbing.md | accessed 2026-11-19 | omp |
| <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs> | pi coding-agent docs (skills.md last changed 2026-09-22) | accessed 2026-11-19 | pi |
| <https://pi.dev/packages> | pi package gallery (mentioned in the docs, not fetched) | accessed 2026-11-19 | pi |
| <https://antigravity.google/docs/skills> | Antigravity skills | accessed 2026-11-19 | Antigravity agy |
| <https://antigravity.google/docs/plugins> | Antigravity plugins | accessed 2026-11-19 | Antigravity agy |

### Local evidence

- Claude Code: `claude plugin --help`, `validate --help`, `init --help`, `claude --help`, and strings from the installed 2.1.325 binary.
- Codex: `codex plugin [marketplace] * --help`, and strings from the installed 0.169.0 binary, including the embedded `skill-creator` SKILL.md, `quick_validate.py` and *references/openai_yaml.md*.
- Grok Build: `grok plugin * --help`, `grok agent --help`, `grok plugin validate` against fixtures, and bundled docs `08-skills.md` and `09-plugins.md` extracted from the 1.0.70 binary.
- Kimi Code: `kimi --help`, and source inside the installed 2.6.1 package (`app/plugin/manifest.ts`, `app/plugin/source.ts`, `features/skill/catalog/parser.ts`, `skillRoots.ts`, the `/plugins` handler).
- Muse Code: `muse --help`, `muse skills --help`, `muse plugins --help`, `muse skills validate` and `muse plugins validate` on fixtures, `muse skills list`, and the embedded `create-skill`, `create-plugin` and `native-plugin-contract.md`.
- omp: `omp --help`, `omp plugin --help`, `omp skill --help`, `omp install --help`, binary strings, `omp skill list --json` and `omp skill publish --dry-run` on fixtures.
- pi: installed docs in the `pi-coding-agent` 1.5.2 package, `pi --help`, and the bundled `dist/core/skills.js` `loadSkillsFromDir` called from Node on fixtures.
- Antigravity: `agy --help`, `agy plugin --help`, `agy plugin validate --help`, `agy plugin list --json`, `agy plugin validate` on fixtures, and the binary's embedded docs.
