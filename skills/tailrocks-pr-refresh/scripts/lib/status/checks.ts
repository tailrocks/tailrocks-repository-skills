// Check findings: required checks from every source, then the failure classes.

import type { Policy } from "../policy/types.ts";
import { finding, listCapped, short } from "./findings.ts";
import type { CheckObservation, Finding, PrSnapshot } from "./types.ts";

// GitHub counts a cancelled or stale run as failing too: it makes mergeStateStatus UNSTABLE.
const FAILED: ReadonlySet<string> = new Set(["failure", "timed_out", "startup_failure", "action_required", "cancelled", "stale"]);

interface Requirement {
  readonly name: string;
  readonly appId: number | null;
}

/** The union of GitHub's three sources and the policy list. The policy cannot remove a check. */
export function requiredChecks(snapshot: PrSnapshot, policy: Policy): readonly Requirement[] {
  const byName = new Map<string, number | null>();
  const add = (name: string, appId: number | null): void => {
    const known = byName.get(name);
    byName.set(name, known ?? appId);
  };
  for (const rule of snapshot.rules.requiredChecks) {
    add(rule.name, rule.appId);
  }
  for (const check of snapshot.checks) {
    if (check.isRequired) {
      add(check.name, null);
    }
  }
  for (const name of policy.checks.required) {
    add(name, null);
  }
  return [...byName].map(([name, appId]) => ({ name, appId }));
}

function newest(checks: readonly CheckObservation[]): CheckObservation | undefined {
  const stamp = (c: CheckObservation): string => c.startedAt ?? c.completedAt ?? "";
  return [...checks].sort((a, b) => stamp(b).localeCompare(stamp(a)))[0];
}

type Bucket =
  | "ok"
  | "pending"
  | "failed"
  | "flaky"
  | "stale_base"
  | "cancelled"
  | "not_passing"
  | "unreadable";

function classify(check: CheckObservation, snapshot: PrSnapshot, policy: Policy): Bucket {
  if (check.status !== "completed") {
    return "pending";
  }
  switch (check.conclusion) {
    case "success":
      return "ok";
    case "failure":
    case "timed_out":
    case "startup_failure":
    case "action_required": {
      if (policy.checks.base_sensitive.includes(check.name) && (snapshot.behindBy ?? 0) > 0) {
        return "stale_base";
      }
      if (policy.checks.flaky.includes(check.name)) {
        return check.failedAttempts <= policy.checks.flaky_reruns ? "flaky" : "failed";
      }
      return "failed";
    }
    case "cancelled":
    case "stale":
      return policy.checks.cancellation_is_load ? "cancelled" : "failed";
    case "skipped":
    case "neutral":
      return policy.checks.accept_skipped.includes(check.name) ? "ok" : "not_passing";
    case null:
      return "unreadable";
  }
}

function list(names: readonly string[]): string {
  return listCapped(names);
}

export function checkFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  const buckets = new Map<Bucket, string[]>();
  const put = (bucket: Bucket, text: string): void => {
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), text]);
  };
  const missing: string[] = [];
  const wrongSource: string[] = [];

  for (const requirement of requiredChecks(snapshot, policy)) {
    const candidates = snapshot.checks.filter((c) => c.name === requirement.name);
    if (candidates.length === 0) {
      missing.push(requirement.name);
      continue;
    }
    const matching =
      requirement.appId === null ? candidates : candidates.filter((c) => c.appId === requirement.appId);
    if (matching.length === 0) {
      wrongSource.push(`${requirement.name} (rule names app ${requirement.appId}, run is from ${list(candidates.map((c) => String(c.appId ?? "a status context")))})`);
      continue;
    }
    const chosen = newest(matching);
    if (chosen === undefined) {
      continue;
    }
    const bucket = classify(chosen, snapshot, policy);
    const label = chosen.conclusion === null ? `${chosen.name} (${chosen.status})` : `${chosen.name} (${chosen.conclusion})`;
    put(bucket, label);
  }

  const unfinishedWatched = snapshot.checks.filter(
    (c) => c.status !== "completed" && c.workflow !== null && policy.checks.watched_workflows.includes(c.workflow),
  );
  for (const check of unfinishedWatched) {
    put("pending", `${check.name} (workflow ${check.workflow ?? ""})`);
  }

  const labelMode = policy.labels.pr_ci === "label";
  const runLabels = [policy.labels.run_once, policy.labels.run_always].filter((l) => l !== "");
  const labelPresent = runLabels.some((l) => snapshot.labels.includes(l));

  if (missing.length > 0) {
    if (labelMode && !labelPresent) {
      out.push(
        finding(
          "ci_label_needed",
          "blocker",
          `the full suite did not run; required checks missing on ${short(snapshot.headSha)}: ${list(missing)}`,
          `Add the label "${policy.labels.run_once !== "" ? policy.labels.run_once : policy.labels.run_always}" to start the full CI run`,
          missing,
        ),
      );
    } else {
      out.push(
        finding(
          "check_missing",
          "blocker",
          `required checks have no run on ${short(snapshot.headSha)}: ${list(missing)}`,
          "Trigger CI with a push or the policy label, then run pr-status again",
          missing,
        ),
      );
    }
  }
  if (wrongSource.length > 0) {
    out.push(
      finding(
        "check_wrong_source",
        "blocker",
        `a check with the required name comes from another app: ${list(wrongSource)}`,
        "Investigate which app reports the check; do not accept the result",
        wrongSource,
      ),
    );
  }
  const emit = (bucket: Bucket, build: (names: string) => Finding): void => {
    const names = buckets.get(bucket);
    if (names !== undefined && names.length > 0) {
      out.push({ ...build(list(names)), items: names });
    }
  };
  emit("failed", (n) => finding("check_failed", "blocker", `required checks failed: ${n}`, "Read the failing log and fix the cause"));
  emit("flaky", (n) =>
    finding("check_flaky", "blocker", `flaky checks failed within the rerun allowance: ${n}`, "Re-run the failed jobs of these checks"),
  );
  emit("stale_base", (n) =>
    finding(
      "check_stale_base",
      "blocker",
      `base-sensitive checks failed while the branch is ${snapshot.behindBy ?? 0} commits behind ${snapshot.baseRef}: ${n}`,
      "pr-refresh sync (merge the base, no code change); if this check fails again after the merge, it is a real failure (check_failed)",
    ),
  );
  emit("cancelled", (n) =>
    finding("check_cancelled", "blocker", `required checks were cancelled with no failure: ${n}`, "Re-run the cancelled checks or push"),
  );
  emit("not_passing", (n) =>
    finding("check_not_passing", "blocker", `required checks ended skipped or neutral: ${n}`, "Find out why the check did not run; the policy does not accept skipped"),
  );
  emit("unreadable", (n) =>
    finding("unknown_state", "blocker", `required checks have no readable result: ${n}`, "Run pr-status again"),
  );
  const requiredNames = new Set(requiredChecks(snapshot, policy).map((r) => r.name));
  const optionalFailed = snapshot.checks
    .filter((c) => !c.isRequired && !requiredNames.has(c.name) && c.status === "completed" && c.conclusion !== null && FAILED.has(c.conclusion))
    .map((c) => `${c.name} (${c.conclusion})`);
  if (optionalFailed.length > 0) {
    out.push(
      finding(
        "non_required_failing",
        "info",
        `checks that are not required are failing: ${list([...new Set(optionalFailed)])}`,
        "None needed for the merge. Look at them when they point to a real problem",
        [...new Set(optionalFailed)],
      ),
    );
  }
  emit("pending", (n) => finding("checks_pending", "wait", `checks are not finished: ${n}`, "Watch the checks; run pr-status again when they end"));
  return out;
}
