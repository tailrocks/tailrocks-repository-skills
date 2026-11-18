# Thread classes

The script puts each unresolved thread in one class. The class is a heuristic.
It finds most open questions of people, not all. Your judgement backs it. The
script enforces the rules in the last column.

| Class | When | What you do | The script enforces |
| --- | --- | --- | --- |
| `fix` | The first comment matches `threads.fix_pattern` (P1: must fix), or the pattern does not compile. | Fix the code, push, then `fix`. | `defer` is refused. |
| `defer` | A bot thread that does not match the fix pattern. | `defer`. No code change in this PR. | None. |
| `human-question` | A person asked a question or asked for a review, and did not close it. | Answer with `reply-only`. | `fix`, `defer`, and `reply-resolve` are refused. The thread stays open. |
| `human-other` | Any other thread of a person. | Reply with the reason. `fix`, `defer`, `reply-resolve`, or `reply-only`. | A reply text is required. |

## Who is a person

A bot is a login in `threads.bots`, a login that ends with `[bot]`, or an account
that GitHub types as a bot. The PR author and the current `gh` user are not
"a person". Every other account is a person. When `gh api user` fails, the script
does not know the agent, and the agent's own comments look like a person's.

## Open questions

The script reads every comment of the thread, page by page. A comment of a
person is a question when it has a question mark (also the full-width one), a
request for a review or a look ("could you review", "please take a look", "can
you check", "PTAL"), or words such as "I wonder" or "explain". A question mark in
code, in a quote, or in a link does not count.

A question stays open until the same person writes a short closing reply
("thanks, resolved", "ok", "LGTM"). A later comment that is not a closing reply,
such as a nit, does not close it. A reply of someone else does not close it.
When a person asked a question, the thread waits for that person.

The script reads the thread again before each resolve and stops when any new
comment arrived (see `lastCommentId`).

## Waiting

The `waiting for` field says who acts next.

- `agent`: you must decide or reply.
- `human`: you replied last on a thread of a person. Only that person acts.

A thread of a bot always waits for the agent, because a bot never closes a thread.

## Actions

| Action | Use | Reply text posted | Resolves |
| --- | --- | --- | --- |
| `fix` | You fixed it and pushed. Needs `fixCommit`. | Your `reply` (or `Fixed.` for a bot thread), then `Fixed in <commit URL>`. | Yes |
| `defer` | Not in scope. | The policy `threads.defer_reply`, then your `reply` when you give one. | Yes |
| `reply-only` | A person waits for an answer, or you are not done. | Your `reply`, then `Fixed in <commit URL>` when you name a `fixCommit`. | No |
| `reply-resolve` | A `human-other` thread that asks nothing. | Your `reply`. It is required. | Yes |

A thread of a person always needs a reply text. A reply has at most 60000
characters. The script checks every reply before it writes the first one. An
empty reply is an error. Each reply ends with a hidden marker line
(`<!-- pr-threads:... -->`). A second run finds its reply by the marker only, and does not post it again. The
same words from someone else ("Thanks.") never count.

## confirmedNoOpenQuestion

A decision that resolves a thread (`fix`, `defer`, `reply-resolve`) must carry
`"confirmedNoOpenQuestion": true` when a person wrote anywhere in the thread,
whatever its class. Set it only
after you read the whole thread and no one waits for an answer. When in doubt,
use `reply-only`.

## lastCommentId and planAt

Plan prints `lastCommentId` for each thread and one `planAt` for the run. A
decision that resolves a thread (`fix`, `defer`, `reply-resolve`) must carry
`lastCommentId`, and the file must carry `planAt`. They bind the decision, and
its `confirmedNoOpenQuestion`, to the thread as you read it. The script reads the
thread again before each resolve. A comment after `lastCommentId` from anyone but
our own reply (a person, a bot, anyone) stops the resolve: "new comment since
plan; run plan again". A comment that GitHub shows as edited after `planAt`
(`lastEditedAt` or `updatedAt`) counts the same way: "comment edited since plan;
run plan again". A time that the script cannot read counts as an edit.
`reply-only` needs neither.

## Decisions file

The file is strict JSON. An unknown key is an error. Keys:

- `schema`: the number 1.
- `expectHead`: optional. The full head commit id. The run is refused when the head differs.
- `planAt`: the `planAt` time of the plan. Needed when any decision resolves a thread.
- `decisions`: a list. Each item has `id`, `action`, and optionally `reply`, `fixCommit`, `confirmedNoOpenQuestion`, and `lastCommentId` (needed to resolve).
