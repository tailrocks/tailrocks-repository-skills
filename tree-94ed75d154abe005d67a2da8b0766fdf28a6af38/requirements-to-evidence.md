# Requirements to evidence

| Requirement | Evidence artifact or test |
| --- | --- |
| Literal default target main | helper parser test and target receipt |
| Configurable non-main destination | target receipt, fixture release/next landing |
| No fallback or target creation | target-check missing-target test |
| Branch/ref/PR/list selectors | parser contract tests and audit skill reference |
| Literal hash transport | parser contract test |
| One repository and provenance-preserving deduplication | parser tests and campaign frozen_sources |
| Selected sources are not global cleanup | tests/cleanup-scope.sh preserves unrelated source, main, and target refs |
| Explicit all-work mode | parser contract and convergence reference |
| Target-relative judgment | audit receipt names target OID and comparison base |
| Cross-target PR preservation | converge reference and adaptation receipt |
| Actual landing | merge receipt with landed target OID; fixture Git refs |
| Real-agent non-main landing | Codex 0.155.1 campaign receipt; release/next OID 7db4735a…; main unchanged |
| Independent review and applicable CI | read-only baseline review with three fixes; hosted CI 35826193979 passed on hardening commit |
| Batch re-verification | post-batch target receipt |
| Restore before deletion | tests/cleanup-scope.sh and recovery snapshot-restore receipt |
| Resume and recovery | campaign journal and resume target-conflict test |
| Target movement and leases | campaign-observe, initial/current OIDs, create-new lease, release test |
| Campaign identity and completion safety | collision test across clone paths; receipt attachment requires repository path, target ref, and initial/current OID; completion requires target-observed plus an attached receipt |
| Fail-closed cleanup restore | recovery test rejects a snapshot with a missing staged/unstaged patch artifact |
| Explicit local-only result | repo-merge/converge contract and local fixture landing |
| Idempotent no-op rerun | fixture test and no-op receipt |
| Codex and Claude invocation | README plus client contract test/evidence |
| Jackin read-only | research record and no Jackin write commands |
| Installable plugin | root, Codex, and Claude manifests; CI validation |
| Release and umbrella registration | v0.1.0 release workflow 35826243801 and release page; umbrella merge commit 2b6d21c326e5febf889d280cb2c5f4a595775ff |
