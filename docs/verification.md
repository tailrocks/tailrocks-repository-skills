# Verification

Run the [maintenance checks](maintenance.md) on the exact release revision.
Run the validator and inspect the npm archive file list before installing a
Git package. Confirm that the installed skill can resolve a bundled reference
and each required runtime helper from its installed path.

| Check | Expected evidence |
| --- | --- |
| `python3 scripts/validate-package.py` | Valid native manifests, skill metadata, adapter registrations, and resource paths |
| `alint check --fail-on-warning` | Shared active-package profile passes |
| `npm pack --dry-run --json` | Complete skills and referenced package-root resources in the file list |
| Fresh Velnor preview | Generated `.github` tree matches the checkout |
| Offline Lychee with fragments | Local files and links resolve |

## Shared installation tests

The shared exact-revision test installed an older fixture commit while the
fixture's default branch pointed at another commit. It used Claude Code
`2.1.328`, Codex CLI `0.167.0-alpha.4`, Grok Build `1.0.89`, and Muse Code
`1.4.24`. A separate OpenCode `2.3.2` fixture registered skills from its
installed Git package and resolved their files from its package cache. The
Amp adapter test used an API test double.

Those checks establish the tested fixture behavior. See [compatibility](compatibility.md)
for host capabilities and limits.

## Package evidence

Record package-specific installation and runtime results here. Include the host
version, source revision, commands, and observed result. When model settings
matter, record the requested and effective values separately.

Run the [Bun tests and vendoring check](maintenance.md#typescript-tooling) for the PR helpers.

### Release candidate, 2026-11-20

Version `0.6.0` contains 10 canonical skills.
The native package validator, Alint profile and local overrides, strict metadata,
and local file-and-fragment checks passed.
The npm file inventory retained all declared runtime resources.
The shared generator found no drift on its second pass.

This candidate installed through Claude Code 2.1.328, Codex 0.167.0-alpha.4,
Grok Build 1.0.89, and Muse Code 1.4.24-R9131.1.
Each client's native registry reported the expected plugin and skill pairs.
The installed runtime files matched the candidate checkout by SHA-256.
These checks used immutable local fixture commits and isolated stores.
They did not exercise private GitHub authentication or paid model tasks.

OpenCode 2.3.2 loaded this package with the other ten candidates in a live local
server.
Its registry preserved the exact installed skill bodies, paths, and invocation
flags.
Bundled model references resolved from those installed paths.
The server could not start outbound connections and made no model calls.
This establishes local registration, not remote Git installation or workflow
execution.

The shared checks covered 44 installations and all 98 skill entries per client.
The [central verification record][native-evidence] records aggregate evidence and
limits.

[native-evidence]: https://github.com/tailrocks/tailrocks-skills/blob/main/docs/verification.md

Bun 1.4.4 completed a frozen dependency installation and TypeScript checking.
All 1,389 existing tests passed with 4,158 assertions across 45 files.
The vendored runtime consistency tests passed within that suite.

### Package integrity correction, 2026-11-20

The shared validator now uses bounded parsing for keys, fences, and link targets.
Malformed-input scaling checks and existing resource rejection cases passed.
The package commits and ships its Bun 1.4.4 dependency lockfile.
Frozen offline verification passed without changes or dependency lifecycle scripts.
The skill instructions and native registrar behavior remain as measured above.
