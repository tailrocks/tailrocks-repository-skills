# Audit evidence

Observed need: the requested repository did not contain an existing
repo-merge implementation. Existing Jackin default-branch discovery uses
advertised default/current-branch assumptions that violate literal-main and
non-main targeting.

Discriminating contract: parse selected sources, bind one repository, check
the exact selected target, compare against that target, and perform no
mutation or cleanup.

Control: direct Git inspection of the current checkout reports an unborn main
and no target object; it does not silently create or substitute a target.

Acceptance:

- tests/selector-contract.sh passes literal hash, URL list query/fragment,
  numeric branch, provenance-preserving deduplication, duplicate-option
  rejection, empty-scope rejection, and mixed-repository rejection.
- tests/fixture-landing.sh passes exact release/next selection while main
  remains unchanged.
- Codex installed-plugin audit run reported main as refs/heads/main and
  target absent without mutation.
