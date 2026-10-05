# Work comparison rules

Compare sources against the selected target first. Then compare related
sources with each other. Use every work matrix row to record one outcome.

## Matrix rules

Assign one `W###` ID per work item. A work item describes one intended
outcome. One source can yield many work items. One work item can span many
sources.

Fill every matrix column for every work item:

| Work ID | Intended result | Target state | Source contribution | Missing or conflicting part | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| W001 | <observable outcome> | <present/partial/absent/reverted> | <S001: part A; S002: part B> | <gap> | <OID, file, lines, test path> | <confirmed/inferred/unknown> |

Use `confirmed` only when direct evidence supports the claim. Use `inferred`
when ancestry or similarity supports the claim without direct proof. Use
`unknown` when evidence is insufficient.

## Multi-signal comparison

Use commit ancestry, merge bases, changed paths, patch similarity, and source
inspection together. Never use one signal as the final verdict. A shared
commit or patch identifier alone does not prove that target behavior is
present.

Read enough surrounding code to understand each change. Include callers,
route registration, imports, package exports, feature flags, schemas,
migrations, tests, and user-facing documentation when relevant. For design
and UI work, distinguish implemented components from images, plans, and
unused prototypes. Record runnable paths and screenshots only when actually
available. Never claim a visual comparison that was not performed.

## Consumer check

A component that exists but has no consumer is incomplete work. A passing
compilation does not prove that the feature connects to the product. When no
consumer exists, record the missing wiring as the missing part.

## Cost controls

Find related sources through ancestry, paths, symbols, modules, and described
intent. Use those candidates for deeper comparisons. Never run every possible
expensive branch-pair comparison without a reason. Never skip a unique
contribution only because it has few commits or an old timestamp.

Use bounded API concurrency and respect rate-limit responses. Never create one
full clone per branch. Cache comparisons by repository identity, target OID,
and source OIDs. Reuse immutable results. Refresh mutable policy and PR state
separately.
