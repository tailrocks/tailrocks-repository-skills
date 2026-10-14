# Requirements to evidence

| Requirement | Evidence artifact or test |
| --- | --- |
| Literal default target main | helper parser test and target receipt |
| Configurable non-main destination | target receipt, fixture release/next landing |
| No fallback or target creation | target-check missing-target test |
| Branch/ref/PR/list selectors | parser contract plus `tests/resolution-contract.sh`; helper resolves local refs, exact PR metadata, paginated list fixtures, drafts, target exclusion, and frozen membership |
| Literal hash transport | parser contract test |
| One repository and provenance-preserving deduplication | parser tests and campaign frozen_sources; explicit repository binding now verifies normalized GitHub origin before campaign creation |
| Explicit URL/repository binding to the current checkout | helper test `explicit_repository_binding_matches_origin_and_rejects_mismatch` and normalized SSH/HTTPS credential-form tests |
| Selected sources are not global cleanup | tests/cleanup-scope.sh preserves unrelated source, main, and target refs |
| Explicit all-work mode | parser contract and convergence reference |
| Target-relative judgment | audit receipt names target OID and comparison base |
| Cross-target PR preservation | converge reference and adaptation receipt |
| Actual landing | merge receipt with landed target OID; fixture Git refs |
| Real-agent non-main landing | Codex 0.155.1 campaign `campaign-c991f32f1deb5da4`; release/next advanced from `401b69dcc549b3df7cd089dbb82753369e546fe2` to `395154a65036e65a83dfc5edd70172c7271b7d6b`; main unchanged at `36c4a47febe81790b8b232915177da9f20bc669c`; helper supplied prebuilt outside sandbox |
| Independent review and applicable CI | read-only baseline review with three fixes; final hosted CI 35830543413 passed |
| Batch re-verification | post-batch target receipt |
| Restore before deletion | tests/cleanup-scope.sh and recovery snapshot-restore receipt |
| Resume and recovery | campaign journal and resume target-conflict test |
| Target movement and leases | campaign-observe fast-forward/CAS check, repository/target create-new lease, same-target concurrent campaign rejection, release test |
| Campaign identity and completion safety | collision test across clone paths; typed receipt attachment requires campaign/scope/source/phase/hash plus repository path, target ref, and initial/current OID; completion requires every applicable phase and target observation |
| Concurrent campaign-state mutation | `fs2` per-campaign OS lock; deterministic unit test proves a second writer fails closed until the first exits; latest native run completed all receipt/journal writes |
| Fail-closed cleanup restore | recovery test rejects a snapshot with a missing staged/unstaged patch artifact |
| Explicit local-only result | repo-merge/converge contract and local fixture landing |
| Idempotent no-op rerun | fixture test and no-op receipt |
| Codex and Claude invocation | README plus client contract test/evidence |
| Jackin read-only | research record and no Jackin write commands |
| Installable plugin | root, Codex, and Claude manifests; CI validation |
| Release and umbrella registration | v0.1.0 release workflow 35826243801; v0.1.1 commit `6c3b62b`, hosted CI `35834837262`, release workflow `35834905290`, canonical release assets, and fresh exact-tag installs in both clients; v0.1.2 pending; umbrella merge commit 2b6d21c326e5febf889d280cb2c5f4a595775ff |

## Unresolved full-spec evidence

- Live Claude model execution remains blocked before model start by the
  installed client's expired OAuth session. Native install and strict manifest
  validation are proven; real Claude landing is not claimed.
- Hosted PR-to-non-main landing is not claimed. Jackin is read-only and no
  authorized disposable hosted test repository was available for mutation.
- The helper now mechanically resolves and freezes selector metadata, but
  target-relative semantic classification, cross-target adaptation PRs,
  repository policy discovery, lifecycle-owned review/CI/landing, and scoped
  cleanup execution remain owner/integration work rather than helper claims.
- The broad v2 adversarial matrix (all-work discovery, complete remote-list
  pagination against a live API, and every Git/LFS/submodule recovery mode)
  remains a documented acceptance requirement rather than completed evidence.
  Campaign-state concurrency, frozen local/API resolution fixtures, target
  leases, typed completion receipts, and non-fast-forward rejection are now
  covered locally.
