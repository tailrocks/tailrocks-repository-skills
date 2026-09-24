# Handoff

Continue from [GOAL.md](GOAL.md). Keep one current evidence record in
[PROGRESS.md](PROGRESS.md); it links the source/collection decisions, target
contract, checks, landing, and cleanup state. Preserve
[requirements-to-evidence](docs/requirements-to-evidence.md) and
[research](docs/research.md).

Imported upstream checkpoint `codex/simplify-repo-merge` at
`d69ff3c0c04cc419dfef571c97841c8fb3adb980`; local branch history is preserved
by an ordinary merge commit. Source contracts, shell syntax, and diff checks pass,
but no installed-agent acceptance result, hosted PR/CI, landing, release, or
cleanup is established. Do not use Claude or claim Claude runtime validation.

The existing pinned PR merge owner does not atomically bind the selected
target branch/base OID. This blocks safe remote merge; do not bypass its gates.
Next: pass the Codex acceptance safety gate, record exact evidence, then commit
and push verified increments. Recheck target binding before any landing.
