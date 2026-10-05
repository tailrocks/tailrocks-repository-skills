# Plan progress

Keep this file short. Keep it in the same run directory as `plan.md`.
Update it after every group state change.

```yaml
plan_revision: <rev>
target_oid: <last-validated full OID>
updated: <UTC timestamp>
```

## Group states

| Group | State | Evidence |
| --- | --- | --- |
| G001 | <planned/prepared/PR/reviewed/landed/blocked> | <links> |

## Drift notes

A saved report never proves that a push or merge succeeded. Before resume,
query the current remote branches and PRs.

- When a source head changed, invalidate its comparisons.
- When the target advanced, refresh affected comparisons and merge checks.
- When a candidate changed, invalidate its review and checks.
- When a new branch appears, re-audit before extending the plan.
- Never silently expand a frozen scope.
