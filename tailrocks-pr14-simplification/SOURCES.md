# Source references and use of this pack

Observation date: 2026-10-06.

Paste `GOAL.md` into the Muse session for PR #14.
Use `CHANGE_PLAN.md` and `REVIEW_CHECKLIST.md` as design references.
Do not install this pack as a skill package or copy its work reports into the released skills.
The prompt is self-contained. The references explain its decisions.

## Evidence scope

The review inspected PR metadata and change information, every public skill entrypoint, all five local review references, the runtime inventory, the README, the native adapter, and the generated-file rules at the pinned head below.
It also compared the named external review sources and official CLI documentation.
It did not run the branch, execute its custom helpers, install the seven clients, or perform a hosted merge.
A source or design finding is not a claim of runtime verification.

## Repository revision

- [PR #14](https://github.com/tailrocks/tailrocks-repository-skills/pull/14).
- [Reviewed head `382cfb84b0852bc2cba312269d0037ada1b86508`](https://github.com/tailrocks/tailrocks-repository-skills/tree/382cfb84b0852bc2cba312269d0037ada1b86508).
- [Base `036063edc58d88cd88f57e4e3a9721ebadf3ad62`](https://github.com/tailrocks/tailrocks-repository-skills/tree/036063edc58d88cd88f57e4e3a9721ebadf3ad62).

## Current skills

- [`tailrocks-pr-template`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-pr-template/SKILL.md).
- [`tailrocks-create-pr`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-create-pr/SKILL.md).
- [`tailrocks-refresh-pr`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-refresh-pr/SKILL.md).
- [`tailrocks-review-pr`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-review-pr/SKILL.md).
- [`tailrocks-merge-pr`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-merge-pr/SKILL.md).
- [`tailrocks-repository-merge`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-repository-merge/SKILL.md).
- [`tailrocks-repository-audit`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-repository-audit/SKILL.md).
- [`tailrocks-repository-plan`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-repository-plan/SKILL.md).
- [`tailrocks-repository-consolidate`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-repository-consolidate/SKILL.md).
- [`tailrocks-document`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-document/SKILL.md).
- [`tailrocks-repository-cleanup`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-repository-cleanup/SKILL.md).

## Local review references

- [`finding-bar.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-review-pr/references/finding-bar.md).
- [`structural-review.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-review-pr/references/structural-review.md).
- [`specialist-lanes.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-review-pr/references/specialist-lanes.md).
- [`reporting.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-review-pr/references/reporting.md).
- [`runtime-trust.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/skills/tailrocks-review-pr/references/runtime-trust.md).

## Runtime and packaging

- [`scripts`](https://github.com/tailrocks/tailrocks-repository-skills/tree/382cfb84b0852bc2cba312269d0037ada1b86508/scripts).
- [`README.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/README.md).
- [`index.ts`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/index.ts).
- [`catalog.json`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/catalog.json).
- [`docs/client-invocation.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/docs/client-invocation.md).
- [`.github/AGENTS.md`](https://github.com/tailrocks/tailrocks-repository-skills/blob/382cfb84b0852bc2cba312269d0037ada1b86508/.github/AGENTS.md).
- [Pinned script tree with byte sizes](https://api.github.com/repos/tailrocks/tailrocks-repository-skills/git/trees/585096dadb71684e459dd71d67fce2d1bdf86ace).

The eleven script sizes sum to 259,586 bytes.
This is a source-file size measure, not a runtime memory measure or a line count.
It includes inherited runtime code as well as code changed by PR #14.

## External review sources

- [Cursor: Thermo-Nuclear Code Quality Review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md). Used for structural simplification, useful boundaries, and canonical code reuse. The retrieved reference used `main`; recheck it during implementation.
- [jnsahaj: Zero Tech Debt](https://github.com/jnsahaj/skills/blob/170b0b9192842559d1628c85e8bfe53c1bab61eb/skills/zero-tech-debt/SKILL.md). Used for end-state design and removal of unused compatibility mechanisms.
- [jnsahaj: Code Refactor Review](https://github.com/jnsahaj/skills/blob/170b0b9192842559d1628c85e8bfe53c1bab61eb/skills/code-refactor-review/SKILL.md). Used for repository search, composition, domain ownership, and proportional abstraction.
- [Google: What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html). Used to balance maintainability with design, functionality, tests, comments, and documentation.

These sources are references, not external runtime dependencies.
The proposed checklist combines principles in new wording.
It does not adopt numeric file-size limits or assume that every abstraction needs another abstraction.

## Official commands and writing reference

- [`gh pr create`](https://cli.github.com/manual/gh_pr_create): explicit head/base, body file, and the warning that `--dry-run` may still push Git changes.
- [`gh pr edit`](https://cli.github.com/manual/gh_pr_edit): direct title/body updates.
- [`gh pr merge`](https://cli.github.com/manual/gh_pr_merge): squash, head matching, and native queue behavior.
- [`gh pr checks`](https://cli.github.com/manual/gh_pr_checks): required-check queries and pending state.
- [`gh api`](https://cli.github.com/manual/gh_api): native API access and complete pagination.
- [GitHub: Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue): the server queue has a configurable merge method.
- [ASD-STE100 official site](https://www.asd-ste100.org/): Simplified Technical English reference and official issue information.

The CLI documentation is current documentation, not a test of the user's installed binary.
Verify installed help before relying on a changed flag or capability.
A head guard is not an atomic guard on a caller-selected target SHA.
A CLI strategy flag is not evidence that a required server queue is configured for squash.
