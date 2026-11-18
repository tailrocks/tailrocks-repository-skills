// Text and JSON output of the thread triage. Comment text is untrusted: the
// excerpts drop control characters (no terminal escapes) and stay short.

import type { PrSnapshot } from "../status/types.ts";
import type { ApplyResult } from "./apply.ts";
import type { ClassifiedThread } from "./types.ts";

export const EXIT_DONE = 0;
export const EXIT_WAITING = 10;
export const EXIT_BLOCKED = 20;

export function excerpt(text: string, max: number): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** 0 when nothing is open. 10 when only people can act. 20 when the agent must act. */
export function exitForOpen(open: readonly ClassifiedThread[]): number {
  if (open.length === 0) {
    return EXIT_DONE;
  }
  return open.every((t) => t.awaiting === "human") ? EXIT_WAITING : EXIT_BLOCKED;
}

function place(t: ClassifiedThread): string {
  const { path, line } = t.detail;
  return path === null ? "(no file)" : `${path}${line === null ? "" : `:${line}`}`;
}

export function nextAction(open: readonly ClassifiedThread[]): string {
  if (open.length === 0) {
    return "No unresolved review threads. Run pr-status for the verdict.";
  }
  if (open.every((t) => t.awaiting === "human")) {
    return "Wait. Only the people who asked can close these threads.";
  }
  return "Decide each thread marked agent, write the decisions file, and run apply.";
}

export function threadObject(t: ClassifiedThread) {
  const last = t.detail.recent[t.detail.recent.length - 1] ?? t.detail.first;
  return {
    id: t.detail.id,
    class: t.class,
    awaiting: t.awaiting,
    isBot: t.isBot,
    author: t.detail.first.author,
    path: t.detail.path,
    line: t.detail.line,
    isOutdated: t.detail.isOutdated,
    commentCount: t.detail.commentCount,
    reason: t.reason,
    first: { author: t.detail.first.author, url: t.detail.first.url, excerpt: excerpt(t.detail.first.body, 600) },
    last: { author: last.author, url: last.url, excerpt: excerpt(last.body, 600) },
  };
}

export interface PlanView {
  readonly snapshot: PrSnapshot;
  readonly agent: string | null;
  readonly open: readonly ClassifiedThread[];
  readonly problems: readonly string[];
}

export function renderPlanText(view: PlanView): string {
  const { snapshot, open } = view;
  const lines = [`${snapshot.repo}#${snapshot.number}: ${open.length} unresolved review thread${open.length === 1 ? "" : "s"} (head ${snapshot.headSha.slice(0, 7)})`];
  for (const p of view.problems) {
    lines.push(`  problem: ${p}`);
  }
  for (const t of open) {
    const last = t.detail.recent[t.detail.recent.length - 1] ?? t.detail.first;
    lines.push(
      `  ${t.detail.id} [${t.class}] ${t.isBot ? "bot" : "person"} ${t.detail.first.author} ${place(t)}${t.detail.isOutdated ? " (outdated)" : ""}`,
      `      first: ${excerpt(t.detail.first.body, 160)}`,
      `      last (${last.author}): ${excerpt(last.body, 160)}`,
      `      ${t.reason}; waiting for: ${t.awaiting}`,
    );
  }
  lines.push(`next: ${nextAction(open)}`);
  return lines.join("\n");
}

export function planObject(view: PlanView, exit: number) {
  return {
    schema: 1,
    mode: "plan",
    repo: view.snapshot.repo,
    number: view.snapshot.number,
    headSha: view.snapshot.headSha,
    agent: view.agent,
    problems: view.problems,
    exit,
    next: nextAction(view.open),
    unresolved: view.open.map(threadObject),
  };
}

export function renderApplyText(result: Exclude<ApplyResult, { readonly kind: "policy" }>, repoLabel: string): string {
  if (result.kind === "refused") {
    return [`${repoLabel}: REFUSED, nothing was written`, ...result.reasons.map((r) => `  ${r}`)].join("\n");
  }
  const lines = [`${repoLabel}: applied ${result.outcomes.length} decision${result.outcomes.length === 1 ? "" : "s"} (head ${result.headSha.slice(0, 7)})`];
  for (const o of result.outcomes) {
    lines.push(`  ${o.id} ${o.action}: ${o.note}`);
  }
  if (result.aborted !== null) {
    lines.push(`ABORTED: ${result.aborted}`);
  }
  if (result.finalError !== null) {
    lines.push(`cannot read the threads again: ${result.finalError}`);
  }
  if (result.remaining !== null) {
    lines.push(`remaining unresolved: ${result.remaining.length}`);
    for (const t of result.remaining) {
      lines.push(`  ${t.detail.id} [${t.class}] ${place(t)} waiting for: ${t.awaiting}`);
    }
    lines.push(`next: ${nextAction(result.remaining)}`);
  }
  return lines.join("\n");
}

export function applyObject(result: Exclude<ApplyResult, { readonly kind: "policy" }>, repoLabel: string, exit: number) {
  if (result.kind === "refused") {
    return { schema: 1, mode: "apply", repo: repoLabel, refused: true, reasons: result.reasons, exit };
  }
  return {
    schema: 1,
    mode: "apply",
    repo: repoLabel,
    refused: false,
    headSha: result.headSha,
    aborted: result.aborted,
    finalError: result.finalError,
    exit,
    outcomes: result.outcomes,
    remaining: result.remaining === null ? null : result.remaining.map(threadObject),
    next: result.remaining === null ? "Run plan again." : nextAction(result.remaining),
  };
}
