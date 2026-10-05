# Plan report

```yaml
report_format: tailrocks-repository-plan/1
audit_path: <path>
audit_revision: <rev>
repository: <owner/repo>
target_ref: <full ref>
target_oid: <full OID>
source_snapshot: <heads digest>
phase_limit: <limit>
provisional: <true or false>
```

Angle-bracket values are placeholders. Replace them with real values. A
provisional plan cannot enter consolidation until its evidence is complete.

## Groups

| Group | Purpose | Source/work IDs | Candidate route | PR | Predecessors | Parallel preparation | Target/method | Checks | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G001 | <one coherent outcome> | S001, S002 / W001 | <reuse or new branch> | <existing or planned> | <group IDs> | <safe groups> | <exact target and method> | <real checks> | <planned/blocked> |

## Dispositions

| Work ID | Primary group or retained location | Decision | Reason and evidence | Unresolved obligation |
| --- | --- | --- | --- | --- |
| W001 | G001 | Retain | <evidence> | <none or exact dependency> |

## Dependencies

| Group | Must follow | Reason | Required predecessor result |
| --- | --- | --- | --- |
| G002 | G001 | <dependency> | <specific delivered result> |

## Conflicts/resources

| Groups | Shared behavior or resource | Restriction | Resolution |
| --- | --- | --- | --- |
| G002, G003 | <shared resource> | <restriction> | <chosen owner and order> |

## Merge schedule

State parallel-prepare sets first. Then state the landing order. After each
landing, revalidate the remaining groups against the new target.

- Parallel prepare: <group sets>
- Landing order: <ordered group IDs>
- Revalidate rule: revalidate every unlanded group after each landing.

## Acceptance stories

Write one story per group in Given-When-Then form. Name the exact
target and the observable result. A group lands only when its story
passes on the current target.

- G001: Given <target state>, when <group lands>, then <observable result>.
