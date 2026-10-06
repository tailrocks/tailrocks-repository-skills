# PR #14: simplification plan

## Reviewed revision

Repository: `tailrocks/tailrocks-repository-skills`.
PR: `14`.
Branch: `impl/upgrade-audit-plan-consolidate`.
Head: `382cfb84b0852bc2cba312269d0037ada1b86508`.
Base: `036063edc58d88cd88f57e4e3a9721ebadf3ad62`.
Observation date: 2026-10-06.

The PR metadata reports 50 commits, 52 changed files, 3,170 additions, and 792 deletions.
These values describe the observed revision, not future changes.
See [the primary sources](SOURCES.md).

This is a source and design review. It covers every public skill entrypoint, all five local review references, the runtime inventory, packaging surfaces, and generated-file rules. It does not certify every runtime script line or a live CLI execution. No repository was changed during this review.

## Decision

Reduce eleven public skills to six. Remove the custom GitHub workflow runtime.
Keep analysis before integration, strict review, complete source accounting, and remote-result checks.
Do not keep a mechanism merely because it appeared in the earlier upgrade plan.

## Public skill changes

| Current skill | Action | Result |
| --- | --- | --- |
| `tailrocks-pr-template` | REWRITE | Direct creation or update of `.github/PULL_REQUEST_TEMPLATE.md`. No path resolver or publication receipt. |
| `tailrocks-create-pr` | REWRITE | Normal Git push and `gh pr create`. Reuse a suitable PR. Support a pushed branch with no PR. |
| `tailrocks-refresh-pr` | REWRITE | Compare current metadata with the diff and canonical template. Use `gh pr edit`. No local-HEAD requirement for a metadata-only operation. |
| `tailrocks-review-pr` | REWRITE | One strict review workflow. Combine correctness, structure, reuse, tests, security, documentation, and group coverage. |
| `tailrocks-merge-pr` | REWRITE | Review the exact current candidate, check requirements, and call `gh pr merge --squash --match-head-commit`. |
| `tailrocks-repository-merge` | REWRITE | One workflow for selected sources or all in-scope work. Audit, group, integrate, review, squash, refresh, and repeat. |
| `tailrocks-repository-audit` | COMBINE, then DELETE | Keep its useful source comparison in the grouped workflow. Retain an audit-only request boundary. |
| `tailrocks-repository-plan` | COMBINE, then DELETE | Keep grouping and dependency decisions in the same workflow and report. |
| `tailrocks-repository-consolidate` | COMBINE, then DELETE | Keep candidate preparation and coverage checks in the grouped workflow. |
| `tailrocks-document` | COMBINE, then DELETE | Check actual documentation in review. Use normal implementation commits for required corrections. |
| `tailrocks-repository-cleanup` | DELETE | Retain original sources by default. Machine-wide recovery and deletion are outside this package's required purpose. |

## Concrete problems and replacements

### A. Too much code around native GitHub operations

The `scripts/` tree contains eleven TypeScript files, with a combined size of 259,586 bytes. That is about 260 kB of custom runtime code. The sizes come from the pinned Git tree, not estimates of executed code.

| Script | Bytes | Replacement |
| --- | ---: | --- |
| `create-pr.ts` | 57,131 | Normal push, PR lookup, and `gh pr create`. |
| `merge-preflight.ts` | 60,225 | Native PR/check/rule queries and concise review steps. |
| `merge-pr-core.ts` | 41,181 | Native squash merge with a reviewed-head guard. |
| `merge-pr.ts` | 2,669 | No custom merge entrypoint. |
| `post-pr-review.ts` | 34,131 | `gh pr review` only when posting is requested. |
| `pr-template-target-core.ts` | 16,943 | The fixed canonical template path. |
| `pr-template-target.ts` | 3,159 | Direct file editing through the permitted tool. |
| `atomic-file-transaction.ts` | 17,189 | No package-specific file transaction layer. |
| `bounded-command.ts` | 15,729 | Existing runtime permissions, isolation, and bounded commands. |
| `documentation-discovery.ts` | 10,325 | Read the changed behavior and its relevant documentation. |
| `resolve-executable.ts` | 904 | Standard installed Git and `gh` commands. |

Some of this runtime predates PR #14. The recommendation is to remove it from the resulting branch, not to attribute all of it to this PR.

Remove the associated schemas, field digests, gate-unit proofs, authority tokens, and custom result formats. Do not hide them in another language or in long shell functions. A readable action result and the observed remote state are sufficient for the normal workflow.

Keep real safety checks: repository identity, intended head/base, permissions, required checks, reviewed changes, safe argument handling, and inspection after uncertain outcomes.

### B. Template discovery contradicts the required single path

`tailrocks-pr-template` currently preserves any sole supported GitHub template location. It invokes a resolver and publication transaction. Other lifecycle skills permit `.tailrocks/pr.md`, body generators, and fallback content.

Replace these branches with one rule: `.github/PULL_REQUEST_TEMPLATE.md` is the only PR template. Missing means create it when edits are authorized, or report the missing file. Missing never means search another path.

The PR template is a human-readable content source. It is not a replacement for CI configuration, repository instructions, CODEOWNERS, or GitHub rules. Do not move the removed `.tailrocks/pr.md` configuration language into the template.

Remove obsolete sample files named `PULL_REQUEST_TEMPLATE.md` outside the canonical location when they belong to this package. Keep any necessary writing advice in the template skill itself. Do not delete other repositories' unsupported files without permission.

### C. Metadata refresh is tied to an unnecessary local checkout

`tailrocks-refresh-pr` requires a strict HTTPS remote binding, matching local HEAD, a fetched base, and repeated identity/digest checks. It then edits title and body as separate operations.

A metadata-only change can read the PR and its diff through `gh`. Read the canonical template from the same selected head. Compare the observed state before editing. Use one `gh pr edit` invocation when both fields change. Verify the result afterward.

This reduces machinery. It does not create an atomic compare-and-swap guarantee. Report remote drift or uncertain responses rather than claiming a transaction.

### D. Merge policy exposes choices that the product no longer needs

`tailrocks-merge-pr` offers merge, squash, and rebase. It also offers a strict exact-base mode whose guarantee is unavailable through its ordinary merge route.

Remove these choices. Always request squash and the reviewed-head guard. Respect required reviews, checks, protection, and queues. Never use an administrator bypass or a direct target push.

A required queue needs special attention: its configured merge method must be squash. The CLI strategy flag is not proof that the queue will use that method. Report an unknown or incompatible queue configuration. Do not build a custom queue implementation.

### E. Phase protocols are larger than the task

The current public design separates audit, plan, candidate preparation, and coordination. It also has mandatory run-directory rules, audit revisions, plan revisions, separate reports, and a strict resume-state format.

Use ordered phases in one skill and one report. A report must contain source identity, functionality, grouping, dependencies, evidence, progress, and blockers. Recheck GitHub before continuing an interrupted run.

Source accounting remains mandatory. Complete pagination remains mandatory. Cryptographic report receipts and public skills for each internal phase do not.

Audit-only means no source, target, or remote mutation. Isolated evidence collection and a requested report are allowed. This removes the conflict between absolute no-file-write wording and the audit's later report/download instructions.

### F. Scope includes unrelated recovery and history work

Cleanup references cover clones, worktrees, stashes, ignored files, nested repositories, interrupted operations, LFS, shared object stores, and restore tests. The all-work inventory also reaches these recovery concerns.

The required product is branch-and-PR consolidation. Remove machine cleanup and lost-work recovery from it. Inventory current in-scope branches and open/draft PRs. Read closed or merged PR history when it explains those sources. Do not require full deep history for every ordinary run.

Retain sources when work is partial, uncertain, rejected, or needed for another target. A smaller runtime is not permission to delete data.

### G. Documentation correctness is replaced by a trailer rule

`tailrocks-document` requires a special descendant commit with `Tailrocks-Skill: tailrocks-document`. Preflight uses that historical marker as a gate.

Remove the marker and final-commit ordering rule. Verify that examples, APIs, setup instructions, and user-visible behavior are documented correctly. An arbitrary trailer cannot substitute for that review.

### H. The review policy contains conflicting and overly broad exclusions

`finding-bar.md` excludes pre-existing issues, linter findings, and explicitly waived issues. It says not to run a linter. The review skill and `reporting.md` also retain claims that hosted merges are always blocked, although the merge skill was rewritten.

Replace the exclusions with scope-aware, evidence-based review. Distinguish new defects from inherited defects. Existing in-scope blockers still matter in a whole-branch review. Run relevant checks without copying every cosmetic warning into the report. Examine waivers rather than treating them as proof.

Retain the useful structural principle: a finding must identify a concrete change and the complexity it removes. Remove mandatory numeric criticality scores, automatic file-size blockers, and specialist routing that does not help the current review.

Use [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) as the unified specification. It is input for a compact final skill, not text to copy wholesale into every skill.

### I. Packaging must stop preserving removed concepts

Update `catalog.json`, all client manifests, `agents/openai.yaml` files, `index.ts`, the README, and `docs/client-invocation.md`. Remove registrations for the five deleted skills.

`index.ts` currently registers Amp skills. It is a small native adapter, not a GitHub workflow executor. Keep a reduced version only when that client needs it. Do not add a generic adapter framework.

Remove Bun, fixed executable directories, and `sandbox-exec`/`bwrap` requirements that existed only for the deleted runtime. Use existing runtime isolation. Do not declare every client or operating system tested merely because a custom limitation was removed.

### J. Generated-file ownership needs a deliberate resolution

The branch's `.github/AGENTS.md` states that `.github/` is generated by Velnor Actions. Do not hand-edit generated CI or erase its instruction file to make a template change easy.

Check supported generator inputs and ownership first. Create the canonical template through the supported source path when available. Report an out-of-scope generator dependency when necessary. Do not add a competing template location or a copied CI workflow.

## Implementation order

1. Record current identities and a short keep/rewrite/combine/delete map.
2. Rewrite the template, create, refresh, and squash-merge procedures around native commands.
3. Combine review requirements and remove stale or conflicting policy.
4. Fold repository phases into one grouped workflow and one report.
5. Remove the eleven runtime scripts and all unused callers and references.
6. Update the six-skill package inventory and client instructions.
7. Resolve generated template ownership without changing generated CI by hand.
8. Verify the changed skill behavior, report untested remote cases, and obtain an independent review.
9. Commit, push, and refresh the existing PR. Leave it open.

## Completion evidence

The final report must show six public skill names, zero custom GitHub lifecycle executors, one supported template path, and squash-only PR merge instructions.

It must show that source scope is preserved, functionality is mapped before integration, combined candidates are reviewed, and the target is refreshed after every confirmed merge.

It must distinguish static checks, local fixture checks, native client checks, and live GitHub tests. Missing clients or a missing authorized test repository are limits, not passed tests. Keep unresolved acceptance items visible.
