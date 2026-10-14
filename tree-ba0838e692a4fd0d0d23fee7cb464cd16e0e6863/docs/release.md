# Release status

The intended next version is 0.2.0. It is pending implementation verification;
there is no 0.2.0 release claim.

Before release, root must:

1. Verify Codex, Claude, and marketplace manifests use version 0.2.0 and
   identify exactly `repo-merge`, `tailrocks-repository-audit`, and
   `tailrocks-repository-cleanup`. Keep the portable root manifest within the
   [Antigravity plugin schema](https://antigravity.google/docs/plugins/#manifest-file-pluginjson):
   it permits only `$schema`, `name`, and `description`, so it has no version
   field.
2. Run required repository checks and CI, review the current skill files, and
   inspect installed-client argument transport and permissions.
3. Verify selector mixing and pagination, audit-only, all-work coverage,
   non-main isolation, resume, snapshot/restore, actual lifecycle-owner review
   and landing, target verification, and cleanup gates in authorized
   disposable fixtures.
4. Record exact commit, workflow/run IDs, artifact hashes, target OIDs, install
   results, and independent verification in
   [requirements-to-evidence](requirements-to-evidence.md).
5. Only then tag, publish, and verify the exact release artifact. Do not
   describe pending or historical evidence as a current pass.

The canonical skill inventory is `catalog.json`. Runtime packaging lives in
`.codex-plugin/` and `.claude-plugin/`; root `plugin.json` is the portable
manifest. Umbrella registration is a separate change owned by the umbrella
repository.
