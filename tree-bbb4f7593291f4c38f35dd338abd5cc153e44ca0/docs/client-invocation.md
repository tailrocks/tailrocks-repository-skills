# Native client routes

The release contains six public skills and their skill-local references.
Install this repository as one package. Do not install or checkout a
separate source collection.

Three rules apply to every client below:

- Discovery is separate from selection, and selection is separate from
  operation permission. Loading or selecting a skill never authorizes
  filesystem, network, merge, or deletion side effects.
- Prefer the client's native marketplace or plugin path over hand-copying
  skill directories. The native path validates manifests and tracks
  versions for update and removal.
- Revalidate commands against the installed build before relying on them.
  A manifest file alone does not prove command support.

## Install from GitHub

1. **Vet first.** Read the manifests (`.claude-plugin/`,
   `.codex-plugin/`, root `plugin.json`, `.muse-plugin/`,
   `.kimi-plugin/`), the six `skills/*/SKILL.md` files, and any hooks or
   MCP configuration. This package ships skills and references only; it
   adds no hooks and no MCP servers.
2. **Pin the source.** Prefer a tag or commit SHA over a floating branch
   when the client accepts a ref.
3. **Add the marketplace, then install:**

```sh
# Claude Code
claude plugin marketplace add tailrocks/tailrocks-repository-skills
claude plugin install tailrocks-repository-skills@tailrocks-repository-skills --scope user

# Codex CLI
codex plugin marketplace add tailrocks/tailrocks-repository-skills
codex plugin add tailrocks-repository-skills@tailrocks-repository-skills

# Antigravity CLI (validates, then installs globally)
agy plugin install https://github.com/tailrocks/tailrocks-repository-skills

# Grok Build (explicit trust required)
grok plugin install tailrocks/tailrocks-repository-skills --trust
```

```text
# Kimi Code CLI: run in the TUI session, not the shell
/plugins install https://github.com/tailrocks/tailrocks-repository-skills
```

Pin a Kimi install with a ref URL:

```text
/plugins install https://github.com/tailrocks/tailrocks-repository-skills/tree/<tag-or-sha>
/plugins install https://github.com/tailrocks/tailrocks-repository-skills/releases/tag/<tag>
/plugins install https://github.com/tailrocks/tailrocks-repository-skills/commit/<sha>
```

Muse, Cursor, Amp, and OpenCode have no remote-URL route for this
package: install from a local checkout or extracted release archive using
their sections below. Gemini CLI extensions need a
`gemini-extension.json`, which this package does not ship; use the
Antigravity CLI route instead.

4. **Least scope.** User scope enables the plugin everywhere; project or
   local scope limits it to one repository. Trial in one repository first.
5. **Verify after install.** List what the client loaded, open one skill,
   and confirm the qualified selector resolves before real work:

```sh
claude plugin list
codex plugin list
agy plugin list
grok plugin list
muse skills list
```

6. **Maintain.** Update the marketplace and the plugin on a cadence;
   remove what you stop using:

```sh
claude plugin marketplace update tailrocks-repository-skills
claude plugin update tailrocks-repository-skills@tailrocks-repository-skills
claude plugin uninstall tailrocks-repository-skills@tailrocks-repository-skills
codex plugin marketplace upgrade
codex plugin remove tailrocks-repository-skills@tailrocks-repository-skills
```

## Runtime requirements

All repository workflows require Git and `gh`. Hosted
pull-request creation, refresh, review, and landing require an authenticated
`gh` session with access to the target repository and support GitHub.com only;
GitHub Enterprise is unsupported.
Read-only audit routes may not need it.

The public skill names are:

```text
tailrocks-repository-merge
tailrocks-create-pr
tailrocks-refresh-pr
tailrocks-review-pr
tailrocks-merge-pr
tailrocks-pr-template
```

## Codex CLI

Install via the marketplace route above, or point the marketplace source
at a local checkout or extracted package. The standalone fallback is
`.agents/skills/<name>/SKILL.md` in the project or
`~/.agents/skills/<name>/SKILL.md` for the user.

Invoke with the bare `$<skill-name>` mention or the `/skills` picker:

```text
$tailrocks-repository-merge --target-branch=release/next feature/auth
$tailrocks-create-pr feature/auth
$tailrocks-review-pr #1663
$tailrocks-merge-pr #1663
```

Codex documents no `$plugin:skill` colon form; same-named skills from
different sources both appear in the selectors for the user to pick.

Every `agents/openai.yaml` in this package sets
`policy.allow_implicit_invocation: true`, which permits model selection.
Test an explicit selector and implicit model selection as separate cases.

## Claude Code

Install via the marketplace route above in the desired scope
(`--scope user`, `project`, or `local`). For a local marketplace, pass
its path instead of `tailrocks/tailrocks-repository-skills`. The
standalone fallback is `.claude/skills/<name>/SKILL.md` in the project or
`~/.claude/skills/<name>/SKILL.md` for the user.

Invoke with the plugin namespace:

```text
/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:tailrocks-create-pr feature/auth
/tailrocks-repository-skills:tailrocks-review-pr #1663
/tailrocks-repository-skills:tailrocks-merge-pr #1663
```

An explicit slash-skill mention later in a message grants message-scoped
selection permission. It is not a plain-text mention. Before relying on a
short name, verify the installed plugin source.

## Kimi Code CLI

Install via the TUI plugin manager route above, using the bundled
`.kimi-plugin/plugin.json` manifest (`/plugins` opens the manager).
The CLI copies the install to
`$KIMI_CODE_HOME/plugins/managed/tailrocks-repository-skills/` and always
runs from that copy; reinstall after upstream changes. Run `/reload` or
start a new session after install, enable, disable, or remove. Plugins
are per-user only; project scope is unsupported. Removal deletes the
installation record but leaves the managed copy on disk.

The fallback is discovered skill directories: `.kimi-code/skills` and
`.agents/skills` in the project, `$KIMI_CODE_HOME/skills` (normally
`~/.kimi-code/skills`) and `~/.agents/skills` for the user, plus
`extra_skill_dirs` in `config.toml`. The legacy `--skills-dir` flag
replaces the auto-discovered directories for one launch; verify it
before use on a current installation.

Invoke with the direct selector:

```text
/skill:tailrocks-repository-merge --target-branch=release/next feature/auth
/skill:tailrocks-review-pr #1663
/skill:tailrocks-merge-pr #1663
```

Skill nesting is limited to three levels; the coordinator selects each
lifecycle owner explicitly without nesting. `kimi -p` sends a plain
prompt and is not deterministic skill selection.

## Antigravity CLI (`agy`)

Install via the remote URL route above, or pass a local checkout path.
The skill-dir fallback is `<workspace>/.agents/skills/<name>/SKILL.md`
and `~/.gemini/antigravity-cli/skills/<name>/SKILL.md`. The portable
baseline is `name`, `description`, and the skill body.

Invoke with `/<skill-name>`:

```text
/tailrocks-repository-merge --target-branch=release/next feature/auth
```

Use `/skills` to inspect collisions. Do not assume a `plugin:skill`
qualifier and do not rely on undocumented frontmatter as a security
boundary.

## Grok Build

Install via the plugin route above. Grok requires explicit plugin trust
before loading plugin skills. If policy leaves the plugin disabled,
enable it:

```sh
grok plugin enable tailrocks-repository-skills
```

The fallback is `.grok/skills` in the project or `~/.grok/skills` for
the user. Invoke from the slash menu; the qualified form is stable when
a name collides:

```text
/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:tailrocks-review-pr #1663
/tailrocks-repository-skills:tailrocks-merge-pr #1663
```

This package keeps `user-invocable: true` and
`disable-model-invocation: false`. Do not treat `allowed-tools` metadata
as an enforced tool-permission boundary; use the actual runtime
permissions.

## Muse Code

Install from a local checkout or extracted package using the bundled
`.muse-plugin/plugin.json`:

```sh
muse plugins validate /path/to/tailrocks-repository-skills --json
muse plugins install /path/to/tailrocks-repository-skills --scope user --json
```

The fallback is `.agents/skills/<name>/SKILL.md` in the project,
`$XDG_CONFIG_HOME/muse/skills`, or `~/.agents/skills` for the user.
Check discovery natively:

```sh
muse skills list
muse skills inspect tailrocks-repository-merge
muse skills validate ./skills/tailrocks-repository-merge
```

In the TUI, type `/` to open the skill picker and invoke the installed
skill with its shown slash shortcut:

```text
/tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-review-pr #1663
```

A qualified `/<plugin>:<skill>` form has been observed in third-party
pickers but is not in the official docs; verify before relying on it, as
well as any project/user shadowing of a bare plugin skill name. A plain
`muse exec` prompt is not deterministic skill selection. Skill
definitions stay model-neutral; a model choice belongs to the execution
request, not to the distributed skills.

## Cursor CLI

Copy each complete skill directory, including its references, into
`.cursor/skills` or `.agents/skills` in the project, or
`~/.cursor/skills` or `~/.agents/skills` for the user. Invoke with
`/<skill-name>` from the CLI `/` menu:

```text
/tailrocks-repository-merge --target-branch=release/next feature/auth
```

Skill selection from the `/` menu is a CLI feature, not editor-only.
Verify the actual executable and version with local help; do not assume
every Cursor editor feature exists in the installed CLI build.

## Amp Code

Unpack or copy the extracted release package into the project's plugin
directory:

```sh
mkdir -p .amp/plugins/tailrocks-repository-skills
cp -R /path/to/extracted/tailrocks-repository-skills-release/. .amp/plugins/tailrocks-repository-skills/
amp plugins list
```

The adapter registers the six skills under the qualified names
`tailrocks-repository-skills:<skill-name>`. Ask the running thread to
select the exact qualified skill by name:

```text
Use the tailrocks-repository-skills:tailrocks-repository-merge skill with --target-branch=release/next feature/auth.
Use the tailrocks-repository-skills:tailrocks-review-pr skill on #1663. Report only; do not post or merge.
```

Amp's per-skill importer does not retain arbitrary repository-root files;
do not use that route because skills need their bundled skill-local
references. Amp may mask a same-named skill from a higher-precedence
directory; inspect the source before relying on automatic invocation. If
the loader does not provide an absolute skill-file path, canonicalize it
from `.amp/plugins/tailrocks-repository-skills/skills/<skill-id>/SKILL.md`.

## OpenCode v1

Copy all six skill directories with their bundled references into the
project `.opencode/skills/` directory:

```sh
mkdir -p .opencode/skills
cp -R /path/to/extracted/tailrocks-repository-skills-release/skills/. .opencode/skills/
```

Request the skill by name in the prompt; do not use an undocumented slash
command:

```sh
opencode run "Use the tailrocks-repository-merge skill with --target-branch=release/next feature/auth."
```

OpenCode v1 has no `skills.paths` setting; do not use the v2
`permissions`/`action` schema with a v1 client. V1 ignores
`disable-model-invocation` and `user-invocable` frontmatter; use
`permission.skill` and the skill body as the safety boundary. Configure
skill approval separately:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "skill": {
      "tailrocks-repository-merge": "ask",
      "tailrocks-create-pr": "ask",
      "tailrocks-refresh-pr": "ask",
      "tailrocks-review-pr": "ask",
      "tailrocks-merge-pr": "ask",
      "tailrocks-pr-template": "ask"
    }
  }
}
```

## Shared lifecycle boundary

The pull-request lifecycle owners are bundled in this package. Their roles are
distinct: `tailrocks-repository-merge` audits, groups, integrates, reviews,
and merges selected repository work into one exact target;
`tailrocks-review-pr` reports only, `tailrocks-create-pr` creates a
candidate, `tailrocks-refresh-pr` reconciles its metadata,
`tailrocks-pr-template` manages the repository template, and
`tailrocks-merge-pr` owns the guarded landing policy. Select the owner
explicitly for the requested repository, source, and target scope.

The merge owner verifies the exact target, checks, reviews, and policy
before one merge or enqueue request. It reports blocked, pending, queued,
merged, failed, or uncertain. Read-only inspection uses native `gh` only:

```sh
gh pr view 1663 --repo OWNER/REPO --json number,title,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision
gh pr checks 1663 --repo OWNER/REPO
```

An inspection result does not authorize mutation. To land a pull request,
select the merge owner. Do not invoke `gh pr merge`, a direct hosting API
merge, a direct ref update or push, a source-PR retarget, a second merge
owner, or another skill to bypass this owner. `--local-only` can inspect an
existing local target but cannot claim remote delivery.

## Compatibility record

Record one row per client and route. The default outcome is unverified.
Record the reason for every unverified result. Do not call a route
unsupported merely because its binary is absent. Do not call a route
verified because a different client accepted the same files. Do not install
or authenticate missing clients without permission.

| Client | Version | Installation route | Loaded skill path | Direct selector | Named prose | Resources | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | not run | standalone `.agents/skills` | not run | not run | not run | not run | unverified: not run in this environment |
| Codex CLI | not run | plugin marketplace | not run | not run | not run | not run | unverified: not run in this environment |
| Claude Code | not run | standalone `.claude/skills` | not run | not run | not run | not run | unverified: not run in this environment |
| Claude Code | not run | plugin marketplace | not run | not run | not run | not run | unverified: not run in this environment |
| Muse Code | not run | standalone `.agents/skills` | not run | not run | not run | not run | unverified: not run in this environment |
| Muse Code | not run | `.muse-plugin` route | not run | not run | not run | not run | unverified: not run in this environment |
| Antigravity CLI | not run | CLI skill paths | not run | not run | not run | not run | unverified: not run in this environment |
| Antigravity CLI | not run | root `plugin.json` route | not run | not run | not run | not run | unverified: not run in this environment |
| Cursor CLI | not run | project and user skill dirs | not run | not run | not run | not run | unverified: not run in this environment |
| Grok Build | not run | native `.grok/skills` | not run | not run | not run | not run | unverified: not run in this environment |
| Grok Build | not run | plugin source | not run | not run | not run | not run | unverified: not run in this environment |
| Kimi Code CLI | not run | plugin manager remote URL | not run | not run | not run | not run | unverified: not run in this environment |
| Kimi Code CLI | not run | current discovered dirs | not run | not run | not run | not run | unverified: not run in this environment |
| Kimi Code CLI | not run | legacy `--skills-dir` | not run | not run | not run | not run | unverified: legacy route, verify before use |
| OpenCode v1 | not run | `.opencode/skills` copy | not run | not run | not run | not run | unverified: not run in this environment |
| Amp Code | not run | directory-plugin adapter | not run | not run | not run | not run | unverified: not run in this environment |
