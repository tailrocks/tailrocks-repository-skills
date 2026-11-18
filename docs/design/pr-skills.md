# Design: script-backed pull-request skills

<!-- markdownlint-disable MD013 -->

Status: proposed. Author: Claude Opus 5.5. Date: 2026-11-19.

This note designs a set of skills that take a GitHub pull request from creation
to merge. Each skill follows a process that the repository declares in one
policy file. A script computes every gate. The agent does not decide from memory
which gates to check.

## 1. Problem

Agents that drive many pull requests skip steps. These failures occurred on
2026-11-18 and 2026-11-19. Each failure maps to a check that a script now owns.

| Failure | Owner check |
| --- | --- |
| An approved PR had five unresolved bot review threads. The merge stayed blocked. The agent checked only the review verdict. | `pr-status`: `threads_unresolved` |
| New commits made an approval stale. Nobody asked for a new review. | `pr-status`: `review_stale`, with carry-over only across empty commits, clean base merges, and trailer-only rewrites (section 4) |
| The merge queue ejected a PR. The ejected entry blocked every entry behind it. | `pr-status`: `queue_unmergeable`, `queue_ejected`; `pr-fleet`: queue hygiene |
| The base moved. A merge-parent check went red. The fix was a base merge, not a code change. | `pr-status`: `check_stale_base` |
| Generated files and goldens conflicted on a base merge. | `pr-refresh`: regenerate with policy commands, never hand-merge |
| A repository inventory missed a new file. A Linux-only check failed. | `pr-refresh` and `pr-create`: inventory check |
| Bot commits had no DCO sign-off. | `pr-status`: `dco_missing`; `pr-refresh`: DCO-only trailer rewrite |
| A stacked PR could not enter the merge queue. | `pr-status`: `stacked` |
| Each push during CI congestion started a full CI run. | `pr-fleet`: refresh budget; `pr-create`: draft first; label-triggered CI |
| Agents killed processes by pattern, deleted globs, force-pushed, or touched other branches. | Safety layer in the shared library (section 8) |

## 2. Audit of the existing plugin

`tailrocks-repository-skills` 0.4.1 already owns the pull-request lifecycle. Its
skills are prose only. They have no scripts.

| Skill | Gaps against the failures above |
| --- | --- |
| `tailrocks-create-pr` | No draft-first policy. No pre-push checks. No issue-link rule (Closes or Part of). No inventory check. No sign-off check before the push. |
| `tailrocks-refresh-pr` | Metadata only: title and body. It does not merge the base, regenerate files, or fix DCO. |
| `tailrocks-merge-pr` | It reads `gh pr checks` and the review decision. It never reads review threads, DCO, queue state, or queue ejections. It requires a review of the head but has no rule for clean base merges. It enqueues and stops. It does not watch the entry. |
| `tailrocks-review-pr` | In scope for review only. Keep. |
| `tailrocks-pr-template` | Keep. |
| `tailrocks-repository-merge`, `tailrocks-repository-recover` | Out of scope. Keep. Update their links to the new skill ids. |

Packaging findings, checked against the research in
[agent-skill-formats.md](../research/agent-skill-formats.md):

- The skills use the frontmatter keys `when_to_use`, `argument-hint`,
  `user-invocable`, and `disable-model-invocation`. The Codex skill validator
  accepts only `name`, `description`, `license`, `allowed-tools`, and
  `metadata`. The new skills use only `name`, `description`, and `license`.
- The three manifests (root `plugin.json` with the Agent Plugins schema URL,
  `.claude-plugin/plugin.json`, and `.kimi-plugin/plugin.json` with `"skills":
  "./skills/"`) agree with current documentation. Keep them.

### Decision: extend this plugin

GitHub pull-request work is the stated scope of this plugin. A new plugin would
duplicate three skills. Therefore the new skills go into
`tailrocks-repository-skills`. The new skills replace `tailrocks-create-pr`,
`tailrocks-refresh-pr`, and `tailrocks-merge-pr` in the same release. The old
skills are deleted, with no aliases. The release is 0.5.0.

## 3. Skills

All skills are generic. No skill, script, reference, schema, default, or message
names a repository or an organization. Repository facts come from the policy
file and from the GitHub rules API at run time. A test scans `skills/`, `lib/`,
`schemas/`, `examples/`, and the test fixtures. The test holds a deny-list of
repository, organization, and user names. It fails on any match.

| Skill id | Purpose | Writes |
| --- | --- | --- |
| `tailrocks-pr-status` | One verdict per PR: READY, BLOCKED, or WAITING. Lists each blocker with the exact next action. Works for one PR or all open PRs. | Nothing |
| `tailrocks-pr-create` | Branch, signed commits, policy body, draft by default, correct base, labels, issue link. Runs pre-push checks first. | Branch, commits, one PR |
| `tailrocks-pr-refresh` | One script, `refresh.ts <mode>`. The mode is required. The skill has no default mode. It maps the request to a mode. `sync` merges the base with sign-off. It then regenerates declared outputs, checks inventories, and runs pre-push checks. It pushes once. It asks for a new review when the merge was not clean. `dco-fix` is the DCO-only exception. `metadata` reconciles the title and body. It needs no checkout and makes no push. A request about the title or body maps to `metadata`. | Commits on the PR branch, comments, PR metadata |
| `tailrocks-pr-threads` | Triages unresolved review threads: fix or defer under the policy severity rule. Replies with the reason. Resolves. Never resolves a human's open question. | Replies, resolutions, fix commits |
| `tailrocks-pr-merge` | Steps `ready` (draft to ready), `merge`, and `dequeue`. `merge` requires READY from `pr-status` on a base-branch policy, a body that follows the template, a confirmed squash queue method, and the user's confirmation for high-risk paths (workflows, release, auth, migrations). Enqueues with `expectedHeadOid` (normal or jump by policy; a refused jump is BLOCKED), or squash-merges with `--match-head-commit`. Watches until merged or ejected. On ejection, runs `pr-status`. | Ready state, queue entry, merge |
| `tailrocks-pr-fleet` | Runs `pr-status` on all open PRs. Ranks them. Finds stockpiling. Plans refreshes under a CI budget. Honors a freeze switch. Plans the dequeue of UNMERGEABLE entries at the head of the queue. Executes only through the other skills' scripts, and only with `--apply`. | Only through the other skills |

### Script behavior each skill replaces

| Script | Behavior | New owner |
| --- | --- | --- |
| `review-gate-core.sh` | Latest verdict review on the head says approve. No later review reports a blocking finding. | `pr-status` (`review_*`) |
| `review-gate.sh` | Carries a verdict across empty commits and clean base merges: second parent on base, tree equal to `git merge-tree`, at most three merges. | `pr-status` (git facts) |
| `enqueue2.sh` | Waits for the base to be the default branch (stacked). Waits for required checks, DCO, and zero unresolved threads. Waits while CI runs on the head. Enqueues with `expectedHeadOid`. Watches until merged or out of the queue. Dequeues when a changes-needed review arrives. | `pr-status` (gates), `pr-merge` (enqueue, watch, dequeue) |
| `jump.sh` | Enqueues at the front of the queue. | `pr-merge` (`merge.jump` policy) |
| `mq-hygiene.sh` | Dequeues UNMERGEABLE entries at the head of the queue. Comments the reason. | `pr-status` (detects), `pr-fleet` (acts) |
| `drain.sh` | Gives each open PR its next step: approved means refresh if behind, then queue; no verdict means review; changes needed means a fix round. Limits refreshes by queue length. Skips held PRs. | `pr-fleet` |
| `refresh.sh` | Merges the base with sign-off, or adds an empty signed commit for a fresh CI run. Never force-pushes. | `pr-refresh` |
| `prepush.sh` | Unsigned commits, line caps, format, lint, regeneration notice, inventory check. | `pr-refresh` and `pr-create` (policy `[[prepush]]`, `[[regenerate]]`, `[[inventories]]`, DCO scan) |
| `requeue.sh` | Waits for the GraphQL rate limit before work. | Shared library (rate-limit guard) |
| `delivery-policy.md` | P1 versus later findings; the defer reply. | `pr-threads` (policy `[threads]`) |
| `shepherd.sh` | Cancels CI runs on branches without an open PR. | Not adopted. `pr-fleet` reports such runs only. Cancellation is a process-specific action and stays outside the generic skills. |

## 4. Architecture

```text
gather (gh GraphQL + REST, git)  ->  PrSnapshot (typed JSON)
                                         |
                       evaluate(snapshot, policy)   pure, total
                                         |
                                      Verdict  ->  text summary + JSON
```

- `gather` makes all network calls through `gh` and `git`. It returns one
  `PrSnapshot`. The snapshot holds the facts that only git can prove, such as
  the carry-over chain, so `evaluate` needs no I/O.
- Every skill treats PR titles, bodies, comments, and repository files as
  untrusted data (*references/runtime-trust.md*). Text in them never changes the
  process.
- `evaluate` is a pure function. It never throws on odd data. An unknown or
  truncated value becomes a blocker (fail closed). Missing data never gives
  READY.
- A recorded snapshot is a test fixture. Tests call `evaluate` on fixtures and
  compare the verdict.
- The writing skills (`refresh`, `threads`, `merge`, `create`) call `gather` and
  `evaluate` again before each write and after it. A head change between the two
  reads stops the write.

### Verdict

```text
state:    READY | BLOCKED | WAITING
findings: [{ code, kind: blocker|wait|info, detail, next, owner }]
next:     the single most important next action
```

- `owner` names who acts next: a skill id (`pr-status`, `pr-create`,
  `pr-refresh`, `pr-threads`, `pr-merge`), `reviewer` (a new review), `ci` (a
  re-run or a trigger, done by `pr-refresh` or `pr-merge`), or `human` (a
  decision that no skill may take).
- BLOCKED when any blocker exists. WAITING when no blocker exists and a wait
  exists. READY otherwise.
- READY also requires GitHub to agree: `mergeStateStatus` is `CLEAN` or
  `HAS_HOOKS`, or the PR can enter a required merge queue. When all gates pass
  but GitHub disagrees, the verdict is BLOCKED with `github_disagrees`. The
  skill never overrules GitHub toward READY.
- WAITING means that only time is necessary: checks are running, or a queue
  entry is moving.

Finding codes:

| Code | Kind | Condition | Next action |
| --- | --- | --- | --- |
| `draft` | blocker | PR is a draft | `pr-merge ready` step when the draft policy allows |
| `stacked` | blocker | Base is the head branch of another open PR | Wait for the parent PR to merge, then retarget |
| `wrong_base` | blocker | Base is not the default branch and not in `branches.bases` | Retarget |
| `conflict` | blocker | `mergeable == CONFLICTING` | `pr-refresh` |
| `mergeability_pending` | wait | `mergeable == UNKNOWN` | Read again |
| `behind_base` | info or blocker | Behind the base; blocker only when the ruleset requires up-to-date branches | `pr-refresh` |
| `check_failed` | blocker | Required check is `failure`, `timed_out`, `startup_failure`, `action_required`, or status `ERROR`/`FAILURE`; or a flaky check failed more than `checks.flaky_reruns` times | Fix the cause |
| `check_flaky` | blocker | Failed check is on the flaky list, within its rerun allowance | Re-run the check |
| `check_cancelled` | blocker | Required check `cancelled` or `stale`, no failure | Re-run or push |
| `check_not_passing` | blocker | Required check `skipped` or `neutral` where policy does not accept it | Investigate |
| `check_wrong_source` | blocker | A check with the required name comes from a different app than the rule names | Investigate |
| `check_stale_base` | blocker | Base-sensitive check failed while behind the base | `pr-refresh`; no code change |
| `check_missing` | blocker | Required check has no run on the head | Trigger CI (label or push) |
| `checks_pending` | wait | Required check queued, in progress, or status `EXPECTED`/`PENDING`; or a run of a `checks.watched_workflows` workflow is unfinished on the head | Watch |
| `ci_label_needed` | blocker | Label-triggered CI and the full suite did not run | Add the run-once label |
| `review_missing` | blocker | No verdict on the head or on a carry-over equivalent | Request review |
| `review_changes_requested` | blocker | The latest review of any counted reviewer asks for changes | `pr-threads`, then fix |
| `review_decision` | blocker | Branch rules require approvals or code-owner review and `reviewDecision != APPROVED` | Request review |
| `review_blocking_finding` | blocker | Approval or a later review lists a blocking finding | `pr-threads` |
| `review_stale` | blocker | Verdict is on an older head and carry-over does not apply | Request review |
| `threads_unresolved` | blocker | Any unresolved thread, bot or human | `pr-threads` |
| `dco_missing` | blocker | A non-exempt commit has no `Signed-off-by:` trailer | `pr-refresh dco-fix` |
| `queued` | wait | In the queue, state is QUEUED, AWAITING_CHECKS, MERGEABLE, or LOCKED | Watch |
| `queue_unmergeable` | blocker | Queue entry is UNMERGEABLE | `pr-merge dequeue`, then `pr-refresh` |
| `queue_ejected` | info | Removed from the queue after the last push. The reason is free text from GitHub | The matching blocker gives the action |
| `done_when_unchecked` | blocker or info | Linked issue (closing reference, or `Part of`/`Refs` link in the body) has unchecked Done-when boxes; kind from `issues.done_when` | Prove or link |
| `body_template` | blocker | `pr_body.enforce` is true and the body misses a required section or has a placeholder | `pr-refresh metadata` |
| `github_disagrees` | blocker | All gates pass but `mergeStateStatus` does not allow a merge | Read GitHub's reason; do not merge |
| `gate_failed` | blocker | A policy `[[gates]]` entry fails | Per gate |
| `pr_not_open` | blocker | PR is closed or merged | None; report the state |
| `cross_repository` | info | Head is in a fork | Writing skills refuse; status only |
| `unknown_state` | blocker | Data missing, truncated, or unparseable | Run `pr-status` again |

## 5. Repository policy file

Path: `.config/pr-policy.toml`, read from the **base branch at its current SHA**
through `gh api .../contents?ref=<base sha>`. The skills never read the policy
from the PR head or the working tree. A PR therefore cannot weaken its own gates
or add commands that the skills then run. `--policy <path>` exists only for
`validate` and for tests. A verdict computed with a local policy says so, and
`pr-merge` refuses it.

Reasons for this path:

- A TOML file can be validated against a schema. A section of `AGENTS.md` is
  prose. An agent cannot validate prose.
- Some repositories generate `.github/` and replace the whole tree on each
  generation. A file there would be lost.
- `.config/` is a common place for tool configuration at the repository root.

The JSON schema is `schemas/pr-policy.schema.json`. A validator in the shared
library checks the parsed TOML against the schema at load. The validator has no
dependencies, so the scripts make no package downloads at run time. Every object
sets `additionalProperties: false`, so a misspelled key fails. An invalid policy
stops every skill with the validator message. No skill runs on a guess.

When the file is absent, the skills use built-in defaults plus the facts GitHub
enforces. The required checks are the union of three sources: the rules API
(`rules/branches/<base>`), classic branch protection (`branches/<base>`
protection, matched on context and app), and `isRequired` on each check of the
head. The merge queue comes from `repository.mergeQueue(branch:)`. Policy
`checks.required` adds to this union. It cannot remove a check.

The validator rejects any schema keyword it does not implement, so a schema rule
can never be skipped in silence.

Sections: `branches`, `checks`, `review`, `threads`, `dco`, `merge`, `draft`,
`labels`, `ci`, `issues`, `pr_body`, `[[prepush]]`, `[[regenerate]]`,
`[[inventories]]`, `[[gates]]`, `fleet`. The schema holds the full contract and
the defaults. Commands are argument arrays. No command passes through a shell.

The plugin ships `examples/comment-verdict-merge-queue.toml`. It describes a
real process: verdict review comments, review bots, a squash merge queue, DCO,
regenerated goldens, and an inventory. The example names no repository.

### Reviews

- Source `github-approval`: the counted reviews are
  `latestOpinionatedReviews(writersOnly: true)`, one per reviewer. Any counted
  CHANGES_REQUESTED blocks. When branch rules require approvals or code-owner
  review, READY also needs `reviewDecision == APPROVED`. GitHub dismisses stale
  approvals itself when the rule says so, so no carry-over applies.
- Source `comment-verdict`: the latest verdict review per counted reviewer.
  Counted reviewers are `review.reviewers` when set, else authors with write
  access (`authorAssociation` OWNER, MEMBER, or COLLABORATOR). Any counted
  reviewer whose latest verdict asks for changes blocks. An approval that also
  matches `blocking_pattern` is not an approval.
- Carry-over (`review.carry_over = "clean-base-merge"`, comment-verdict only)
  walks back from the head over three kinds of step, at most `max_carry_merges`
  times:
  - an empty commit (same tree as its only parent);
  - a clean merge of the base: two parents, the second parent is an ancestor of
    the PR's real base branch, `git merge-tree --write-tree` exits 0, and its
    tree equals the merge commit's tree;
  - a trailer-only rewrite: the head tree equals the tree of a reviewed commit
    and the commit messages differ only by `Signed-off-by:` lines. A failed
    fetch or any other git error sets `available = false`. The chain then stops,
    and the verdict needs a review of the head itself.

## 6. Packaging

Each choice cites [agent-skill-formats.md](../research/agent-skill-formats.md),
researched 2026-11-19 from the official documentation and the installed
binaries.

| Choice | Reason and source |
| --- | --- |
| Flat `skills/<id>/SKILL.md`, `name` equal to the directory, lowercase with hyphens, at most 64 characters | Agent Skills specification (agentskills.io); Codex validator; omp and agy scan one level deep. |
| Frontmatter: `name`, `description`, `license` only | Codex validator rejects other keys. The intersection loads in all eight agents. |
| Description at most 1024 characters, no `<` or `>`, trigger first | Spec limit; Claude Code lists 1536 characters with `when_to_use`; Codex listing budget is 2% of context or 8000 characters. |
| SKILL.md under 500 lines and about 5000 tokens; details in *references/*, one level deep | Anthropic best practices; agentskills.io; Grok reads at most 25 000 tokens of a body. |
| `agents/openai.yaml` with `interface` and `policy.allow_implicit_invocation` | Codex documentation. `pr-merge` and `pr-fleet` set `false`. Codex reads this flag. Claude Code has its own key, `disable-model-invocation`, but the Codex validator rejects that key. No portable key exists, so the write scripts of these two skills also require `--confirm <PR number>` (merge) or `--apply` (fleet). Without it they only print the plan. |
| Root `plugin.json` with `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` | Codex, Grok, Muse, omp, and agy read it. Muse rejects any other schema URL. |
| `.claude-plugin/plugin.json` | Claude Code reads only this path. |
| `.kimi-plugin/plugin.json` with `"skills": "./skills/"` | Kimi does not scan `skills/` without this field. |
| Scripts are named as paths relative to the skill directory | Agent Skills specification: bundled files are referenced relative to the skill root. Agent variables (`${CLAUDE_PLUGIN_ROOT}`, `${KIMI_SKILL_DIR}`) differ per agent, so SKILL.md uses none. |
| Script paths in commands | `<skill-dir>` is the absolute path of the directory that contains the SKILL.md. Each agent shows this path when it loads a skill. The agent replaces the token before it runs the command. |
| Root `plugin.json` for agy | agy reads it as an Agent Plugin only with `enable-agent-plugins-spec`; otherwise as a native plugin. Both routes load `skills/`. |

### Scripts

- All scripts are TypeScript. Bun runs them: `bun run
  <skill-dir>/scripts/<name>.ts`.
- Each skill is self-contained, because several agents load single skill
  directories (`pi --skill`, `kimi --skills-dir`, `.agents/skills`). The shared
  library source lives in `lib/` at the plugin root. A build step copies it into
  `skills/<id>/scripts/lib/`. A test fails when a copy differs from `lib/`.
  Symlinks are not used: Grok and Muse refuse them.
- Step 1 of each SKILL.md runs `bun --version`. When Bun is missing, the skill
  stops and says how to install it. A plugin delivers files, not runtimes.
- Bun is pinned in `package.json` (`packageManager`) and in `mise.toml`. Each
  entry script checks `Bun.version` and stops with a clear message when the
  major or minor version is lower.
- `tsconfig.json` sets `strict: true` and the extra strict flags. No `any`. Lint
  rejects `any`.
- `gh` and `git` run only through `Bun.spawn` with argument arrays. No shell
  strings exist.
- All GitHub JSON goes through typed parsers. A parse failure is an
  `unknown_state` blocker, not a crash and not a pass.
- The scripts make no network calls except through `gh` and `git`. They never
  print tokens. `gh` reads its own credentials.
- Tests use `bun test` with recorded fixtures. Runtime has no dependencies.
  Development has two pinned dependencies: `typescript` and `@types/bun`.

## 7. DCO-only force-push exception

`pr-refresh dco-fix` may force-push without asking, only to add missing
`Signed-off-by:` trailers. The code enforces each guarantee:

1. Refuse in each of these cases:
   - the branch is the default branch or matches `branches.protected`;
   - the branch has an open queue entry. `dco.dequeue_for_fix` (default false)
     lets `pr-merge dequeue` remove the entry first;
   - the PR comes from another repository;
   - the PR author is not the current `gh` user and not a `dco.bot_authors`
     login;
   - a commit in the range has a GPG or SSH signature. A rewrite drops the
     signature.
2. Find the first commit without the trailer. Rewrite from that commit to the
   head. Commits before it keep their SHAs.
3. For each commit in the range, create a new commit with `git commit-tree`: the
   same tree, the same author name, email, and date, the same message plus one
   `Signed-off-by: <git identity>` line. A commit that already has the trailer
   gets the same tree and message on the new parent.
4. Verify before the push: the same count; each tree hash equal to the original
   tree (`git rev-parse <c>^{tree}`); each message diff is only the added
   trailer; authors and dates equal. Any mismatch stops the run. Nothing is
   pushed.
5. Push with `--force-with-lease=<branch>:<old head>`. If the remote moved, the
   push fails. Report and stop.
6. Log the old and new heads. Comment on the PR: "Added missing DCO sign-off to
   N commits; trees unchanged (old `<sha>` → new `<sha>`)".
7. Bot authors: when `dco.bot_commits = "exempt"`, skip their commits. When it
   is `"rewrite"`, rewrite them the same way, as the owner decided. The report
   warns that a DCO check which matches the sign-off to the commit author can
   still fail for those commits.
8. The rewrite keeps every tree, so the carry-over rule "trailer-only rewrite"
   keeps a review valid. Without carry-over, the report says that a new review
   is necessary.

Tests: unsigned commits give equal trees and only added trailers; a moved remote
stops the push; a protected branch is refused.

## 8. Safety rules in code

The shared process layer enforces these rules with an allow-list, not a block
list. A test calls each forbidden form and expects a refusal.

- `gh`: only listed subcommands and argument shapes run. The list includes `run
  rerun --failed`, `run view`, `run list`, `pr checks`, and `pr edit
  --add-label/--remove-label`, which the skills need for re-runs and
  label-triggered CI. `gh api` runs GET, and POST/PATCH/PUT/DELETE only for
  listed endpoints (comments, review-thread GraphQL mutations, enqueue/dequeue
  mutations). Refuse `--admin`, `gh pr merge --delete-branch`, and `gh auth
  token`.
- `git push`: one form only, `git push <remote> <sha>:refs/heads/<branch>`.
  Refuse `--force`, `-f`, `--force-if-includes`, `--delete`, `--mirror`,
  `--all`, `--tags`, `+` and `:` refspecs. The DCO module alone may add
  `--force-with-lease=<branch>:<old sha>`.
- `git rebase`: never. The policy has no switch for rebase or force-push.
- Git error output is scrubbed of credentials in remote URLs.
- Branch deletion: only branches that this run created, by exact name.
- File deletion: exact paths only. Temporary worktrees are removed by their
  exact path.
- No script kills a process. A watcher stops itself.
- Every commit that a skill creates uses `--signoff`.
- Output never contains a token.

## 9. Agent support matrix

| Agent | Version | Manifest read | Load test | Evidence |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.325 | `.claude-plugin/plugin.json` | `claude --plugin-dir <dir>` | Section 12 |
| Codex | 0.169.0 | root `plugin.json` | `codex plugin marketplace add <dir>` | Section 12 |
| Grok Build | 1.0.70 | root `plugin.json` | `grok plugin validate`, trusted install | Section 12 |
| Muse Code | 1.4.20 | root `plugin.json` | `muse plugins validate`, `.agents/skills` | Section 12 |
| Kimi Code | 2.6.1 | `.kimi-plugin/plugin.json` | `kimi --skills-dir <dir>/skills` | Section 12 |
| omp | 18.20.2 | root `plugin.json`, `.agents/skills` | `omp skill list --json` | Section 12 |
| pi | 1.5.2 | skills only | `pi --skill <dir>` | Section 12 |
| Antigravity CLI | 1.5.9 | root `plugin.json` | `agy plugin validate <dir>` | Section 12 |

Installs that write to user configuration use a temporary home directory and are
removed after the test.

## 10. Delivery

Small pull requests, each with tests:

1. This design and the research note.
2. Foundation: Bun and TypeScript setup, process layer with safety rules, policy
   loader, schema, validator, example policy, the generic name test, and CI.
3. `pr-status`: gather, git facts, evaluate, render, fixtures.
4. `pr-threads`.
5. `pr-refresh` with the DCO fix.
6. `pr-create`.
7. `pr-merge`.
8. `pr-fleet`, removal of the replaced skills, documents, version 0.5.0. This
   step also updates every "seven skills" count, the skill lists in `README.md`
   and `docs/`, and each link to an old skill id in the kept skills.

Fixtures come from real PR states, anonymized: unresolved bot threads, stale
approval, ejected queue entry, stacked PR, unsigned bot commits.

Each skill passes four reviews before it merges: a prompt audit, an independent
best-practice audit against the research, a code review of its scripts, and a
behavioral check by a fresh agent that has only the SKILL.md and a fixture. The
review results go into PR comments. They are not committed, so the rule against
evaluation content in `docs/maintenance.md` stays true for the repository.

Validation: `pr-status` runs read-only over all open PRs of a real repository. A
table compares each verdict with the observed state. Each miss becomes a fixture
and a fix.

## 11. Design review

An independent Opus 5.5 reviewer found 7 must-fix, 12 should-fix, and 5 nit
items. This version applies all must-fix items, all should-fix items, and three
nits (`mergeable == UNKNOWN` is a wait, `stacked` needs a parent PR, the default
branch comes from GitHub). Kept against the review: the four reviews per skill
(an owner requirement) and `inventories.group_depth` (a real inventory rule
needs it). `ci.single_push` and `fleet.priority_labels` are removed.

## 12. Evidence

Filled in by the delivery pull requests.
