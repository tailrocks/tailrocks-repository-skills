# tailrocks-repository-skills

One portable package with ten skills. The skills coordinate
repository work and run the pull-request lifecycle: status, create,
refresh, review threads, guarded merge, and fleet planning, plus a
review and a template skill. Six skills run scripts with Bun and
TypeScript. Six skills are model-selectable. Two skills are user-only
and need an explicit human command. Two write skills, `pr-merge` and
`pr-fleet`, need an explicit user request, and their scripts write only
after `--confirm` or `--apply`.

## Skills

| Skill | Task |
| --- | --- |
| [`tailrocks-repository-recover`](skills/tailrocks-repository-recover/SKILL.md) | Preserve local work. User-only. |
| [`tailrocks-repository-merge`](skills/tailrocks-repository-merge/SKILL.md) | Integrate sources into one target. User-only. |
| [`tailrocks-pr-status`](skills/tailrocks-pr-status/SKILL.md) | Report READY, WAITING, or BLOCKED for a PR. Read-only. Script. |
| [`tailrocks-pr-create`](skills/tailrocks-pr-create/SKILL.md) | Open one draft PR under the policy. Script. |
| [`tailrocks-pr-refresh`](skills/tailrocks-pr-refresh/SKILL.md) | Sync with the base, fix sign-off, reconcile title and body. Script. |
| [`tailrocks-pr-threads`](skills/tailrocks-pr-threads/SKILL.md) | Triage, reply to, and resolve review threads. Script. |
| [`tailrocks-pr-merge`](skills/tailrocks-pr-merge/SKILL.md) | Land one PR through guarded steps. Explicit request only. Script. |
| [`tailrocks-pr-fleet`](skills/tailrocks-pr-fleet/SKILL.md) | Plan and run work on all open PRs under a CI budget. Explicit request only. Script. |
| [`tailrocks-review-pr`](skills/tailrocks-review-pr/SKILL.md) | Review and report. Read-only. |
| [`tailrocks-pr-template`](skills/tailrocks-pr-template/SKILL.md) | Manage the PR template. |

Each skill body lives in its own directory. Read
`skills/tailrocks-review-pr/SKILL.md` for one complete example.

## Install

Install the package from the central `tailrocks` marketplace. Use
the qualified id `tailrocks-repository-skills@tailrocks` wherever
the client accepts it. Each row links its full section in
`docs/installation.md`.

| Agent | Method |
| --- | --- |
| Claude Code | [Marketplace install](docs/installation.md#claude-code) |
| Codex | [Marketplace add](docs/installation.md#codex) |
| Amp | [Per-skill add](docs/installation.md#amp) |
| Muse Code | [Marketplace install](docs/installation.md#muse-code) |
| OpenCode | [Skill-directory copy](docs/installation.md#opencode) |
| Antigravity | [Local-path install](docs/installation.md#antigravity) |
| Grok Build | [Marketplace install](docs/installation.md#grok-build) |
| Kimi Code | [In-session manager](docs/installation.md#kimi-code) |

Quick start on Claude Code (shell):

```sh
claude plugin marketplace add tailrocks/tailrocks-skills
claude plugin install tailrocks-repository-skills@tailrocks --scope user
```

All repository workflows need Git and `gh`. Hosted pull-request
work needs an authenticated `gh` session. Only GitHub.com is
supported. The six script-backed skills also need Bun 1.4 or newer.
They read the repository policy from `.config/pr-policy.toml` on the
default branch. See `docs/usage.md` and `examples/`.

## Use

Select the owner for the requested work. To review pull request
1663 on Claude Code (session):

```text
/tailrocks-repository-skills:tailrocks-review-pr #1663
```

The skill returns a report with findings, evidence, and one verdict:
Ready, Changes required, or Incomplete. The skill is read-only. See
`docs/usage.md` for every owner, more examples, and the lifecycle
boundary.

## Documentation

- `docs/README.md` indexes the guides.
- `docs/installation.md` installs the package on eight agents.
- `docs/usage.md` shows how to select each skill.
- `docs/compatibility.md` records each route result.
- `docs/maintenance.md` lists checks, policy, and release steps.
- `docs/troubleshooting.md` fixes common failures.

## Update and remove

Refresh the marketplace first. Then refresh the plugin
`tailrocks-repository-skills@tailrocks`. Remove the plugin when you
no longer need it. Follow the lifecycle steps in the agent section
of `docs/installation.md`:

- [Claude Code](docs/installation.md#claude-code)
- [Codex](docs/installation.md#codex)
- [Amp](docs/installation.md#amp)
- [Muse Code](docs/installation.md#muse-code)
- [OpenCode](docs/installation.md#opencode)
- [Antigravity](docs/installation.md#antigravity)
- [Grok Build](docs/installation.md#grok-build)
- [Kimi Code](docs/installation.md#kimi-code)

## Contribute

Open an issue or a pull request on GitHub. Write all new and changed
prose in ASD-STE100 Simplified Technical English, Issue 9 rules. Run
`alint check`, the strict-JSON check, and the frontmatter check
before the pull request. See `docs/maintenance.md` for the full
list. Never add evaluation content.

## License

Apache License, Version 2.0. See `LICENSE` for the full text.
