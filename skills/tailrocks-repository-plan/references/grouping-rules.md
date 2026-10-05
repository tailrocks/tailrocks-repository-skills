# Grouping rules

Optimize for a small number of coherent groups, not the fewest possible
groups at any cost. Group work that shares one acceptance story or is
tightly coupled. Keep independent risky changes separate when separation
makes review and rollback clearer.

## Route table

Compare every candidate route for each group:

| Route | Use when |
| --- | --- |
| Reuse existing PR | Its owner, base, scope, and review history remain suitable. |
| Extend an owned PR branch | The added work belongs to its existing purpose and update permission exists. |
| New integration branch and PR | Several sources need one clean review target, or the existing PR scope is unsuitable. |
| Separate dependent PRs | Independent review and staged delivery remain practical. |
| Defer the group | Evidence, authorization, history constraints, or required work prevents safe preparation. |

Never choose a new PR only because it is easier to script. Never replace an
active contributor PR without explicit permission.

## Coherence rules

Give each accepted work item one primary group. Record shared prerequisites
once. Never duplicate shared changes in every group. Duplicates refer to the
primary destination. They never create another copy of the work.

Every deferred or rejected item keeps its reason and its retained source
identity. Never silently omit an orphan source.

## Attribution preservation

Keep the original author attribution when a group reuses source work. Keep
discussion links from reused or extended PRs. Record the source identity for
every grouped work item.
