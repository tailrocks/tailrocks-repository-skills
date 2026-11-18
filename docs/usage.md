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

## Skill owners

| Request | Owner |
| --- | --- |
| Find and preserve local work | `tailrocks-repository-recover` |
| Integrate sources into one exact target | `tailrocks-repository-merge` |
| Open one pull request | `tailrocks-pr-create` |
| Reconcile a pull request title and body | `tailrocks-refresh-pr` |
| Review one pull request | `tailrocks-review-pr` |
| Land one pull request | `tailrocks-merge-pr` |
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

The skill runs one script. The script reads the pull request, the
repository policy from the base branch, and the branch rules. It
returns READY, WAITING, or BLOCKED. Each blocker names the next action
and the skill that owns it. The skill is read-only. A READY verdict is
not a merge. The agent never decides READY itself. The reference
`finding-codes.md` in the skill lists every finding code.

## Example: open a pull request under the repository policy

Invoke the create owner on a branch that holds committed work:

```text
/tailrocks-repository-skills:tailrocks-pr-create
```

The skill runs one script in two steps. `plan` checks the branch name, the
sign-off of each commit, the inventories, and the pre-push steps. It also
picks the base branch and prints a body skeleton. `open` pushes the exact
commit and creates one pull request, as a draft or ready by the policy. It
reuses an open pull request for the branch. The skill never force-pushes and
never creates a second pull request.

## Example: land a pull request

Invoke the merge owner with a pull-request number:

```text
/tailrocks-repository-skills:tailrocks-pr-merge 1663
```

The skill runs one script with four steps: `ready`, `merge`,
`dequeue`, and `watch`. Each step prints its plan first and writes
nothing. A second run with `--confirm` set to the pull-request number
does the write. The `merge` step needs a READY verdict on the
base-branch policy. It enters the merge queue with the head commit
pinned, or merges directly with the policy method. It never uses admin
bypass and never deletes a branch. The `watch` step reports the merge
commit, or the reason that the pull request left the queue. The
reference `merge-rules.md` in the skill lists the gates.

## Lifecycle boundary

Local-work recovery belongs to `tailrocks-repository-recover`.
Multi-source integration belongs to `tailrocks-repository-merge`.
Review, creation, refresh, template work, and landing belong to the
bundled pull-request owners. Each owner needs an explicit selection
when required.

The merge owner verifies the exact target, checks, reviews, and
policy before one merge or enqueue request. It reports blocked,
pending, queued, merged, failed, or uncertain. Read-only inspection
uses native `gh` only:

```sh
gh pr view 1663 --repo OWNER/REPO --json number,title,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision
gh pr checks 1663 --repo OWNER/REPO
```

An inspection result never authorizes mutation. Do not invoke
`gh pr merge`, a direct hosting API merge, a direct ref update, or
another skill to bypass the merge owner.
