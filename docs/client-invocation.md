# Native client routes

The release contains six public skills and their skill-local references.
Install this repository as one package. Do not install or checkout a
separate source collection. Discovery is separate from selection. Selection
is separate from operation permission. Discovery does not authorize a merge
or other side effect.

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

The compatibility baseline is the standalone route. Codex discovers project
skills at `.agents/skills/<name>/SKILL.md` and user skills at
`~/.agents/skills/<name>/SKILL.md`. Select a standalone skill with
`$<skill-name>` or through the `/skills` picker:

```text
$tailrocks-repository-merge --target-branch=release/next feature/auth
```

Every `agents/openai.yaml` in this package sets
`policy.allow_implicit_invocation: true`. This setting permits model
selection. It does not approve a tool action. Test an explicit selector and
implicit model selection as separate cases.

The repository also ships `.codex-plugin/plugin.json` with a marketplace
route:

```sh
codex plugin marketplace add tailrocks/tailrocks-repository-skills
codex plugin add tailrocks-repository-skills@tailrocks-repository-skills
```

For a local checkout or extracted package, replace the marketplace source with
`/path/to/tailrocks-repository-skills`. Invoke a qualified plugin skill:

```text
$tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
$tailrocks-repository-skills:tailrocks-create-pr feature/auth
$tailrocks-repository-skills:tailrocks-review-pr #1663
$tailrocks-repository-skills:tailrocks-merge-pr #1663
```

The qualified form avoids collisions. Explicit selection does not grant
filesystem, network, merge, or deletion authority. Before use, revalidate
the marketplace commands and the qualified `$plugin:skill` form against the
installed build. A manifest file alone does not prove command support.

## Claude Code

The compatibility baseline is the standalone route. Claude Code discovers
project skills at `.claude/skills/<name>/SKILL.md` and user skills at
`~/.claude/skills/<name>/SKILL.md`. Select a standalone skill with
`/<skill-name>`:

```text
/tailrocks-repository-merge --target-branch=release/next feature/auth
```

Add the local marketplace and install the complete plugin in the desired
scope. Before use, revalidate these commands against the installed build:

For the published repository:

```sh
claude plugin marketplace add tailrocks/tailrocks-repository-skills
claude plugin install tailrocks-repository-skills@tailrocks-repository-skills --scope user
```

For a local marketplace, use its path:

```sh
claude plugin marketplace add /path/to/tailrocks-repository-skills
claude plugin install tailrocks-repository-skills@tailrocks-repository-skills --scope user
```

Use the plugin namespace:

```text
/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:tailrocks-create-pr feature/auth
/tailrocks-repository-skills:tailrocks-review-pr #1663
/tailrocks-repository-skills:tailrocks-merge-pr #1663
```

Prefer the namespaced `/tailrocks-repository-skills:<skill-name>` form for
an installed plugin. Before relying on a short name, verify the installed
plugin source. An explicit slash-skill mention later in a message grants
message-scoped selection permission. It is not a plain-text mention.
Claude's plugin discovery and model invocation are separate from
authorization for Git, hosting, merge, and cleanup side effects.

## Amp Code

The release includes an Amp directory-plugin adapter so the complete package,
including the skill directories, is loaded as one unit.
Unpack or copy the extracted release product package into the project's plugin
directory:

```sh
mkdir -p .amp/plugins/tailrocks-repository-skills
cp -R /path/to/extracted/tailrocks-repository-skills-release/. .amp/plugins/tailrocks-repository-skills/
amp plugins list
```

The adapter registers the six skills under the qualified names
`tailrocks-repository-skills:<skill-name>`. Ask the running thread to select
the exact qualified skill by name:

```text
Use the tailrocks-repository-skills:tailrocks-repository-merge skill with --target-branch=release/next feature/auth.
Use the tailrocks-repository-skills:tailrocks-review-pr skill on #1663. Report only; do not post or merge.
```

Use `amp plugins list` to inspect discovery. Amp's per-skill importer
does not retain arbitrary repository-root files; do not use that route for this
package because skills need their bundled skill-local references. Amp may mask a
same-named skill from a higher-precedence local or personal directory; inspect
the source before relying on automatic invocation.

If the loader does not provide an absolute skill-file path, canonicalize it
from the installed package path:
`.amp/plugins/tailrocks-repository-skills/skills/<skill-id>/SKILL.md`.

## Grok Build

The compatibility baseline is the native skill route. Grok Build discovers
project skills at `.grok/skills` and user skills at `~/.grok/skills`.
Select a skill with its registered `/<skill-name>` selector:

```text
/tailrocks-repository-merge --target-branch=release/next feature/auth
```

This package keeps `user-invocable: true` and
`disable-model-invocation: false`. Do not treat `allowed-tools` metadata as
an enforced tool-permission boundary. Use the actual runtime permissions.

Grok Build also accepts the repository as a plugin source, including
Claude-compatible plugin discovery. Before use, revalidate the plugin
commands and trust flow against the installed build:

```sh
grok plugin install tailrocks/tailrocks-repository-skills --trust
grok plugin list
grok inspect
```

If policy leaves the plugin disabled, enable it:

```sh
grok plugin enable tailrocks-repository-skills
```

Invoke from the slash menu. The qualified form is stable when a name collides:

```text
/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:tailrocks-review-pr #1663
/tailrocks-repository-skills:tailrocks-merge-pr #1663
```

Grok requires explicit plugin trust before loading plugin skills. Trust is
separate from authorization for Git, hosting, merge, or cleanup operations.

## Muse Code

Muse discovers project skills at `.agents/skills/<name>/SKILL.md` and user
skills at `$XDG_CONFIG_HOME/muse/skills` and `~/.agents/skills`. Check
discovery with the native commands:

```sh
muse skills list
muse skills inspect tailrocks-repository-merge
muse skills validate ./skills/tailrocks-repository-merge
```

After the installed skill passes its self-containment check, install one
skill with:

```sh
muse skills install ./skills/tailrocks-repository-merge --scope user
```

The repository also ships `.muse-plugin/plugin.json`:

```sh
muse plugins validate /path/to/tailrocks-repository-skills --json
muse plugins install /path/to/tailrocks-repository-skills --scope user --json
```

Before use, validate this plugin route with the installed client help and
the native validator. Do not assume it works on every build. In the Muse
TUI, type `/` to open the skill picker, then invoke the installed skill.
Use the slash shortcut shown for the installed skill. Use the qualified
form when a bare name collides:

```text
/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:tailrocks-review-pr #1663
```

Project and user skills can shadow a bare plugin skill. A plain `muse exec`
prompt is not deterministic skill selection. Skill definitions stay
model-neutral. A model choice belongs to the execution request, not to the
distributed skills.

## Antigravity CLI (`agy`)

Use the CLI skill paths, not an IDE-specific global path. Antigravity
discovers workspace skills at `<workspace>/.agents/skills/<name>/SKILL.md`
and user skills at `~/.gemini/antigravity-cli/skills/<name>/SKILL.md`. The
CLI converts a discovered skill to `/<skill-name>`:

```text
/tailrocks-repository-merge --target-branch=release/next feature/auth
```

The portable baseline is `name`, `description`, and the skill body. Do not
rely on undocumented frontmatter as a security boundary.

The repository root `plugin.json` stays limited to the native schema. Before
use, revalidate the plugin schema against the installed build:

```sh
agy plugin list
agy plugin install /path/to/tailrocks-repository-skills
```

This is the native CLI plugin route, not an IDE-only convention. The
current CLI docs expose bare skill IDs. Use `/skills` to inspect collisions.
Do not assume a `plugin:skill` qualifier.

## Cursor CLI

Cursor CLI discovers project skills at `.cursor/skills` and `.agents/skills`.
It discovers user skills at `~/.cursor/skills` and `~/.agents/skills`. Copy
each complete skill directory, including its references. Select a skill with
`/<skill-name>` from the CLI `/` menu:

```text
/tailrocks-repository-merge --target-branch=release/next feature/auth
```

Skill selection from the `/` menu is a CLI feature. It is not editor-only.
This package omits `disable-model-invocation` or sets it to false, so the
model can select a skill from a longer goal. Before use, verify the actual
executable and version with local help. Do not assume that every Cursor
editor feature exists in the installed CLI build.

## Kimi Code CLI

The current route uses discovered skill directories. Kimi discovers project
skills at `.kimi-code/skills` and `.agents/skills`. It discovers user skills
at `$KIMI_CODE_HOME/skills` (normally `~/.kimi-code/skills`) and
`~/.agents/skills`. Additional directories use `extra_skill_dirs` in
`config.toml`. Keep the package root intact because skill-local resources
are required. Invoke with the direct selector:

```text
/skill:tailrocks-repository-merge --target-branch=release/next feature/auth
/skill:tailrocks-review-pr #1663
/skill:tailrocks-merge-pr #1663
```

The current parser accepts `disableModelInvocation` and the hyphenated
alias. This package keeps the value false for model selection. Skill
nesting is limited to three levels. The coordinator therefore selects each
lifecycle owner explicitly without nesting. `kimi -p` sends a
plain prompt. It is not a replacement for explicit `/skill:<name>`
selection when deterministic routing is required.

Legacy route: `--skills-dir` replaces Kimi's automatically discovered user
and project skill directories for that launch. Before use on a current
installation, verify this legacy route:

```sh
kimi --skills-dir /path/to/tailrocks-repository-skills/skills
```

Repeat the flag for any additional directories you need. Do not apply
legacy configuration to a current installation without verification.

## OpenCode v1

OpenCode v1 discovers Markdown skills from the project `.opencode/skills/`
directory and uses `permission.skill`. It has no `skills.paths` setting;
do not use the v2 `permissions`/`action` schema with a v1 client. Install
the complete skill directories and their bundled references
from an extracted release package; do not install a separate source
collection. V1 ignores `disable-model-invocation` and `user-invocable` skill
frontmatter; use `permission.skill` and the skill body as the safety boundary.
Configure skill approval separately:

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

For an extracted release package, copy all six skills as one install:

```sh
mkdir -p .opencode/skills
cp -R /path/to/extracted/tailrocks-repository-skills-release/skills/. .opencode/skills/
```

Request the skill by name in the prompt; do not use an undocumented slash
command:

```sh
opencode run "Use the tailrocks-repository-merge skill with --target-branch=release/next feature/auth."
```

OpenCode's `ask` permission approves loading the named skill. It is separate
from authorization for Git, hosting, merge, or cleanup side effects.

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
merged, failed, or uncertain. The bundled preflight is a read-only
inspection:

```sh
bun /path/to/tailrocks-repository-skills/scripts/merge-preflight.ts \
  --root /path/to/target-repository --repo OWNER/REPO --pr 1663 --no-poll
```

A `ready` receipt does not authorize mutation. To land a pull request,
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
| Kimi Code CLI | not run | current discovered dirs | not run | not run | not run | not run | unverified: not run in this environment |
| Kimi Code CLI | not run | legacy `--skills-dir` | not run | not run | not run | not run | unverified: legacy route, verify before use |
| OpenCode v1 | not run | `.opencode/skills` copy | not run | not run | not run | not run | unverified: not run in this environment |
| Amp Code | not run | directory-plugin adapter | not run | not run | not run | not run | unverified: not run in this environment |
