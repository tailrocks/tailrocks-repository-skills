# Native client routes

The release contains nine public skills and their skill-local references and
templates. Install this repository as one package; do not install or checkout
a separate source collection. A loader or manifest check proves packaging and
discovery only. It does not authorize a merge, cleanup, or other side effect.

The public skill names are:

```text
tailrocks-repository-merge
tailrocks-repository-audit
tailrocks-repository-cleanup
tailrocks-create-pr
tailrocks-refresh-pr
tailrocks-review-pr
tailrocks-merge-pr
tailrocks-document
tailrocks-pr-template
```

## Codex CLI

Codex uses `.codex-plugin/plugin.json` and its plugin marketplace route:

```sh
codex plugin marketplace add /path/to/tailrocks-repository-skills
codex plugin add tailrocks-repository-skills@tailrocks-repository-skills
```

For a published checkout, replace the path with the repository source accepted
by the installed Codex CLI. Invoke a qualified plugin skill:

```text
$tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
$tailrocks-repository-skills:tailrocks-repository-audit --target-branch=main feature/auth
$tailrocks-repository-skills:tailrocks-create-pr feature/auth
$tailrocks-repository-skills:tailrocks-review-pr #1663
$tailrocks-repository-skills:tailrocks-merge-pr #1663
```

The qualified form avoids collisions. Explicit selection does not grant
filesystem, network, merge, or deletion authority.

## Claude Code

Add the local marketplace and install the complete plugin in the desired
scope:

```sh
claude plugin marketplace add /path/to/tailrocks-repository-skills --scope user
claude plugin install tailrocks-repository-skills@tailrocks-repository-skills --scope user --yes
```

Use the plugin namespace:

```text
/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:tailrocks-repository-audit --target-branch=main feature/auth
/tailrocks-repository-skills:tailrocks-create-pr feature/auth
/tailrocks-repository-skills:tailrocks-review-pr #1663
/tailrocks-repository-skills:tailrocks-merge-pr #1663
```

There is no supported bare `/tailrocks-repository-merge` alias. Claude's
plugin discovery and model invocation are separate from authorization for
Git, hosting, merge, and cleanup side effects.

## Amp Code

The release includes an Amp directory-plugin adapter so the complete package,
including the root helpers used by lifecycle skills, is loaded as one unit.
Unpack or copy the release checkout into the project's plugin directory:

```sh
mkdir -p .amp/plugins/tailrocks-repository-skills
cp -R /path/to/extracted/tailrocks-repository-skills-release/. .amp/plugins/tailrocks-repository-skills/
amp skills list
```

The adapter registers the nine skills under the qualified names
`tailrocks-repository-skills:<skill-name>`. Ask the running thread to select
the exact qualified skill by name:

```text
Use the tailrocks-repository-skills:tailrocks-repository-merge skill with --target-branch=release/next feature/auth.
Use the tailrocks-repository-skills:tailrocks-review-pr skill on #1663. Report only; do not post or merge.
```

Use `amp skills list --json` to inspect discovery. Amp's per-skill importer
does not retain arbitrary repository-root files; do not use that route for this
package because lifecycle skills need the bundled root helpers. Amp may mask a
same-named skill from a higher-precedence local or personal directory; inspect
the source before relying on automatic invocation.

## Grok Build

Grok Build accepts the repository as a plugin source. Install and trust the
single consolidated package:

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

Muse loads `.muse-plugin/plugin.json`. Validate and install the complete
package with its native commands:

```sh
muse plugins validate /path/to/tailrocks-repository-skills --json
muse plugins install /path/to/tailrocks-repository-skills --scope user --json
```

In the Muse TUI, select the installed skill and pass the complete argument
string, for example:

```text
tailrocks-repository-merge --target-branch=release/next feature/auth
tailrocks-review-pr #1663
tailrocks-merge-pr #1663
```

The native plugin command is the supported installation route. A plain
`muse exec` prompt is not proof that the installed skill was selected.

## Antigravity CLI (`agy`)

Antigravity uses the root `plugin.json`, intentionally limited to its native
schema. Validate and install the package:

```sh
agy plugin validate /path/to/tailrocks-repository-skills
agy plugin install /path/to/tailrocks-repository-skills
```

Select a skill in the Antigravity session and pass the full argument string:

```text
tailrocks-repository-merge --target-branch=release/next feature/auth
tailrocks-review-pr #1663
tailrocks-merge-pr #1663
```

This is the native CLI plugin route, not an IDE-only convention. The client
does not expose a portable qualified slash-command syntax here.

## Kimi Code CLI

Point Kimi at the consolidated package's `skills/` directory:

```sh
kimi --skills-dir /path/to/tailrocks-repository-skills/skills
```

Invoke with Kimi's native skill command:

```text
/skill:tailrocks-repository-merge --target-branch=release/next feature/auth
/skill:tailrocks-review-pr #1663
/skill:tailrocks-merge-pr #1663
```

`kimi -p` sends a plain prompt; it is not a replacement for explicit
`/skill:<name>` selection when deterministic routing is required.

## OpenCode

OpenCode discovers Markdown skills from the project `.opencode/skills/`
directory. Install the complete skill directories and their bundled helper
scripts from an extracted release package; do not install a separate source
collection. Configure skill approval separately:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "skill": {
      "tailrocks-repository-merge": "ask",
      "tailrocks-repository-audit": "ask",
      "tailrocks-repository-cleanup": "ask",
      "tailrocks-create-pr": "ask",
      "tailrocks-refresh-pr": "ask",
      "tailrocks-review-pr": "ask",
      "tailrocks-merge-pr": "ask",
      "tailrocks-document": "ask",
      "tailrocks-pr-template": "ask"
    }
  }
}
```

For an extracted release package, copy all nine skills and their runtime
helpers as one install:

```sh
mkdir -p .opencode/skills
mkdir -p .opencode/scripts
cp -R /path/to/extracted/tailrocks-repository-skills-release/skills/. .opencode/skills/
cp -R /path/to/extracted/tailrocks-repository-skills-release/scripts/. .opencode/scripts/
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
distinct: `tailrocks-review-pr` reports only, `tailrocks-create-pr` creates a
candidate, `tailrocks-refresh-pr` reconciles its metadata,
`tailrocks-document` handles documentation coverage,
`tailrocks-pr-template` manages the repository template, and
`tailrocks-merge-pr` owns guarded landing. Select the owner explicitly for the
requested repository, source, and target scope.

The installed merge owner currently lacks an atomic compare-and-swap guard for
the selected target base ref and object ID. Remote landing is therefore
blocked until that owner supplies the required guard. Do not retarget a source
PR, invoke a second merge owner, or replace the owner with `gh pr merge`.
`--local-only` can inspect an existing local target but cannot claim remote
delivery or hosted CI.
