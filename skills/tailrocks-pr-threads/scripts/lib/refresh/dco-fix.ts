// `refresh dco-fix`: the DCO-only force-push exception. The rewrite, its
// verification, and the push live in lib/dco.ts. This file adds the parts
// around them: the temporary worktree, the fresh read of the PR, the optional
// dequeue, and the PR comment.

import { SafetyError } from "../guard.ts";
import { dcoRefusal, executeDcoFix } from "../dco.ts";
import { scrub } from "../proc.ts";
import type { Sha } from "../types.ts";
import { confirmHead, reread, type PrContext, type RefreshDeps } from "./context.ts";
import { GitFailure, mustSha, repoAt, yesNo } from "./gitx.ts";
import { blocked, done, type Outcome } from "./outcome.ts";
import { withNotes } from "./sync.ts";
import { withWorktree } from "./worktree.ts";

export function dcoComment(count: number, oldHead: string, newHead: string): string {
  return `Added missing DCO sign-off to ${count} commit${count === 1 ? "" : "s"}; trees unchanged (old \`${oldHead}\` → new \`${newHead}\`)`;
}

/** Run the DCO fix. Never throws: a failure is a blocked outcome. */
export async function runDcoFix(deps: RefreshDeps, ctx: PrContext): Promise<Outcome> {
  const notes: string[] = [];
  try {
    return withNotes(await dcoFix(deps, ctx, notes), notes);
  } catch (error) {
    const reason = error instanceof Error ? scrub(error.message) : "failed";
    const code = error instanceof SafetyError ? "safety_refused" : error instanceof GitFailure ? "git_failed" : "failed";
    return blocked(code, `${reason}; check the remote branch before you run the mode again`, "run pr-status, then try again");
  }
}

async function dcoFix(deps: RefreshDeps, ctx: PrContext, notes: string[]): Promise<Outcome> {
  const { snapshot, policy } = ctx;
  const refusal = dcoRefusal(snapshot, policy, ctx.ghUser);
  if (refusal !== null) {
    return blocked(refusal.code, refusal.headline, refusal.next);
  }
  const origin = repoAt(deps.cwd, deps.git);
  const fetched = await origin.run(["fetch", "--no-tags", "--quiet", deps.remote, snapshot.headRef, snapshot.baseRef]);
  if (fetched.code !== 0) {
    return blocked("fetch_failed", `cannot fetch from ${deps.remote}: ${fetched.stderr.trim().split("\n")[0] ?? ""}`, "check the remote, then run the mode again");
  }
  const remoteHead = await mustSha(origin, ["rev-parse", `${deps.remote}/${snapshot.headRef}^{commit}`]);
  if (remoteHead !== snapshot.headSha) {
    return blocked("remote_moved", `the remote branch is at ${remoteHead.slice(0, 7)}, not ${snapshot.headSha.slice(0, 7)}; nothing was pushed`, "run the mode again");
  }
  if (!(await yesNo(origin, ["cat-file", "-e", `${snapshot.baseSha}^{commit}`]))) {
    return blocked("base_missing", "the base commit is not in the local clone after the fetch", "run pr-status, then try again");
  }

  const result = await withWorktree({ cwd: deps.cwd, root: deps.worktreeRoot, runner: deps.git, onProblem: (note) => notes.push(note) }, snapshot.headSha, ({ repo }) =>
    executeDcoFix({
      snapshot,
      policy,
      ghUser: ctx.ghUser,
      remote: deps.remote,
      repo,
      prepare: async () => {
        const again = await reread(deps, ctx, snapshot.headSha, policy.dco.dequeue_for_fix);
        if (!again.ok) {
          return { code: again.outcome.code, message: again.outcome.headline };
        }
        const entry = again.snapshot.queueEntry;
        if (entry !== null) {
          const dequeued = await deps.mutate({ kind: "dequeuePullRequest", entryId: entry.id });
          if (dequeued.code !== 0) {
            return { code: "dequeue_failed", message: `cannot dequeue the PR: ${dequeued.stderr.trim().split("\n")[0] ?? ""}` };
          }
        }
        return null;
      },
      ...(deps.beforeLease === undefined ? {} : { beforeLease: deps.beforeLease }),
    }),
  );

  switch (result.kind) {
    case "refused":
      return blocked(result.refusal.code, result.refusal.headline, result.refusal.next, result.details);
    case "unchanged": {
      const mismatched = result.mismatched ?? [];
      return done(
        result.headline,
        mismatched.length === 0
          ? []
          : [`${mismatched.length} commit(s) carry a sign-off of another identity than the author: ${mismatched.join(", ")}`, "a DCO check that matches the sign-off to the author can still fail for them; ask the author to sign off"],
        { pushed: false, head: snapshot.headSha, signoffMismatch: [...mismatched] },
      );
    }
    case "aborted":
      return blocked(result.code, result.headline, result.next, result.details);
    case "rewritten": {
      const details = [
        `old head ${result.oldHead}`,
        `new head ${result.newHead}`,
        `added the trailer to ${result.trailersAdded} commit(s); ${result.reparented} more commit(s) got new parents with the same message`,
        ...result.warnings,
        ...(result.mismatched.length === 0 ? [] : [`${result.mismatched.length} commit(s) keep a sign-off of another identity than the author: ${result.mismatched.join(", ")}`]),
      ];
      const carry = policy.review.source === "comment-verdict" && policy.review.carry_over === "clean-base-merge";
      details.push(
        carry
          ? "a review of the old head still counts: the policy carries a review across a trailer-only rewrite"
          : "the policy does not carry a review across a rewrite: a new review of the new head is necessary",
      );
      const data = {
        pushed: true,
        oldHead: result.oldHead,
        newHead: result.newHead,
        trailersAdded: result.trailersAdded,
        reviewCarried: carry,
      };
      const posted = await deps.mutate({
        kind: "issue-comment",
        repo: ctx.repo,
        number: ctx.number,
        body: dcoComment(result.trailersAdded, result.oldHead, result.newHead),
      });
      if (posted.code !== 0) {
        return blocked(
          "comment_failed",
          `pushed ${result.newHead.slice(0, 7)}, but the PR comment failed: ${posted.stderr.trim().split("\n")[0] ?? ""}`,
          "post the comment by hand",
          details,
          data,
        );
      }
      const lag = await confirmHead(deps, ctx, result.newHead);
      if (lag !== null) {
        details.push(lag);
      }
      return done(
        `added the DCO sign-off; ${result.oldHead.slice(0, 7)} -> ${result.newHead.slice(0, 7)}`,
        details,
        data,
        carry ? "none" : `request a new review of ${result.newHead.slice(0, 7)}`,
      );
    }
  }
}
