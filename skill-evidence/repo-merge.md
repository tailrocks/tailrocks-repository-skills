# Facade evidence

Observed need: four separate manual workflows would make users remember
different target, source, cleanup, and resume rules. The facade is therefore
thin: it normalizes one request and routes to existing owners.

Discriminating contract: one native entry point, one target-bound campaign,
audit-only isolation, default actual landing, scoped cleanup, and identical
argument transport across clients without claiming a universal slash alias.

Acceptance:

- Codex native local marketplace add, plugin discovery, plugin install, and
  $repo-merge audit invocation succeeded; the exact missing main target was
  reported and no mutation occurred.
- Claude plugin and marketplace manifests pass strict validation. A live
  namespaced invocation reached Claude but is blocked before model execution
  by expired OAuth; this remains an explicit compatibility blocker.
- tests/client-contract.sh verifies installed client command surfaces,
  namespaced/mention spellings, /goal documentation, no bare alias, and
  optional authenticated e2e mode.

Real-agent acceptance:

- Codex 0.155.1 discovered and installed the local plugin through its native
  marketplace flow, invoked $repo-merge, and completed a target-bound
  non-main local landing in the disposable fixture.
- Exact result: release/next reached
  7db4735a0bcde9f42b083b30c5afbe9eac26b32e; main remained
  464cfbe245a3130d89caa89ac1bdfa1110ae4554; campaign
  campaign-15aed4ef4a09c941 reached complete; cleanup was explicitly none.

Hardening and publication:

- Independent read-only review of baseline commit 5dff1239 requested changes
  for campaign identity collisions, fail-open completion, and missing restore
  artifacts. All three were fixed in 4809cf4; its separate request for a
  duplicate executable convergence engine was rejected as outside this
  Agent-Skills orchestration boundary.
- Commit 4809cf4c1cc91df6ff28cbf009fe3de83de96437 adds fail-closed campaign
  identity collision checks, target-bound receipt attachment, completion
  gating, and missing-patch restore rejection. Local full contracts passed;
  hosted CI 35826193979 passed.
- v0.1.0 release workflow 35826243801 passed. The released tag installed in
  native Codex and Claude marketplace flows and strict Claude validation
  passed. Live Claude execution remains blocked by expired OAuth.
- A later real-agent retry landed a disposable target but helper build was
  sandbox-blocked and no completion receipt was emitted; the wrapper failed,
  so it is not counted as acceptance.
