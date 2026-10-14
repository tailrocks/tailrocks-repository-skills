# tailrocks-repository-skills

One portable package with exactly six public skills:

- `tailrocks-repository-merge` audits, groups, integrates, reviews, and
  merges selected repository work into one exact target.
- `tailrocks-create-pr` creates a pull request after its branch and body
  gates pass.
- `tailrocks-refresh-pr` reconciles an existing pull request with its branch.
- `tailrocks-review-pr` performs a read-only, evidence-based review.
- `tailrocks-merge-pr` owns the guarded pull-request landing policy. It
  reports blocked, pending, queued, merged, failed, or uncertain.
- `tailrocks-pr-template` creates or reconciles a repository pull-request
  template.

The six skills are bundled here. Their skill-local references ship with
this package; no separate source-collection checkout or installation is
required. Install the complete package or release archive. Do not copy an
individual `SKILL.md` out of its skill directory.

This package intentionally has no `tests/` directory. The repository keeps a
generated `.github/workflows/ci.yml` file. Do not hand-edit that generated
workflow. Releases are published manually from tagged commits.

## Runtime requirements

Git and `gh` are required for repository operations.
Hosted lifecycle routes require an authenticated `gh` session with access to
the target repository and support GitHub.com only; GitHub Enterprise is
unsupported.
Read-only audits can remain local.

## Select sources and target

Positional arguments are sources. `--target-branch` is the one destination;
when omitted, it means the literal branch `main`.

```text
tailrocks-repository-merge --target-branch=release/next feature/auth
tailrocks-repository-merge --target-branch=main '#1663' feature/auth
tailrocks-repository-merge --target-branch=main https://github.com/OWNER/REPO/pull/1103
tailrocks-repository-merge --target-branch=main https://github.com/OWNER/REPO/pulls
tailrocks-repository-merge --target-branch=integration https://github.com/OWNER/REPO/branches/all
tailrocks-repository-merge --repo=OWNER/REPO --all-work --target-branch=main
tailrocks-repository-merge --audit-only --target-branch=release/next feature/auth
tailrocks-repository-merge --local-only --cleanup=none --target-branch=release/next feature/auth
tailrocks-repository-merge --resume RUN_ID
```

Sources may mix branches, qualified refs, `branch:N`, `#N`, PR numbers, PR
URLs, and listing URLs, but they must identify one repository. A bare number is
a PR; `branch:N` selects a numeric branch. Listing selectors paginate fully.
Empty input is an error; `--all-work` is the explicit repository-wide scope.

The selected target must already exist and be unambiguous. The workflow never
falls back to `HEAD`, `origin/HEAD`, a PR base, or a hosting default. A
non-main target leaves `main` outside mutation scope. `--audit-only` is
read-only. `--local-only` reports only an existing local target. Resume
revalidates the saved repository, source, and target identities. Cleanup is
source-specific; `--cleanup=none` retains sources, and resolved cleanup needs
current target, obligation, ownership, quiescence, identity, authorization,
and data-restore proof.

## Lifecycle boundary

Review, PR creation, refresh, template work, and remote PR
landing belong to the bundled pull-request lifecycle skills. The relevant
owners are `tailrocks-review-pr`, `tailrocks-create-pr`,
`tailrocks-refresh-pr`, `tailrocks-pr-template`, and
`tailrocks-merge-pr`; each owner must be explicitly selected when required.
A review report does not authorize a merge, and loading a skill does not
authorize side effects.

The merge owner guards each landing. It verifies the exact target, checks,
reviews, and policy before one merge or enqueue request. The bundled
preflight is a read-only inspection only:

```sh
bun /path/to/tailrocks-repository-skills/scripts/merge-preflight.ts \
  --root /path/to/target-repository --repo OWNER/REPO --pr 1663 --no-poll
```

A `ready` receipt is not merge authority. To land a pull request, select
the merge owner. Do not invoke `gh pr merge`, a direct hosting API merge, a
direct ref update or push, or another skill to bypass the owner.
`--local-only` remains available for explicit disposable and local work.
It never claims hosted delivery.

## Native clients

Use the client-specific installation and invocation routes in
[docs/client-invocation.md](docs/client-invocation.md). Codex, Claude, and
Grok use plugin manifests or marketplaces; Muse and Antigravity use their
native plugin manifests; Amp uses its bundled directory-plugin adapter and
Kimi loads the bundled skill directories; Cursor CLI discovers project and
user skill directories and selects a skill from its `/` menu;
OpenCode discovers `.opencode/skills` and uses `permission.skill`. Each route
installs this package as one unit and does not depend on another repository.
