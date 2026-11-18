# Thread classes

The script puts each unresolved thread in one class. The class is advice, with
the exceptions in the last column.

| Class | When | What you do | The script enforces |
| --- | --- | --- | --- |
| `fix` | The first comment matches `threads.fix_pattern`, or the pattern does not compile. | Fix the code, push, then `fix`. | `defer` is refused. |
| `defer` | A bot thread that does not match the fix pattern. | `defer`. No code change. | None. |
| `human-question` | The latest comment of a person asks a question or asks for a review. | Answer with `reply-only`. | `fix` and `defer` are refused. The thread stays open. |
| `human-other` | Any other thread of a person. | Reply with the reason. `fix`, `defer`, or `reply-only`. | A reply text is required. |

A bot is a login in `threads.bots`, a login that ends with `[bot]`, or an account
that GitHub types as a bot. The PR author and the current `gh` user are never
"a person". A question counts as open until the same person writes again without
a question. A question mark in code, in a quote, or in a link does not count.

## Waiting

The `waiting for` field says who acts next.

- `agent`: you must decide or reply.
- `human`: you replied last on a thread of a person. Only that person acts.

A thread of a bot always waits for the agent, because a bot never closes a thread.

## Replies

| Action | Reply text posted |
| --- | --- |
| `fix` | Your `reply` (or `Fixed.` for a bot thread), then `Fixed in <commit URL>`. |
| `defer` | The policy `threads.defer_reply`, then your `reply` when you give one. |
| `reply-only` | Your `reply`, then `Fixed in <commit URL>` when you name a `fixCommit`. |

`fix` and `defer` resolve the thread after the reply. `reply-only` never
resolves. A reply must have 1 to 60000 characters.

## Decisions file

The file is strict JSON. An unknown key is an error. Keys:

- `schema`: the number 1.
- `expectHead`: optional. The full head commit id. The run is refused when the head differs.
- `decisions`: a list. Each item has `id`, `action`, and optionally `reply` and `fixCommit`.
