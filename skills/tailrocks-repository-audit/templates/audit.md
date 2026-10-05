# Audit report

```yaml
report_format: tailrocks-repository-audit/1
run_id: <unique run name>
repository: <canonical owner/repository>
target_ref: <full target ref>
target_oid: <full observed Git object ID>
observed_from: <UTC timestamp>
observed_until: <UTC timestamp>
scope: <all-work or exact selected source set>
local_scope: <none or explicit paths>
coverage: <complete or partial>
execution_checks: <not-run or a precise external check reference>
```

Angle-bracket values are placeholders. Replace them with real values. Never
use a sample object ID as evidence.

## Sources

| Source ID | Type and identity | State | Head OID | Declared base | PR links | Work IDs | Availability/gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S001 | <canonical branch or PR identity> | <state> | <full OID> | <base ref/OID> | <numbers> | W001 | <evidence status> |

## Work matrix

| Work ID | Intended result | Target state | Source contribution | Missing or conflicting part | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| W001 | <observable outcome> | <present/partial/absent/reverted> | <S001: part A; S002: part B> | <gap> | <OID, file, lines, test path> | <confirmed/inferred/unknown> |

## Dispositions

| Work ID | Disposition | Evidence |
| --- | --- | --- |
| W001 | <one of the 11 dispositions> | <evidence> |

## Gaps

List every missing object, access error, truncated response, unresolved
identity, and unverified behavior.

- <gap>

## Coverage

State deliberate exclusions with reasons. Separate deliberate exclusions from
failed reads. Use `partial` when comparison work remains.

- <exclusion or failed read>

## Next

State the owner and the next action. The audit grants no mutation permission.

- Owner: <owner>
- Action: <action>
