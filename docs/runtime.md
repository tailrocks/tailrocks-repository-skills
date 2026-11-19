# Runtime requirements

Install the [complete package](installation.md). The native registrars only
register skill files. Skill procedures control when to call tools or execute a
script. Installation grants no authority for a skill action.

Use Git and `gh`. For a hosted pull request, authenticate `gh` with the access
that the selected workflow requires. The hosted workflows support GitHub.com.
The six script-backed skills need Bun 1.4 or newer. Check `bun --version`
before running a helper. The maintainer toolchain pins Bun 1.4.4.

Each script-backed skill carries `scripts/lib/` and `scripts/schemas/` under
its own directory. `lib/` and `schemas/` at package root own those files.
Before release, run `bun run vendor` and verify the copies. Installed helpers
use the local copies and invoke `git` and `gh`. Read the selected skill for
its authority, target, and default-branch policy checks.
