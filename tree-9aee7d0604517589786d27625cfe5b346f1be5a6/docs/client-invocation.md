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

The real-agent disposable acceptance run used Codex 0.155.1 with
workspace-write sandbox and the installed local plugin. It invoked
$repo-merge --local-only --cleanup=none --target-branch=release/next
feature/auth, landed the source into the writable fixture clone, and verified
the exact target OID 7db4735a0bcde9f42b083b30c5afbe9eac26b32e plus unchanged
main 464cfbe245a3130d89caa89ac1bdfa1110ae4554. It did not use network or
cleanup; campaign 15aed4ef4a09c941 reached complete.

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

## Transport rule

The client must preserve #1145, quoted selectors, URL query strings, and
backslashes as data. The helper lexer owns this boundary. Never interpolate
the argument string into a shell command.
