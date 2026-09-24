# tailrocks-repository-skills

One portable package with exactly three skills:

- `tailrocks-repository-merge` is the sole end-to-end coordinator for selected-source
  integration.
- `tailrocks-repository-audit` is an independently callable, read-only audit.
- `tailrocks-repository-cleanup` is an independently callable,
  proof-gated cleanup operation.

Each skill carries the bundled references it needs. Install the complete
package or release archive; do not copy an individual `SKILL.md` out of its
skill directory.

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
and restore-test proof.

## Lifecycle boundary

Review, PR creation, and remote PR landing belong to the installed Tailrocks
pull-request lifecycle collection. The relevant owners are
`tailrocks-review-pr`, `tailrocks-create-pr`, and `tailrocks-merge-pr`; they
are manual-only and must be explicitly selected when required. A review report
does not authorize a merge, and loading a skill does not authorize side
effects.

The current merge owner does not atomically compare-and-swap the selected
target base ref and object ID during mutation. Remote landing therefore stays
blocked until that owner supplies the required guard. Do not replace it with
`gh pr merge`. `--local-only` remains available for explicit disposable/local
work and never claims hosted delivery or CI.

## Native clients

Use the client-specific installation and invocation routes in
[docs/client-invocation.md](docs/client-invocation.md). Codex and Claude use
their plugin manifests; Muse and Antigravity use their native plugin
manifests; Kimi loads the `skills/` directory; OpenCode uses `skills.paths`
and `permission.skill`.

## Checks

Run the remaining deterministic checks from a source checkout's repository root:

```sh
tests/release-version-contract.sh
tests/claude-install-contract.sh
jq -e . \
  plugin.json \
  .codex-plugin/plugin.json \
  .claude-plugin/plugin.json \
  .claude-plugin/marketplace.json \
  .muse-plugin/plugin.json \
  catalog.json
```

These checks cover release-version consistency, Claude install metadata, and
manifest JSON syntax. They require the source checkout and do not claim model
behavior. Native acceptance requires isolated native-client runs and the
credentials or client capability required by that client; blocked or
install-only runs remain blocked or install-only.
