# tailrocks-repository-skills

One portable package with exactly nine public skills:

- `tailrocks-repository-merge` is the sole end-to-end coordinator for
  selected-source integration.
- `tailrocks-repository-audit` is an independently callable, read-only audit.
- `tailrocks-repository-cleanup` is an independently callable, proof-gated
  cleanup operation.
- `tailrocks-create-pr` creates a pull request after its branch and body
  gates pass.
- `tailrocks-refresh-pr` reconciles an existing pull request with its branch.
- `tailrocks-review-pr` performs a read-only, evidence-based review.
- `tailrocks-merge-pr` owns the guarded pull-request landing policy; hosted
  landing is currently fail-closed.
- `tailrocks-document` updates documentation required by a pull request.
- `tailrocks-pr-template` creates or reconciles a repository pull-request
  template.

The six pull-request lifecycle skills are bundled here. Their references,
templates, and required runtime resources ship with this package; no separate
source-collection checkout or installation is required. Install the complete
package or release archive. Do not copy an individual `SKILL.md` out of its
skill directory.

This package intentionally has no `tests/` directory and no GitHub Actions
workflows. Releases are published manually from tagged commits.

## Runtime requirements

Git is required for repository operations. Bun runs the bundled lifecycle
helpers. Remote pull-request lifecycle owners also require an authenticated
`gh` session with access to the target repository; local-only and read-only
audits can remain local.

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

Review, PR creation, refresh, documentation, template work, and remote PR
landing belong to the six bundled pull-request lifecycle skills. The relevant
owners are `tailrocks-review-pr`, `tailrocks-create-pr`,
`tailrocks-refresh-pr`, `tailrocks-document`, `tailrocks-pr-template`, and
`tailrocks-merge-pr`; they are manual-only and must be explicitly selected
when required. A review report does not authorize a merge, and loading a skill
does not authorize side effects.

The current merge owner does not atomically compare-and-swap the selected
target base ref and object ID during mutation, and it does not yet prove that
the landed target is that guarded object. Remote landing therefore stays
blocked until the owner supplies both guarantees. The bundled preflight is a
read-only inspection only:

```sh
bun /path/to/tailrocks-repository-skills/scripts/merge-preflight.ts \
  --root /path/to/target-repository --pr 1663 --no-poll
```

A `ready` receipt is not merge authority. Do not invoke
`scripts/merge-pr.ts`, `gh pr merge`, a direct hosting API merge, a direct ref
update/push, or another skill to bypass the owner. `--local-only` remains
available for explicit disposable/local work and never claims hosted delivery.

## Native clients

Use the client-specific installation and invocation routes in
[docs/client-invocation.md](docs/client-invocation.md). Codex, Claude, and
Grok use plugin manifests or marketplaces; Muse and Antigravity use their
native plugin manifests; Amp uses its bundled directory-plugin adapter and
Kimi loads the bundled skill directories;
OpenCode discovers `.opencode/skills` and uses `permission.skill`. Each route
installs this package as one unit and does not depend on another repository.
