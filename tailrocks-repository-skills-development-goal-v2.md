# Develop Tailrocks Repository Skills — Revision 2

Revision: 2026-09-23. This is the complete replacement development specification, incorporating configurable target branches, selected-source integration, and one convenient audit-and-merge entry point. It supersedes the earlier main-only/default-branch assumptions, not the recovery, review, CI, release, or authorization requirements. This document specifies a plugin to develop; it does not claim that its commands are already implemented or installed.

## 1. Goal and scope

Develop, test, document, register, and release one new independently installable Tailrocks plugin collection:

- Repository: `tailrocks/tailrocks-repository-skills`.
- Plugin identity: `tailrocks-repository-skills`.
- Display name: `Tailrocks Repository Skills`.
- Primary runtimes: Codex CLI and Claude Code.
- Canonical content: portable skills under `skills/`, with thin, validated runtime packaging.
- Flagship user-facing workflow: `repo-merge` (logical shorthand `/repo-merge`).
- Shared convergence owner: `tailrocks-repository-converge`; the facade composes existing responsibilities rather than duplicating them.
- Configurable destination: `--target-branch=<branch>`, with the literal branch name `main` as the default.

The collection owns source selection, branch-to-branch and PR-to-branch comparison, recovery, unfinished-work analysis, actual completion and landing, repository-wide consolidation, and safe cleanup for **one bound repository and one selected target branch per campaign**. It supports both narrowly selected sources and explicitly requested repository-wide work. It must work with arbitrary repositories and languages; Jackin is the initial research and read-only validation example, not a hardcoded target.

This goal is to **build and ship the plugin**, not to execute a real Jackin consolidation campaign. Do not merge, close, reset, delete, or otherwise change real Jackin PRs, branches, clones, or worktrees as a side effect of development. Use disposable local fixtures and explicitly designated test repositories for mutating acceptance tests. Development writes, commits, PRs, and releases belong to the new plugin repository; changes in `tailrocks/tailrocks-skills` are limited to registering and documenting this collection. Other reference repositories are read-only unless a separately authorized prerequisite requires a narrowly scoped contribution.

Create the repository if absent and the configured account has permission. Search for an existing repository, local clone, branch, PR, or partial implementation first; reuse and finish existing work rather than overwrite it or create a competing collection. Follow the verified Tailrocks license, visibility, naming, release, instruction, and packaging conventions. Do not create substitute repositories when the requested destination is inaccessible.

Do not stop after research, a design document, scaffolding, or opening a PR. Continue through implementation, tests, independent review, required CI, authorized merge, versioned release, registry integration, and fresh-install verification. Distinguish demonstrable external blockers from completion.

## 2. Research references and rules

Start by inspecting current default branches and recording immutable commit IDs and access dates. Historical findings below are starting points, not current-state assertions.

### Tailrocks references

- Organization collection discovery: https://github.com/tailrocks?q=skills&type=all&language=&sort=
- Umbrella directory: https://github.com/tailrocks/tailrocks-skills
- Authoring policy: https://github.com/tailrocks/tailrocks-skill-authoring-skills
- PR lifecycle ownership: https://github.com/tailrocks/tailrocks-pull-request-skills
- Delivery and reconciliation ownership: https://github.com/tailrocks/tailrocks-roadmap-skills
- Code-quality ownership: https://github.com/tailrocks/tailrocks-code-quality-skills
- Rust conventions when needed: https://github.com/tailrocks/tailrocks-rust-skills

Read relevant `AGENTS.md`, `CLAUDE.md`, skill definitions, responsibility-topology rules, testing doctrine, scaffolding policy, validators, manifests, marketplaces, catalogs, documentation generation, and release automation before choosing the layout.

The original development brief recorded these sibling artifacts on 2026-09-23: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, root `plugin.json`, `catalog.json`, and `skills/`. The umbrella README described independently installable collections. The inspected authoring skill required evidence before new skills, one skill authored/proven/wired at a time, and no per-skill eval trees. Verify these contracts afresh; do not resurrect older monolithic or per-skill-eval layouts from memory.

Use `tailrocks-skill-create`, `tailrocks-skill-audit`, and the other authoring-family skills only for their existing responsibilities and with their documented transaction boundaries. The outer coordinator owns commits, pushes, releases, and cross-repository registration; a narrow authoring invocation must not gain permissions its contract excludes.

Reuse current conventions, not known defects. Document and test any necessary departure. In particular, inspect each root/runtime manifest's actual schema: filenames shared by different plugin ecosystems do not imply interchangeable formats.

### Initial repository case study

- https://github.com/jackin-project/jackin/pulls
- Current Jackin instructions and relevant specifications/handoffs.
- Existing `plans/repository-consolidation/` inventories, recovery scripts, decision records, cleanup manifests, verification reports, and provenance mappings.

Read actual changes and authoritative requirements, not just PR titles or summaries. Look for partial extraction, successor chains, merged/squashed work, dirty snapshots, carried verification failures, and incomplete prior cleanup. Turn observed failures into sanitized, deterministic fixtures. Do not copy credentials, user-specific absolute paths, or personal agent session contents into the new public repository.

### Primary technical documentation

Verify installed versions against current official documentation, including:

- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/build/skills
- https://developers.openai.com/codex/skills/
- https://developers.openai.com/codex/cli/slash-commands
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/plugin-marketplaces
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/commands
- https://agentskills.io/specification
- https://git-scm.com/docs/git-worktree
- https://git-scm.com/docs/git-rev-parse
- https://git-scm.com/docs/git-bundle
- https://git-scm.com/docs/git-update-ref
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

Do not assume a universal `/goal` implementation, plugin loader, subagent API, permission field, or marketplace format. Test actual clients. Treat these URLs as discovery entry points and follow official redirects where necessary.

## 3. Autonomous execution and delegation

Work autonomously within authorized scope. Resolve technical ambiguity from repository evidence, official documentation, tests, and independent review instead of asking routine preference questions. Never turn missing permissions into assumed authorization. Record the exact blocked action, preserve state, and continue independent work when an external prerequisite is unavailable.

Use actual subagents aggressively throughout research, implementation, adversarial review, and verification. Do not merely describe imaginary delegation. Start parallel research tracks for:

1. Tailrocks ownership, plugin packaging, authoring contracts, and registry integration.
2. Host-wide discovery, Git identity, recovery, and cleanup safety.
3. Jackin's existing consolidation machinery, requirement reconstruction, and source provenance.
4. Codex/Claude execution, native invocation, agent permissions, interruption, and resumption.
5. Deterministic tests, real-agent acceptance evidence, CI, release, and independent safety review.
6. Source-selector parsing, non-main target semantics, PR-base/provenance handling, branch-policy discovery, and target-aware cleanup.

Each track must return sources, observed behavior, uncertainty, recommended decisions, and executable checks. Parallelize research and independent helper modules; honor the authoring policy's one-proven-skill-at-a-time boundary. Use one coordinator for shared state, integration, merges, and deletion. Never permit simultaneous writers to the same index or mutable worktree.

Honor explicit model/effort settings supplied by the operator. Verify runtime support and record actual settings; do not hardcode vendor model IDs into portable skills or claim a requested configuration was used when it was not. Reuse/close completed agent sessions to avoid exhausting concurrency limits. Bound compilation and test concurrency independently of research concurrency.

Commit meaningful, verified changes frequently and push regularly. Prefer one implementation branch per repository; use temporary isolated worktrees only when safe parallel work requires them. Synchronize shared branches by merging the appropriate configured target branch rather than rewriting shared history. For development of this plugin itself, honor its verified integration-branch policy; do not assume that policy sets the destinations of future user campaigns. Do not create chains of replacement branches merely to escape conflicts or review feedback. Preserve attribution and independently verify every integration.

Judge changes by correctness, consistency, specification fit, and the user's goal—not ROI, effort, or whether fixing a known-wrong state seems worthwhile. Prefer architectural fixes that remove a failure class. Do not mask errors, weaken tests, disable protection, or declare unavailable evidence to be passing evidence.

## 4. Product boundary and initial skill collection

One repository and one logical plugin must contain the related skills. Runtime-specific manifests are adapters for that same product, not separate collections. Do not place this collection inside Jackin or turn the umbrella directory back into a monolithic source tree.

Establish a responsibility map before authoring:

- `repo-merge`: the convenient user-facing facade. Normalize selectors and options, bind one repository/target/scope, and compose audit, convergence, existing PR-lifecycle skills, and eligible cleanup through one durable campaign. Its default is execution through verified landing, not merely an audit report or prepared PR. `--audit-only` selects the non-mutating path. Keep this facade thin and do not create a second convergence engine.
- `tailrocks-repository-audit`: source-read-only discovery and comparison of selected sources, or explicitly requested repository-wide work, against the configured target branch. Produce coverage, inventory, work-item mapping, improvement/rejection decisions, outstanding obligations, and a convergence plan. It may write evidence to an explicit state directory, but must not mutate source repositories or remote state.
- `tailrocks-repository-converge`: the shared completion-and-landing owner, usable directly or through `repo-merge`. Preserve sources, reconcile target-specific requirements, finish accepted work, coordinate review/CI/landing into the selected target, verify that target, and invoke evidence-gated cleanup where authorized. Accept an existing audit receipt only after revalidating its exact repository, source set, target, and identities. Support resume and repeated discovery without unnecessarily auditing everything twice.
- `tailrocks-repository-cleanup`: independently callable cleanup of already resolved, explicitly scoped sources. Revalidate preservation, authorization, current identities, target-specific landing evidence, other destination obligations, and dependencies. It must refuse unfinished or unaccounted-for work, not silently expand into implementation or erase it.

These are the initial responsibility targets. The requested `repo-merge` facade is justified by the single-command user workflow; it must not duplicate phase policy or become a competing implementation owner. Do not create other duplicative routers. Check existing ownership; reuse an existing owner where appropriate and document the boundary. Recovery, comparison, snapshotting, monitoring, handoff, and verification should initially be shared helpers/resources or modes, not an automatic proliferation of one skill per phase. Add further public skills only for evidenced, distinct responsibilities.

Do not clone the PR lifecycle family. Compose with its existing create, refresh, review, documentation, and merge contracts. Repository consolidation owns cross-source requirements and completion; the PR family owns individual-PR mechanics. Likewise, reuse roadmap and code-quality responsibilities rather than rename them.

Resolve cross-plugin dependencies explicitly using supported mechanisms, pinned releases, verified resource loading, or a tested adapter. No assumed installation, fake dependency manifest fields, hidden sibling-checkout dependency, or mutable-main runtime download. Independently installable does not mean silently duplicating another collection's policy. Missing dependencies must be detected before mutation, with useful read-only behavior still available.


### 4.1 Public interaction contract

The following is the required logical command interface. The exact host-native invocation prefix must be implemented and tested as described in section 4.4; these examples are requirements, not claims that either client already provides a universal slash alias.

```text
/repo-merge [--repo=<owner/repo-or-url>] [--target-branch=<branch>] [--audit-only] [--cleanup=resolved|none] <source>...
/repo-merge [--repo=<owner/repo-or-url>] [--target-branch=<branch>] [--audit-only] [--cleanup=resolved|none] --all-work
/repo-merge --resume=<campaign-id>
```

Required examples:

```text
/repo-merge feature/auth-repair
/repo-merge --target-branch=main feature/auth-repair
/repo-merge --target-branch=release/next feature/auth-repair
/repo-merge --target-branch=integration feature/usage feature/auth
/repo-merge --target-branch=main #1145
/repo-merge --target-branch=main #1663 #157 #46
/repo-merge --target-branch=main https://github.com/jackin-project/jackin/pull/1103
/repo-merge --target-branch=release/next https://github.com/jackin-project/jackin/pull/1103
/repo-merge --target-branch=main https://github.com/jackin-project/jackin/pulls
/repo-merge --target-branch=integration https://github.com/jackin-project/jackin/branches/all
/repo-merge --repo=jackin-project/jackin --target-branch=main feature/auth #1145
/repo-merge --audit-only --target-branch=release/next feature/auth-repair
/repo-merge --cleanup=none --target-branch=main #1145
/repo-merge --repo=jackin-project/jackin --all-work
```

Interpretation must be directional and unambiguous: positional references are SOURCES; `--target-branch` is the DESTINATION. Thus `/repo-merge --target-branch=branch-b branch-a` compares branch-a with branch-b and lands only justified improvements into branch-b. Multiple positional branches do not specify source/target pairs; they all feed the one selected destination. Do not update main as an additional hidden step when the chosen target is not main.

Defaults and errors:

- Omitting `--target-branch` means exactly `main`, not current HEAD, a PR's existing base, the repository's advertised default branch, or a prior campaign's target. If main does not exist, report the missing target and valid candidates; never silently fall back, create it, or rewrite the request. An explicit target always wins. Resume restores its recorded target; a conflicting target override requires a new explicitly scoped campaign.
- `--audit-only` is false by default. A normal explicit merge invocation authorizes the selected implementation/landing workflow within existing permission controls; do not stop after a plan, report, patch, PR creation, enabling auto-merge, or queue submission. Actual landing and post-landing verification are required, or report the exact blocker.
- `--cleanup=resolved` is the documented default: only eligible selected-source resources and campaign-owned temporary resources may be cleaned after proof. `--cleanup=none` preserves original source branches/worktrees/clones and suppresses destructive source cleanup; disposition evidence must still be recorded. Clone-wide cleanup requires proof for ALL contents and refs, not just the selected branch. Default cleanup never authorizes repository-wide sweeping after a single-PR command.
- No selectors and no `--all-work` means show usage without mutation, not 'merge everything' and not 'merge the current branch'. `--all-work` is explicit and mutually exclusive with source selectors. `--resume` resumes an existing campaign rather than implicitly creating a new source set.
- Accept both `--target-branch=name` and `--target-branch name`; reject unknown options, contradictory destinations, unsupported selectors, invalid refs, and unresolved ambiguous branch identities before source mutation. Source equal to target is a recorded no-op and cannot become a cleanup candidate.
- Support an explicitly documented `--local-only` branch-to-branch execution mode for existing local target branches where requested. Keep its verified-local result distinct from remote landing and remote CI evidence. Never silently use local-only mode to evade remote checks, and never publish a local-only target without authorization. Default connected-repository operation must verify remote landing; a missing remote target must not silently trigger creation or local-only success.

### 4.2 Source selectors, repository resolution, and scope

Accept a mixed list of the following selectors within ONE bound repository:

| Selector | Required behavior |
|---|---|
| `feature/auth-repair` | Resolve a source branch in the chosen repository; detect divergent same-name refs across relevant clones/remotes. |
| `refs/heads/feature/auth-repair`, `origin/feature/auth-repair` | Support documented local/full-ref or remote-qualified branch resolution; do not guess between conflicting matches. |
| `#1145`, `1145`, `pr:1145` | Resolve an actual PR by number in the bound repository, not a similarly numbered issue. Support `branch:1145` for a numeric branch name. |
| `https://github.com/OWNER/REPO/pull/NUMBER` | Bind the canonical base repository and PR identity; retrieve current head, original base, state, reviews, and provenance. |
| `https://github.com/OWNER/REPO/pulls` | Select all currently open PRs, including drafts, in that repository; paginate completely and freeze the resulting membership with a timestamp. A draft is unfinished work to inspect, not permission to bypass readiness requirements. |
| `https://github.com/OWNER/REPO/branches/all` | Select all current canonical-repository remote branch heads except the destination; enumerate via supported APIs/Git rather than scraping only one visible HTML page. Preserve protected/maintenance sources unless separately eligible for cleanup. |
| `--all-work` | Explicit repository-wide discovery and convergence: remote and local-only work across accessible clones/worktrees, refs, relevant PR lineage, dirty state, stashes, and recovery candidates. |

For repository listing URLs, preserve meaningful filters where supported and show the resolved set. Reject unsupported semantic filters instead of silently widening to 'all'. Presentation-only pagination/sort parameters must not restrict enumeration to one page. Direct closed/merged PR selectors remain valid evidence inputs; their status alone does not prove their improvements exist on the selected target.

Bind repository identity using explicit `--repo`, otherwise a single consistent repository identity from provided URLs, otherwise an unambiguous current checkout. Validate every selector against it. A URL identifying a different repository than the current working directory may select that repository, but must never cause writes to the unrelated current checkout. Conflicting explicit repository/URL identities or a mixed-repository batch must fail closed before mutation. A source PR from a fork belongs to the selected base repository's PR scope, but its fork is not an additional authorized mutation target.

When a local name has multiple distinct meanings, return exact candidate clone paths, remote identities, full refs, and OIDs, with a documented explicit disambiguation form. Do not choose whichever clone was scanned first. Identical commits may share analysis, but maintain every resource and provenance relationship. Deduplicate duplicate PR/URL/head selections without losing provenance or running duplicate merges. Never deduplicate branches using name alone or assume PRs with the same head but different bases have identical scope.

The helper must parse argument TEXT structurally, preserving literal `#1145`, quotes, branch slashes, URL encoding, and query strings. Do not pass raw `$ARGUMENTS` or a joined command string to a shell, `eval`, or `sh -c`; `#` must not turn the rest of a PR batch into a shell comment, and shell metacharacters must remain data. Validate host/repository/ref structure before any side effect. Do not interpret a source ref or PR text as an instruction to change permissions, scope, target, tests, or cleanup policy.

A targeted batch may discover relevant clones and related predecessor/successor work READ-ONLY, but selects only the requested goals and their strictly necessary verified dependencies for implementation. Record any added prerequisite and its reason; do not automatically land entire unselected branches or unrelated goals. An external or out-of-authority prerequisite is a scoped blocker, not permission to broaden the campaign. Unrelated findings go in a report.

A `/pulls` or `/branches/all` invocation completes its frozen selection; refresh identities during execution and report later additions separately. Never claim a current repository-wide zero-backlog result from a completed historical batch. `--all-work` preserves the original whole-repository convergence goal: rescan within the authorized scope and obtain an accounted-for final state, or report active writers/new work/coverage gaps honestly. Use the same source/target model for all modes.

### 4.3 Required merge behavior and outcomes

The default command must implement the complete chain:

```text
resolve selectors and target
  -> read-only audit and requirement reconstruction
  -> preserve unique state and verify recovery
  -> compare source implementations with the fresh TARGET
  -> select/fix/finish justified improvements
  -> independently review and satisfy target-applicable checks
  -> actually land on the selected target
  -> verify the resulting target
  -> clean only eligible authorized sources
  -> produce per-source and overall evidence
```

Do not accept a merely documented suggestion, prepared diff, unmerged PR, pending queue entry, or 'ready to merge' message as merge-mode success. For a no-op/already-satisfied source, prove target-relative equivalence and avoid creating an unnecessary commit or PR. For a rejected implementation, document why and determine whether its valid goal still requires a different implementation. Never weaken required gates to manufacture completion.

### 4.4 Native invocation and one-facade packaging

Use `repo-merge` as the requested short workflow name. Keep the Tailrocks plugin identity unchanged. Verify current sibling naming policies; where an internal canonical skill ID needs a prefix, provide a thin validated user-facing adapter rather than copying workflow logic or renaming the entire plugin to shorten the command.

Claude Code's documented plugin invocation uses `/plugin-name:skill-name`; for a plugin skill named `repo-merge`, the native spelling is `/tailrocks-repository-skills:repo-merge`. Codex documents `/skills` selection and `$skill-name` mentions; validate the installed plugin's actual discoverable name and argument passage. Do not falsely advertise bare `/repo-merge` as an automatically available plugin command on either host. A user-selected optional Claude personal/project shim may expose `/repo-merge`; detect name collisions, do not overwrite unrelated skills, make installation/removal explicit, and keep it a delegating shim. Do not require such a shim for the namespaced plugin to work.

Document the logical interface, actual native commands, and invocation from each client's `/goal` separately. Prove that all parameters and literal PR references reach the same normalized request through every advertised route. Do not implement a conflicting `/goal` command or assume nested slash text automatically invokes a skill. Selecting the facade under a goal must load the required phase skills with existing authorization boundaries, not unlock blanket shell permission. The user should not have to manually invoke every phase or remember different source/target flags for different skills.

Reference checks performed for this specification revision (reverify when implementing):

- Claude plugin namespacing and arguments: https://code.claude.com/docs/en/plugins
- Claude `$ARGUMENTS` handling and invocation controls: https://code.claude.com/docs/en/skills
- Codex explicit `$`/`/skills` invocation: https://developers.openai.com/codex/skills/
- Codex `/goal` and its documented objective-length limit: https://developers.openai.com/codex/cli/slash-commands

## 5. Required convergence behavior

### 5.1 Bind one repository, selected target branch, scope, and authority

Resolve the repository and selectors according to section 4.2. Bind canonical host/repository identity, selected target ref (`main` only as the default argument value), authoritative target remote or explicit local-only identity, initial target OID, source-set/scope manifest, canonical working location, scan roots/volume scope, recovery/state location, and permitted actions. Record the repository's advertised default branch separately as metadata; it must not override the selected target.

Bind the target's current specification, branch policies, required checks, generated-file contracts, and review requirements. Do not reuse a `main` policy/CI receipt for a non-main target without proving applicability. Re-resolve target identity and policies before landing; stale or deleted targets invalidate the prepared operation. For any explicit non-main target, main is out of mutation scope unless a separately authorized operation selects it.

One campaign may discover many locations but may mutate only its selected repository and approved campaign-owned resources. Never recurse into an organization-wide cleanup. Preserve explicit maintenance/release branches, tags, other owners' forks, unrelated nested repositories, and provider-managed PR refs. Record exceptions honestly.

Audit/monitor selection is not mutation authorization. An explicit `repo-merge` merge-mode or convergence invocation authorizes only its documented selected-source/selected-target action set and cleanup policy, without repetitive routine questions. It must still obey host permissions, repository protections, fresh-state checks, dependency boundaries, and all cleanup preconditions. Do not downgrade a merge request into audit-only execution to avoid completing it.

### 5.2 Discover the complete accessible work surface

Apply scope-aware filesystem discovery plus Git relationship expansion; do not search only directory names or the current clone's registered worktrees. Whole-host related-work discovery belongs to `--all-work` or an explicitly requested comprehensive audit. Targeted mode must find relevant copies/provenance and record coverage but does not require resolving every unrelated work item before its selected merge can finish. Discover independent clones, linked/relocated worktrees, `.git` directories and pointer files, bare repositories, nested candidates, detached heads, nonstandard remotes, fork relationships, and relevant agent-created copies across permitted local storage.

Treat repository identity, common Git directory, clone identity, worktree identity, and branch identity as distinct. Same-name branches in different clones can diverge. Deduplicate shared object databases without losing worktree-specific indexes or changes.

Inventory all relevant local refs and all configured remote heads, open/draft PRs, closed-unmerged predecessors, merged PRs needed for equivalence, stashes, reflog-reachable work, recoverable otherwise-unreferenced objects, staged/unstaged changes, untracked files, potentially valuable ignored files, and interrupted Git operations. Account for shallow/partial clones, missing objects, alternates, submodules, LFS content, linked storage, and incomplete API pagination. Do not treat a truncated response as a complete inventory.

Prefer structured/NUL-safe Git output, byte-safe path handling, explicit exit-status checks, and resolved Git paths. Record permission-denied roots, exclusions, unavailable mounts, discovery timestamps, unresolved identities, and coverage gaps. Never claim whole-host coverage from a partial scan. Potential source copies without Git metadata may be analyzed but similarity alone cannot authorize deletion.

No initial prune, GC, reset, clean, checkout, stash drop, or source-mutating fetch during read-only audit. Fetch needed evidence into campaign-owned storage. Do not let optional index refresh, hooks, filters, external diff tools, or project code turn read-only inspection into unexpected execution.

### 5.3 Preserve and prove recoverability

Before any mutation that could lose source work, capture the relevant referenced and recovered Git objects, local refs/HEADs, staged and unstaged state separately, untracked and nonreproducible ignored content, file modes, symlinks, necessary metadata, interrupted-operation state, and external object/LFS/submodule dependencies.

A bundle alone is not a full working-copy backup. Store durable recovery material outside every deletion candidate. Do not rely on the user's shared stash as a transaction scratchpad. Build complete snapshots before publishing ownership or clearing anything. Validate inventories and checksums, then restore into disposable locations and verify required history and filesystem state, including staged/unstaged distinction.

Never assume all ignored files are expendable. Classify regenerable build products separately from user data, credentials, local configuration, and unpublished work. Preserve sensitive data securely and locally; exclude its contents from reports, prompts, telemetry, Git commits, and remote uploads. Redact credentials embedded in remote URLs.

Unrecoverable, corrupt, incomplete, actively changing, or insufficiently understood sources must remain undeleted and explicitly blocked.

### 5.4 Analyze goals, not branch counts

Create stable work-item identities connecting original requirements, specifications, design decisions, PR discussion, source commits, clones/worktrees, dirty snapshots, successors, and actual implementations on the fresh selected TARGET branch. Never substitute main for an explicitly configured destination.

Use ancestry, patch equivalence, series comparison, source-level analysis, tests, and explicit source-to-landed provenance together. Neither ancestry nor patch IDs alone prove current behavior. Recognize squash/cherry-pick merges, partial adaptations, predecessor/successor chains, duplicated patches, reverts, target-branch improvements, and accepted goals with rejected implementations.

For each work item record original objective, authoritative evidence, selected target repository/ref and baseline SHA, candidate/source SHAs or snapshot hashes, original PR base and merge-base evidence, target behavior, candidate behavior, dependencies, remaining obligations, disposition, reviewer, and acceptance tests.

Supported dispositions must distinguish already satisfied, accept and finish, accept partially, reimplement the valid goal, superseded with evidence, rejected/withdrawn with evidence, and blocked. A defective implementation may be rejected while its still-valid goal remains open. Do not eliminate valid work because it is old, expensive, half-finished, conflicting, or difficult. Do not use archival as completion.

Build a dependency graph and land coherent improvements in a safe order. Among otherwise equivalent ready items, prefer older abandoned work first; dependency, correctness, and safety constraints take precedence over age. Preserve behavior already improved on the selected target; do not blindly replay stale generated files or whole branches. 'Better' means justified improvement against the target's valid requirements, correctness, security, functionality, architecture, and demonstrated relevant performance, with appropriate regression checks—not newer timestamps, bigger diffs, or a preference for source code.

For cross-branch integration, separate three facts: the originating PR's base/intent, the source's changes/history, and the current destination's state. A feature branch based on a much newer main must not drag all unrelated main work into a release target merely because those commits are ancestors of its head. Use the original change scope plus current-target semantic analysis to select the minimal coherent improvement. Conversely, do not drop real required dependencies simply to keep the diff small. Record a scope/dependency decision for each adaptation.

Comparisons are target-relative and time-bound. A change already on main can still be missing from release/next; a change on release/next can still be missing from main. A previous 'landed' or 'already satisfied' decision for another branch is not reusable as proof. Recompute affected decisions after each target advance and verify the combined result of a multi-source batch, not just each source in isolation.

### 5.5 Finish, review, and land

Parallelize disjoint implementation and independent review; serialize integration and remote side effects into the configured target. Per-target leases must coexist with shared repository/ref/clone cleanup locks, so campaigns targeting different branches cannot delete one another's resources. Prefer the appropriate existing branch/PR when viable. Merge complete coherent improvements, cherry-pick/adapt only justified subsets, or reimplement legitimate goals when the original code is inferior. Record exact provenance and attribution.

For a source PR already targeting the selected branch, reuse it when the complete intended scope is sound. For a PR targeting another branch, or a PR from which only a subset is accepted, preserve the original PR and its existing destination obligations. By default create/reuse a narrowly scoped adaptation PR INTO the requested target, with source links and new target-applicable checks/review. Do not silently retarget or close the original PR, claim it was merged, or delete its branch merely because a subset landed elsewhere. A full source merge into a different target likewise does not discharge other still-valid obligations. Avoid successor-PR proliferation when an appropriate integration PR already exists.

Use the selected target's permitted merge strategy; do not confuse 'land improvements' with requiring a Git merge commit. A squash-only target still requires normal squash landing; safe cherry-pick/adaptation is allowed with provenance. Never force-push the target or bypass PR-only branch protections. A non-main target with no applicable hosted CI trigger requires an explicit validation/landing contract, not borrowed green checks from a PR against main.

Derive repository- and target-specific validation from current instructions and authoritative configuration, not a Rust-only hardcoded command list. Include relevant formatting, lint, unit/integration/system tests, generated-state validation, platform/visual checks, and operational evidence. Compare baseline failures accurately, but do not waive required checks simply because failures predate the change.

Read all PR review submissions, comments, replies, unresolved and outdated threads. Address accepted feedback with verified fixes and fixing-commit references; respond to rejected feedback with evidence before resolution. Re-fetch feedback at the final candidate head. Respect required approvals, merge queues, checks, and applicable release/deployment gates. A subagent's review is not a substitute for a legally or technically required human approval.

Bind results to exact source/base/candidate SHAs, runtime/configuration identities, CI workflow/run/attempt IDs, and timestamps. Distinguish local checks from live CI, successful tests from zero-test invocations, skipped/missing checks from applicable satisfied gates, and queued merges from completed merges. Reassess when heads, policies, or reviews change.

After merge, confirm actual remote landing on the exact selected target and verify its resulting tree and required checks. In explicit local-only mode, verify the exact local target and label the result local-only without claiming remote delivery or CI. Repair post-merge regressions before related cleanup. Use a declared bounded post-merge acceptance contract; the plugin is not an endless production monitoring service.

### 5.6 Clean up transactionally

Cleanup requires a machine-checkable receipt for each exact branch/ref/worktree/clone, including repository identity, selected target ref and verified target commit, expected current source ref/object or snapshot identity, target-specific requirement dispositions, verified landing/equivalence, other outstanding PR/destination obligations, recovery proof, authorization, ownership/quiescence, and dependent-resource checks.

Before each destructive action revalidate all preconditions. Use compare-and-swap/ref leases or equivalent supported conditional updates; do not confuse an earlier identity check with an atomic operation. For filesystem deletion obtain exclusive ownership or a safe quarantine/transaction strategy and prove it; if a writer cannot be excluded, retain the source. A private plugin lock does not stop unrelated agents or Git clients.

Never delete active worktrees, the canonical checkout, a common object store still used elsewhere, another owner's fork branch, or nested unrelated/user data. Do not kill unrelated agents. Do not force-reset user work to make cleanup easier. Do not use broad `rm -rf`, `git clean -fdx`, unconditional ref deletion, global stash clearing, wildcard branch deletion, or blanket trust bypasses as substitutes for ownership and evidence.

Completion and cleanup are scope-specific:

- A targeted branch/PR batch is complete when every selected accepted goal is verified on the configured target, rejected/no-op decisions are justified, required checks have passed, and eligible requested cleanup is accounted for. Unselected refs, PRs, worktrees, clones, and target-external obligations remain untouched. A complete batch must not be labeled a whole-repository consolidation.
- A `--all-work --target-branch=main` campaign retains the original desired end state: one clean canonical checkout synchronized with verified remote main, no redundant authorized working clones/worktrees/topic branches, no in-scope unfinished work, and protected recovery archives with explicit retention and legitimate exceptions.
- For `--all-work` into a non-main target, convergence is to that target. Preserve main, protected maintenance/release branches, and sources still required elsewhere. Do not convert the repository's default branch, delete main, or claim full integration to main. Keep a verified canonical target working location without discarding a user's unrelated dirty checkout or pretending legitimate retained resources are absent.

'No clones' means no duplicate working clones eligible for the selected campaign, not deleting the final useful checkout. Source deletion is never justified solely by a selected subset having landed. Close genuinely superseded PRs only after all their obligations are accounted for, with evidence/provenance rather than presenting them as merged. Report eligible cleanup completed, deliberately disabled cleanup, and safety-blocked retention distinctly.

Rescan local and remote state after cleanup. New or changed work invalidates the relevant prior decisions and re-enters analysis. Do not claim a stable final state while unknown writers or unresolved coverage gaps remain.

## 6. Implementation and packaging requirements

Build lean portable `SKILL.md` routers, the requested `repo-merge` facade, progressive-disclosure references, the normalized selector/target argument contract, prerequisite checks, examples, templates, and machine-readable schemas. Route every entry point through the same target-aware state and operation model; do not introduce main-only shortcuts in helpers, reports, tests, or cleanup. Keep implementation details out of trigger descriptions. Load references explicitly at decision points; verify relative resource resolution from installed plugin paths.

Separate model judgment from deterministic mechanics. Prefer a small Rust helper for identity, discovery, snapshots, transactional state, reference handling, journaling, and cleanup gates. Reuse sound existing Tailrocks components rather than introduce a second framework. Bun/TypeScript is acceptable for proven Tailrocks validation/catalog tooling; shell should remain thin. No Python tooling or glue. Do not build a daemon, vector database, web UI, hosted service, or MCP server unless a demonstrated required capability cannot be delivered by the existing local plugin/tool surface.

Ship the helper in a documented, reproducible, integrity-checked way that works from an installed plugin on macOS and Linux. Avoid hidden sibling paths, working-directory assumptions, write access to the plugin cache, shell injection, unsafe archive extraction, path traversal, and reliance on a local development toolchain that is not declared. Quote and pass arguments structurally. Test supported Git versions and required feature detection.

Use one canonical skill source for both clients. Validate Claude plugin/marketplace packaging and Codex packaging against actual current contracts. Preserve sibling conventions where compatible; do not blindly reuse a manifest intended for a different host. Keep identity/version/catalog/docs consistent and generate mirrors deterministically. Additional runtime adapters are not required unless current Tailrocks policy mandates them; never advertise untested support.

Manual invocation and permissions need an explicit design. Installing the plugin must not trigger scans or cleanup. Audit and monitoring must not acquire cleanup authority. Prove that explicitly selecting convergence through `/goal` can load its required workflow without disabling safety or manual-invocation policy. Do not define a competing `/goal` command.

Document exact installation, direct invocation, `/goal` usage, dependency resolution, audit-only operation, resume, cleanup-only operation, and recovery for both clients. Verify commands through installed-client tests; do not invent slash syntax or claim identical namespaces.

## 7. Durable campaign state and completion

Use a versioned, validated state format outside disposable sources. Maintain inventory, scan coverage, work-item/provenance graph, decisions, acceptance evidence, review/CI/landing receipts, cleanup manifest, recovery index, operation journal, locks/leases, and a concise Markdown handoff. Persist raw and normalized selectors, canonical repository ID, target ref/remote and initial/current target OIDs, original PR bases, frozen source membership, scope mode, audit/local-only modes, cleanup policy, target-specific obligations, and configuration digest. Target identity is part of campaign, evidence, idempotency, and cleanup keys; never reuse another destination's receipts.

Record intent before side effects and reconcile outcomes after interruption. Distinguish planned, started, performed, verified, and recovered operations so retries do not duplicate merges or delete the wrong source. Missing, corrupt, stale, or contradictory evidence must fail closed for mutation. Keep sensitive raw data private and commit only sanitized summaries where appropriate.

Handoffs must preserve the original goal, exact scope and authority, requirements, completed and outstanding work, decisions, source paths/identities, branches/worktrees/PRs, recovery locations, test results, blockers, and the deterministic next action. Resume must work in a fresh agent conversation without relying on hidden chat memory.

Monitoring means explicit read-only refreshes/watch mode, rescans during an active goal, and resumable campaigns. Do not install scheduled jobs, global hooks, or background services without separate authorization. No promise of continued activity after the responsible runtime stops.

Completion requires a fresh independent check: accounted-for declared scan/selection scope, all accepted in-scope required work satisfied on the current selected target, applicable gates passed, cleanup accounted for according to the chosen policy, canonical campaign working state verified, and no unresolved in-scope work or unreported exceptions. The selected target may be any valid authorized branch, with main only the argument default. Keep historical batch completion, current all-work convergence, audit-only completion, verified local-only integration, verified remote integration, no-op, rejection, blocked, and recovery-required outcomes distinguishable; do not collapse them into a misleading green status. The helper can validate mechanical evidence; an independent reviewer must validate semantic adequacy. "Blocked" and "recovery required" are not success.

## 8. Evidence-first development and evaluation

Before writing each skill, freeze its distinct responsibility and discriminating acceptance evidence. For a claimed behavioral correction, observe and record a genuine no-skill/prior-skill failure for that reason. For preventive security or external-compatibility requirements, use an executable failing contract/security test plus an irrelevant control. Never fabricate red bars or retroactively describe an unobserved baseline.

Follow the current Tailrocks testing doctrine. Do not create per-skill eval trees or resurrect excluded evaluation infrastructure. Use the repository's approved shared acceptance/test locations and durable skill-evidence records. Test, wire, and review one skill before authoring the next; shared helper development and independent research may proceed in parallel.

Required deterministic fixtures cover:

- Divergent same-name branches across clones; renamed/remoteless clones; linked and detached worktrees; relevant bare repositories.
- Squash/cherry-pick/partial merges, reverts, successors dropping valid behavior, a broken implementation of a valid goal, and deliberately rejected obsolete work.
- Staged versus unstaged changes, untracked and valuable ignored files, binaries, symlinks/modes, unusual/NUL-delimited path handling, and sensitive files that must not leak.
- Stashes, reflog/unreferenced recovery candidates, interrupted Git operations, shallow/partial/missing objects, LFS, submodules, and alternates.
- Permission-denied/offline roots, unrelated same-name repositories, incomplete pagination, stale/deleted/moving remote refs, fork ownership, and protected refs.
- Concurrent agent writes, two campaigns from different clones, stale locks/leases, symlink/path replacement, nested repositories, and resources sharing an object store.
- Snapshot publication/restore failure, interruption before and after each side effect, recovery after restart, and byte/object-level restore verification.
- Pending/failed/skipped/missing/stale CI, zero runnable tests, unresolved or newly arriving feedback, merge-queue changes, and post-merge failures.
- Cleanup without a receipt, changed source identity after approval, incomplete goal disposition, and archival incorrectly used as completion.
- No-op second execution after convergence; no extra branches, PRs, commits, or destructive operations created by rerunning a completed campaign.
- Source branch A into target branch B; multiple sources into one non-main target; exact target direction; main untouched when not selected.
- Omitted target defaults literally to main even if current HEAD, PR base, or repository default is different; absent main never silently falls back or creates a branch.
- All example selectors individually and in mixed/deduplicated batches; literal `#` survives host-to-helper argument transport; branch names with slashes, numeric branches, encoded URLs, malformed refs, and shell metacharacters.
- Ambiguous branch names across clones/remotes; conflicting repositories; unrelated current checkout versus explicit URL repository; fork-head scope and ownership.
- Complete listing pagination, open/draft selection, filters, listing snapshots, new sources appearing mid-run, empty source sets, and explicit all-work versus targeted-scope isolation.
- PR originally based on main adapted into release/next without importing unrelated main history, retargeting/closing its original PR, or deleting a still-needed source.
- Source already landed on main but absent from release, and the reverse; squash/cherry-pick/equivalence/revert evidence keyed by selected target.
- Target moving between analysis, CI, review, and merge; different policies/checks on different targets; multi-source interactions; false success from queued/unmerged PRs.
- `--audit-only` never mutates sources; default mode actually lands a demonstrated improvement; `--cleanup=none` retains sources; cleanup after partial extraction and other-target obligations refuses premature deletion.
- Same source into two targets concurrently; target-aware idempotency plus shared resource locks; target identity changed on resume is not silently accepted.
- Explicit local-only integration versus remote delivery; no remote or CI success claims from local-only evidence.
- Installed facade composes the required skills with intact arguments and permissions; native namespaced Claude invocation, Codex skill selection/mention, and any explicitly installed shorthand shim all reach the same normalized request.

Add real Codex and Claude Code acceptance runs from clean installed-plugin environments, with exact versions, actual agent settings, skill/helper hashes, inputs, trajectories, artifacts, exit statuses, and nonzero test counts. Cover positive invocation and every advertised native facade route, near-miss prompts owned by neighboring collections, literal selector passage, audit refusing mutation, actual source-to-configured-target landing, scoped cleanup, interruption/resume, and pressure to skip safety gates. At least one real-agent disposable test per supported client must turn an initially missing requirement into a verified committed change on a non-main target while leaving main unchanged; remote-landing claims require actual hosted merge evidence. Parser tests or command-description screenshots do not establish end-to-end merge capability. Test skill-alone and installed collection/dependency behavior where supported. Preserve honest control conditions.

An independent verifier must inspect transcripts and filesystem/remote outcomes, not just final agent prose. Secret-bearing resources and real user work must never be used as disposable test data. Lack of credentials/runtime access is a recorded compatibility-proof blocker, not a reason to manufacture successful runs.

## 9. Delivery sequence and final acceptance

Implement in verified increments:

1. Inspect existing work and references, establish ownership/scope, freeze evidence and acceptance, and record the architecture decisions.
2. Build the minimal collection packaging, deterministic identity/state primitives, read-only discovery, and restore-tested preservation mechanisms.
3. Finish and prove target-aware audit; implement and prove convergence/actual landing on main and a non-main target, then prove standalone scoped cleanup. Wire and prove the thin `repo-merge` facade over these owners, one skill at a time under the current authoring doctrine. Preserve shared contracts rather than duplicate phases.
4. Run adversarial recovery/concurrency/security tests, real-client fresh-install runs, and read-only Jackin validation. Sanitize the example report and do not advertise it as a current whole-host scan unless actually performed with complete recorded coverage.
5. Finish docs, catalogs, dependency resolution, versioning, release artifacts, and minimal umbrella registration.
6. Run independent review, address all feedback, pass required CI, land authorized changes, release, and re-test the published artifact through both clients.

The plugin is done only when it is a working installable collection, not a plan or a folder of untested prompts. Required final evidence:

- Repository, exact final commit, PRs, version/release identity, and artifact integrity information.
- Ownership map and verified skill inventory with no duplicated PR-lifecycle responsibility.
- Actual native and logical install/invocation examples and fresh-install results for Codex and Claude Code, including the single entry point and all required selector types.
- Verified branch-A-to-branch-B and PR-to-non-main-target landing, default-main behavior, original-PR preservation, target-aware cleanup, and targeted versus all-work scope tests.
- Evidence linking each required behavior to deterministic and real-agent acceptance results.
- Successful recovery round-trip, interruption/resume, mutation-scope, concurrency, and no-op rerun checks.
- Sanitized read-only Jackin case study plus general fixtures proving repository independence.
- Successful umbrella registration and applicable docs/catalog/manifest validation.
- Independent final verification, clean development state, safe removal of only campaign-owned temporary resources, and honest unresolved-blocker reporting.

Keep `GOAL.md`, a progress/decision record, and `HANDOFF.md` current in the development repository using its established documentation layout. Preserve this complete specification and a requirement-to-evidence checklist. Do not narrow the acceptance criteria to obtain a green result, abandon required work because it is substantial, or end with an offer to implement the actual plugin later.
