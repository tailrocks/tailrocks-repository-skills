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

Install one complete package in your host's chosen scope. The [Tailrocks
catalog](https://github.com/tailrocks/tailrocks-skills) selects the source commit.
Use the route for your host.

| Host | Native install route |
| --- | --- |
| Claude Code | [Marketplace plugin](docs/installation.md#claude-code) |
| Codex | [Marketplace plugin](docs/installation.md#codex) |
| Grok Build | [Marketplace plugin](docs/installation.md#grok-build) |
| Muse Code | [Marketplace snapshot](docs/installation.md#muse-code) |
| omp | [Marketplace plugin](docs/installation.md#omp) |
| OpenCode V2 | [Git package](docs/installation.md#opencode) |
| Amp | [Directory plugin](docs/installation.md#amp) |
| Antigravity | [Local plugin installer](docs/installation.md#antigravity) |
| pi | [Git package](docs/installation.md#pi) |
| Kimi Code | [Marketplace manager](docs/installation.md#kimi-code) |

Run these commands to install from the Claude Code marketplace.

```sh
claude plugin marketplace add tailrocks/tailrocks-skills
claude plugin install tailrocks-repository-skills@tailrocks --scope user
```

See [runtime requirements](docs/runtime.md) for tools and files the skills use.

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

- [Package guide](docs/README.md)
- [Installation](docs/installation.md)
- [Usage](docs/usage.md)
- [Runtime requirements](docs/runtime.md)
- [Model settings](docs/models.md)
- [Compatibility and verification](docs/compatibility.md)
- [Maintenance](docs/maintenance.md)

## Update and remove

Use [the host's update and removal steps](docs/installation.md).
For a pinned Git package, install the new catalog revision and use one copy in
the chosen scope.

## Contribute

Open an issue or a pull request on GitHub. Write all new and changed
prose in ASD-STE100 Simplified Technical English, Issue 9 rules. Run
`alint check`, the strict-JSON check, and the frontmatter check
before the pull request. See `docs/maintenance.md` for the full
list. Never add evaluation content.

## License

Apache License, Version 2.0. See `LICENSE` for the full text.
