# Repository skills guides

This package holds ten skills. The skills coordinate repository work
and run the pull-request lifecycle: status, create, refresh, review
threads, guarded merge, and fleet planning, plus a review skill and a
template skill. Six skills run scripts with Bun and TypeScript.

Six skills are model-selectable. Two skills are user-only and need an
explicit human command:

- `tailrocks-repository-recover` finds and preserves local work.
- `tailrocks-repository-merge` integrates selected work into one exact
  target.

Two write skills, `tailrocks-pr-merge` and `tailrocks-pr-fleet`, need
an explicit user request. Their scripts write only after `--confirm`
(merge) or `--apply` (fleet).

## Guides

- `installation.md` installs the package on eight coding agents.
- `usage.md` shows how to select each skill and what each skill
  returns.
- `compatibility.md` records the test result of each client route.
- `maintenance.md` lists the checks, the policy version, and the
  release procedure.
- `troubleshooting.md` fixes common install and selection failures.

## Skills

| Skill | Task |
| --- | --- |
| `tailrocks-repository-recover` | Preserve local work. User-only. |
| `tailrocks-repository-merge` | Integrate sources into one target. User-only. |
| `tailrocks-pr-status` | Give a PR verdict. Read-only. Script. |
| `tailrocks-pr-create` | Open one draft PR under the policy. Script. |
| `tailrocks-pr-refresh` | Sync base, fix sign-off, fix body. Script. |
| `tailrocks-pr-threads` | Triage and resolve review threads. Script. |
| `tailrocks-pr-merge` | Land one PR, guarded. Explicit only. Script. |
| `tailrocks-pr-fleet` | Plan work on all open PRs. Explicit only. Script. |
| `tailrocks-review-pr` | Review and report. Read-only. |
| `tailrocks-pr-template` | Manage the PR template. |

Each skill body lives in its own directory under `skills/`. Read
`skills/tailrocks-review-pr/SKILL.md` for one complete example.

## Requirements

All repository workflows need Git and `gh`. The script-backed skills
need Bun 1.4 or newer. Hosted pull-request creation, refresh, review,
and landing need an authenticated `gh` session with access to the
target repository. Only GitHub.com is
supported. GitHub Enterprise is unsupported. Read-only audits can run
without authentication.
