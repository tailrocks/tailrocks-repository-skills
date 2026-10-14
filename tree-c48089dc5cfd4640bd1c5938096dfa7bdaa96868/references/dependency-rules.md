# Dependency rules

## Dependency versus conflict

A dependency means one group must land before another group. A conflict
means two groups share one behavior or resource and cannot prepare safely
at the same time. A dependency and a potential conflict are different
relationships. Record them in separate tables.

## Dependency table

| Group | Must follow | Reason | Required predecessor result |
| --- | --- | --- | --- |
| G002 | G001 | <API/schema/build/behavior dependency> | <specific delivered result> |

## Conflict and resource table

| Groups | Shared behavior or resource | Restriction | Resolution |
| --- | --- | --- | --- |
| G002, G003 | <same migration sequence> | Do not prepare concurrently. | <chosen owner and order> |

## Cycles

A dependency cycle requires a grouping or scope decision before execution.
Never select an arbitrary order to break a cycle. Regroup the work or defer
one side, then rebuild the tables.

## Merge schedule

State which groups can prepare, test, and review together. Then state the
target landing order. After each direct landing, revalidate the remaining
groups against the new target. Use a merge queue when repository policy
requires it. Never let independent agents race to update the same target
directly.
