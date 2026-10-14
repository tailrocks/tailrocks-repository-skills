# Native client routes

The package contains the three skills and their skill-local references. Install
the complete checkout or release archive. A loader or manifest check proves
packaging and discovery only; it does not prove model behavior or authorize a
merge or deletion.

## Codex CLI 0.156.1

Codex uses `.codex-plugin/plugin.json` and the plugin marketplace route:

```sh
codex plugin marketplace add /path/to/tailrocks-repository-skills
codex plugin add tailrocks-repository-skills@tailrocks-repository-skills
```

Invoke the qualified plugin skill:

```text
$tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
$tailrocks-repository-skills:tailrocks-repository-audit --target-branch=main feature/auth
$tailrocks-repository-skills:tailrocks-repository-cleanup --cleanup=none feature/auth
```

The bare `$tailrocks-repository-merge` spelling is not the supported route for
this plugin.
Codex skill policy metadata controls implicit selection; explicit selection
does not grant filesystem, network, merge, or deletion authority.

## Claude Code 2.1.281

Add the local marketplace and install the plugin in the desired scope:

```sh
claude plugin marketplace add /path/to/tailrocks-repository-skills --scope user
claude plugin install tailrocks-repository-skills@tailrocks-repository-skills --scope user --yes
```

Use the plugin namespace:

```text
/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:tailrocks-repository-audit --target-branch=main feature/auth
/tailrocks-repository-skills:tailrocks-repository-cleanup --cleanup=none feature/auth
```

There is no universal bare `/tailrocks-repository-merge` alias. The current Claude route is
limited to install and manifest validation when OAuth is expired; no model
behavior pass is claimed from that route.

## Muse Code 1.3.0

Muse loads the native `.muse-plugin/plugin.json` manifest. Validate and install
the complete package with the native plugin commands:

```sh
muse plugins validate /path/to/tailrocks-repository-skills --json
muse plugins install /path/to/tailrocks-repository-skills --scope user --json
```

In the Muse TUI, select the installed `tailrocks-repository-merge`,
`tailrocks-repository-audit`, or `tailrocks-repository-cleanup` skill and pass
the complete argument string. A `muse exec` prompt by itself is not proof that
the installed skill was selected. No Muse model behavior pass is claimed.

## Antigravity CLI (`agy`) 1.2.10

Antigravity uses the root `plugin.json`; that manifest is intentionally limited
to `$schema`, `name`, and `description`. Validate and install the package with
the native CLI:

```sh
agy plugin validate /path/to/tailrocks-repository-skills
agy plugin install /path/to/tailrocks-repository-skills
```

Select one of the three skills in the Antigravity session and pass the full
argument string. The route is native CLI packaging, not an IDE-only convention.
No Antigravity model behavior pass is claimed.

## Kimi Code CLI 2.0.2

Point Kimi directly at the package's `skills/` directory:

```sh
kimi --skills-dir /path/to/tailrocks-repository-skills/skills
```

In the TUI, invoke a skill with its native command syntax:

```text
/skill:tailrocks-repository-merge --target-branch=release/next feature/auth
/skill:tailrocks-repository-audit --target-branch=main feature/auth
/skill:tailrocks-repository-cleanup --cleanup=none feature/auth
```

Kimi `-p` sends a plain prompt; it is not a replacement for `/skill:<name>`
selection. No Kimi model behavior pass is claimed.

## OpenCode 1.18.30

OpenCode has no plugin manifest route or documented skill alias for these
Markdown skills. Add the package's `skills/` directory to the project or user
OpenCode configuration and require approval before loading a skill:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "skills": {
    "paths": ["/path/to/tailrocks-repository-skills/skills"]
  },
  "permission": {
    "skill": {
      "tailrocks-repository-merge": "ask",
      "tailrocks-repository-audit": "ask",
      "tailrocks-repository-cleanup": "ask"
    }
  }
}
```

Request the skill by name in the prompt; do not use an undocumented slash
command:

```sh
opencode run "Use the tailrocks-repository-merge skill with --target-branch=release/next feature/auth."
```

OpenCode recognizes `skills.paths` and `permission.skill`, but ignores
`disable-model-invocation` in the Markdown frontmatter. The `ask` permission
approves loading the named skill; it is separate from authorization for Git,
hosting, merge, or cleanup side effects. Model invocation through this route is
unverified.

## Shared lifecycle boundary

Normal remote landing depends on the external Tailrocks pull-request
collection. `tailrocks-review-pr` is read-only; `tailrocks-create-pr` creates a
target-derived candidate when explicitly selected; `tailrocks-merge-pr` owns
the guarded merge. These are manual-only owners and must be selected for the
requested repository/source/target scope.

The installed merge owner currently lacks an atomic compare-and-swap guard for
the selected target base ref and object ID. Remote landing is therefore
blocked. Do not retarget a source PR, invoke a second merge owner, or replace
the owner with `gh pr merge`. `--local-only` can verify an existing local target
but cannot claim remote delivery or hosted CI.

## Checks

See the [README Checks section](../README.md#checks) for the current
deterministic check commands. They do not claim client model behavior;
install-only, blocked, unavailable, and no-model results must remain distinct.
