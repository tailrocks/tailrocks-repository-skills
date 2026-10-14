# Handoff

Continue from [GOAL.md](GOAL.md). Keep one current evidence record in
[PROGRESS.md](PROGRESS.md); it links the source/collection decisions, target
contract, checks, landing, and cleanup state. Preserve
[requirements-to-evidence](docs/requirements-to-evidence.md) and
[research](docs/research.md).

Current remote branch is `codex/simplify-repo-merge` at
`6eca154533d93e05726b712efc355df88e4e080c`; local test/CI and progress-record
edits remain uncommitted. Source contracts, shell syntax, and diff checks pass,
but no installed-agent acceptance result, hosted PR/CI, landing, release, or
cleanup is established. Do not use Claude or claim Claude runtime validation.

The existing pinned PR merge owner does not atomically bind the selected
target branch/base OID. This blocks safe remote merge; do not bypass its gates.
Next: pass the Codex acceptance safety gate, record exact evidence, then commit
and push verified increments. Recheck target binding before any landing.
