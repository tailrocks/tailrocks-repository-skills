# Review handoff shape

Report each prepared candidate with this identity tuple:

```text
base repository
head repository
head ref
base ref
planned group
current head OID
```

Include the coverage result for the group. Include the target object ID
used for the comparison. State the next owner: the coordinator,
`tailrocks-create-pr`, or `tailrocks-refresh-pr`. If the handoff cannot
reach its owner, state the missing route explicitly.
