# Usage

Each skill has one owner task. Select the owner for the requested
work. One skill never borrows another skill task.

## Select a skill

Use the selector of the installed client. See `installation.md` for
the exact install of each client. The review skill shows the shape on
each client:

```text
/tailrocks-repository-skills:tailrocks-review-pr #1663
$tailrocks-review-pr #1663
/skill:tailrocks-review-pr #1663
/tailrocks-review-pr #1663
```

The first form fits Claude Code. The second form fits Codex. The
third form fits Kimi Code. The fourth form fits Muse, Antigravity,
and Grok pickers. Amp has no slash invoke: ask the thread
for the exact qualified skill by name. OpenCode has no slash invoke:
request the skill by name in the prompt.

The two user-only skills need an explicit human command on every
client. A model must not select `tailrocks-repository-recover` or
`tailrocks-repository-merge` from task similarity.

`tailrocks-pr-merge` and `tailrocks-pr-fleet` set
`allow_implicit_invocation: false` in `agents/openai.yaml`. Only Codex
reads that flag. On every client, their scripts print a plan and write
nothing until the user passes `--confirm <pr>` (merge) or `--apply`
(fleet). Run them only when the user asked for the write.

## Skill owners

| Request | Owner |
| --- | --- |
| Find and preserve local work | `tailrocks-repository-recover` |
| Integrate sources into one exact target | `tailrocks-repository-merge` |
| Find out if a pull request can merge | `tailrocks-pr-status` |
| Open one pull request | `tailrocks-pr-create` |
| Sync the base, fix sign-off, or fix title and body | `tailrocks-pr-refresh` |
| Triage, answer, and resolve review threads | `tailrocks-pr-threads` |
| Land one pull request | `tailrocks-pr-merge` |
| Plan or run work on all open pull requests | `tailrocks-pr-fleet` |
| Review one pull request | `tailrocks-review-pr` |
| Create or reconcile the pull-request template | `tailrocks-pr-template` |

Read the skill body for the full procedure. Each body lives at
`skills/` plus the skill id plus `SKILL.md`. One example is
`skills/tailrocks-review-pr/SKILL.md`.

## Example: review a pull request

Invoke the review owner with the pull-request number:

```text
/tailrocks-repository-skills:tailrocks-review-pr #1663
```

The skill returns a report with findings, concrete evidence, and one
verdict: Ready, Changes required, or Incomplete. The skill is
read-only. It never posts, approves, or merges. A review report never
authorizes a merge. To land the pull request, select the merge owner
in a separate explicit command.

## Example: integrate sources into one target

Invoke the merge owner with sources and one exact target branch:

```text
$tailrocks-repository-merge --target-branch=release/next feature/auth
```

The example uses the Codex selector. The selector list above shows
the form of each client.

The skill audits, groups, integrates, reviews, and merges the
selected sources into that target only. Without `--target-branch`,
the target is the literal branch `main`. The target must already
exist. The skill never falls back to another branch. `--audit-only`
stops after the report and changes nothing.

## Example: recover local work

Invoke the recover owner. Without `--publish`, it analyzes and
reports only:

```text
/tailrocks-repository-skills:tailrocks-repository-recover --repo OWNER/REPO --publish
```

The skill finds Git copies and related loose files, compares them
with the target, and publishes marked recovery branches and pull
requests. Cleanup defaults to off. Recovery never merges. Later
integration needs a separate human invocation of
`tailrocks-repository-merge` with the published source list.

## Example: read the status of a pull request

Invoke the status owner with a pull-request number, or with `--all`:

```text
/tailrocks-repository-skills:tailrocks-pr-status 1663
```

The skill runs one script with Bun. The script reads the pull request,
the repository policy from the default branch at its current commit,
and the branch rules. It returns READY, WAITING, or BLOCKED. Each
blocker names the next action and the skill that owns it. The skill is
read-only. It hands off to the owner skill, and it runs that skill only
when the user asked for the fix or the merge. A READY verdict is not a
merge. The agent never decides READY itself. The reference
`finding-codes.md` in the skill lists every finding code and the order
of the blockers.

## Repository policy

The script-backed skills read one policy file:
`.config/pr-policy.toml` on the default branch, at its current commit.
They never read it from a pull-request head, from the base of a stacked
pull request, or from the working tree. A pull request cannot change
its own gates. Without the file, the skills use built-in defaults and
the rules that GitHub enforces. `schemas/pr-policy.schema.json` holds
the contract. `examples/` holds example policies. `--policy <file>`
exists for checks and tests only. A verdict from a local policy file is
advisory, and `tailrocks-pr-merge` refuses it.

## Example: land a pull request

Invoke the merge owner with a pull-request number:

```text
/tailrocks-repository-skills:tailrocks-pr-merge 1663
```

The skill runs one script with four steps: `ready`, `merge`,
`dequeue`, and `watch`. The steps `ready`, `merge`, and `dequeue`
print their plan first and write nothing. A second run with
`--confirm` set to the pull-request number does the write. The `watch`
step needs no plan run: run it directly with `--confirm`. The `merge`
step needs a READY verdict on the
default-branch policy. It enters the merge queue with the head commit
pinned, or merges directly with the policy method. It never uses admin
bypass and never deletes a branch. The `watch` step reports the merge
commit, or the reason that the pull request left the queue. The
reference `merge-rules.md` in the skill lists the gates.

## Lifecycle boundary

Local-work recovery belongs to `tailrocks-repository-recover`.
Multi-source integration belongs to `tailrocks-repository-merge`.
Status, creation, refresh, review-thread triage, review, template
work, landing, and fleet planning belong to the bundled pull-request
owners. Each owner needs an explicit selection when required.

The merge owner verifies the exact target, checks, reviews, and
policy before one merge or enqueue request. It reports blocked,
pending, queued, merged, failed, or uncertain. Read-only inspection
uses `tailrocks-pr-status` or native `gh`:

```sh
gh pr view 1663 --repo OWNER/REPO --json number,title,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision
gh pr checks 1663 --repo OWNER/REPO
```

An inspection result never authorizes mutation. Do not invoke
`gh pr merge`, a direct hosting API merge, a direct ref update, or
another skill to bypass the merge owner.
