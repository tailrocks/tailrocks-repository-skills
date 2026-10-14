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

- Codex 0.155.1, gpt-5.6-luna, high reasoning, approval never, and
  workspace-write sandbox discovered and installed the local plugin through its
  native marketplace flow, invoked `$repo-merge`, recovered to the prepared
  writable clone after an immutable checkout path, and completed a
  target-bound non-main local landing.
- Exact result: `release/next` advanced from
  `bc9a0feb9dcf0ee5d28c160001b60a7bf1e5b75c` to
  `ec1cb8d556ff0d2193f128364fed7579ba427efa`; source ancestry, `auth.txt`,
  and existing `release.txt` were verified; main remained
  `ac92839d316618f5dfcfa40bbf213b22cc0028ca`; campaign
  `campaign-5b4789d507dd56ba` reached `campaign-complete/complete`; cleanup
  was explicitly none. The helper was built outside the sandbox and supplied
  with `TAILROCKS_HELPER_BIN`.

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
- The prebuilt-helper seam is now covered by the passing real-agent harness;
  the former sandbox build denial is no longer an acceptance blocker for
  hosts that can build the declared helper before invoking the installed
  plugin.
- Campaign state read-modify-write operations now use a per-campaign OS lock;
  the helper unit test proves concurrent mutation fails closed, and the native
  acceptance completed its receipt and journal sequence without lost state.
