# Requirements to evidence

Status: all version 0.2.0 acceptance evidence is pending. The v0.1.x records
below are historical evidence for the superseded implementation; they do not
prove the current skill architecture or release.

| Requirement retained from the full goal | Historical evidence only | 0.2.0 status |
| --- | --- | --- |
| Omitted destination means literal `main`; missing target never falls back or gets created | Old parser and target contracts in `../skill-evidence/repo-merge.md` | Pending root verification |
| Explicit non-main target receives only selected work; main stays unchanged | Old fixture and Codex local-only receipts in `../skill-evidence/repo-merge.md` | Pending new fixture and independent check |
| Mixed branch/ref, numeric/PR, URL, `/pulls`, and `/branches/all` selectors; complete pagination; provenance-preserving deduplication | Old selector and resolution contracts in `../skill-evidence/repo-merge.md` | Pending new skill and client checks |
| One repository binding, literal hash transport, ambiguity rejection | Old parser and binding tests in `../skill-evidence/repo-merge.md` | Pending new implementation verification |
| Targeted selection stays scoped; `--all-work` performs actual discovery and records coverage gaps | Old helper resolution tests; they did not prove full host-wide coverage | Pending full scan, coverage, and isolation acceptance |
| `--audit-only` is read-only | Old audit contract in `../skill-evidence/tailrocks-repository-audit.md` | Pending write-attempt fixture |
| Local-only results never claim remote landing/CI; resume rechecks original scope and target | Old fixture and campaign tests in `../skill-evidence/repo-merge.md` | Pending local-only and restart/resume acceptance |
| Preserve unique state and snapshot/restore-test before deletion | Old recovery and cleanup contracts in `../skill-evidence/tailrocks-repository-cleanup.md` | Pending disposable restore and delete-gate acceptance |
| Recovery snapshots keep sensitive data local; reports redact credential-bearing remote URLs and secret values | No current 0.2.0 artifact | Pending leak-probe fixture and independent transcript/output inspection |
| Read-only refresh during an active goal keeps the same scope and does not mutate sources or install a watcher | v2 specification only; not current implementation evidence | Pending installed-client refresh test and filesystem/ref comparison |
| After landing, repair regressions before cleanup; an already-satisfied rerun is a verified no-op with no duplicate commit/PR | No current 0.2.0 artifact | Pending installed-skill regression and rerun fixture |
| Same source can be assessed for different targets without cross-target evidence reuse or unsafe shared mutation | v2 specification only; not current implementation evidence | Pending concurrent target-isolation fixture and target-OID inspection |
| `--all-work` rescans after cleanup and reports an explicit final state; gaps, active writers, or unresolved work cannot be green | Old helper tests did not prove final discovery or full coverage | Pending integrated cleanup/re-discovery fixture with coverage review |
| Actual review and CI use applicable target policy; actual PR landing goes through lifecycle owners | Old campaign receipts in `../skill-evidence/repo-merge.md` | Pending owner-composition and live/disposable landing proof |
| Verify the exact selected target after landing; a queued merge is not completion | Old fixture receipts in `../skill-evidence/repo-merge.md` | Pending fresh target-OID verification |
| `--cleanup=none` retains sources; resolved cleanup is individual, authorized, and checks other-target obligations | Old scope tests in `../skill-evidence/tailrocks-repository-cleanup.md` | Pending cleanup fixtures and independent inspection |
| `repo-merge` is the sole end-to-end coordinator; audit and cleanup remain distinct | Old four-skill facade evidence in `../skill-evidence/repo-merge.md` | Pending installed inventory and ownership review |
| No redundant converge route or campaign/journal/lease/receipt engine; no `cargo run` requirement | No historical evidence; v0.1.x had these components | Pending source and packaging review |
| Codex and Claude preserve arguments through documented native skill invocation; Codex `/goal` remains an objective tracker, not a substitute skill invocation | Old client evidence in `../skill-evidence/repo-merge.md` | Pending fresh installed-client tests for CLI skill routes and `/goal` where supported; no Claude `/goal` claim |
| Release and umbrella registration; runtime versions consistent at 0.2.0 and portable manifest valid under its schema | Historical v0.1.0/v0.1.1 receipts in `release.md` and `research.md` | 0.2.0 release and umbrella update pending |

The full v2 specification remains preserved at the repository root. Do not
remove acceptance requirements to make this table green. Root must replace each
pending cell only with an exact current artifact, command/result, target or
source identity, and independent verification where required. Tests and CI
must be run on the integrated 0.2.0 source; no current pass is claimed here.
