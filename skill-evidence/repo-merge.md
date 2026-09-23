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
