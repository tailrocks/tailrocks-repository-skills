# Client invocation and /goal

## Codex CLI

Codex discovers the plugin through its native marketplace/plugin mechanism.
Use the plugin's repository marketplace entry, then select the skill with
the supported $repo-merge mention or /skills interface:

    $repo-merge --target-branch=release/next feature/auth

The host /goal command owns the durable objective. Use it to start, pause,
resume, or clear the goal; pass the same complete repo-merge argument string
to the selected skill. /goal is not a repo-merge alias.

Proof: tests/client-contract.sh validates installed Codex version and plugin
command help. The local native test added this marketplace, discovered the
0.1.0 plugin, installed it, invoked $repo-merge in read-only mode, and
observed literal main target rejection for the unborn target. The temporary
marketplace and install were then removed.

Release proof: an isolated checkout of tag v0.1.0 was installed through the
native Codex marketplace flow and reported enabled version 0.1.0. The current
patch release is v0.1.1; its release workflow and fresh artifact install remain
pending.

The latest real-agent disposable acceptance used Codex 0.155.1 with model
gpt-5.6-luna, high reasoning, approval never, workspace-write sandbox, and
the installed local plugin. It invoked `$repo-merge --local-only
--cleanup=none --target-branch=release/next feature/auth`, recovered from an
immutable checked-out Git metadata path into the prepared writable clone, and
landed the source at target OID
`ec1cb8d556ff0d2193f128364fed7579ba427efa`. It verified `auth.txt`, preserved
`release.txt`, kept main at
`ac92839d316618f5dfcfa40bbf213b22cc0028ca`, used no network, and skipped
cleanup by policy. Campaign `campaign-5b4789d507dd56ba` reached
`campaign-complete/complete` with audit, review, CI, landing, verification,
and target-observation receipts. The initial target was
`bc9a0feb9dcf0ee5d28c160001b60a7bf1e5b75c`; the source was
`228f5550fd4e275479377068514e0235a2b31d2f`. The harness built the helper
before agent start and passed it through `TAILROCKS_HELPER_BIN`; campaign state
mutations were serialized by the helper's per-campaign OS lock.

## Claude Code

Claude Code loads this directory as a plugin through its native plugin
mechanism. Invoke the namespaced skill:

    /tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth

Claude passes the full argument string as $ARGUMENTS. A bare /repo-merge
command is not advertised. The host goal record remains GOAL.md and
PROGRESS.md; the plugin does not invent an identical slash alias.

Direct cleanup-only use selects the cleanup owner explicitly:

    /tailrocks-repository-skills:tailrocks-repository-cleanup --target-branch=release/next --cleanup=resolved feature/auth

Codex selects the same owner as $tailrocks-repository-cleanup. --local-only
is explicit and local-result-only in either client.

Proof: Claude plugin and marketplace manifests pass strict validation. A live
namespaced read-only invocation was attempted with --plugin-dir and reached
the client, but failed before model execution because the installed OAuth
session was expired and could not be refreshed. Re-run
tests/client-contract.sh with TAILROCKS_CLIENT_E2E=1 after authentication.

Release proof: an isolated v0.1.0 checkout was added as a Claude marketplace,
installed at local scope, reported enabled version 0.1.0, and passed strict
plugin validation. This proves packaging/installability; it does not bypass
the separate live-session OAuth blocker.

## Transport rule

The client must preserve #1145, quoted selectors, URL query strings, and
backslashes as data. The helper lexer owns this boundary. Never interpolate
the argument string into a shell command.
