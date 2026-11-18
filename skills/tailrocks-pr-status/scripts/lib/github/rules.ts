// Branch rules from two REST sources: the rules API and classic branch
// protection. The merge queue comes from GraphQL (see gather.ts).

import type { RepoSlug } from "../types.ts";
import type { RequiredCheck, RulesFacts } from "../status/types.ts";
import { type GhRun, isNotFound } from "./graphql.ts";
import { arr, bool, isObj, member, num, numOrNull, parseJson, path, ReadError, str } from "./read.ts";

export const EMPTY_RULES: RulesFacts = {
  requiredChecks: [],
  strictUpToDate: false,
  mergeQueue: false,
  queueLength: null,
  requiredApprovingReviewCount: 0,
  requireCodeOwnerReview: false,
  dismissStaleReviewsOnPush: false,
  threadResolutionRequired: false,
  allowedMergeMethods: [],
  known: true,
};

function appId(value: unknown): number | null {
  const id = numOrNull(value, "app id");
  return id === null || id <= 0 ? null : id;
}

function merge(a: RulesFacts, b: Partial<RulesFacts>): RulesFacts {
  const seen = new Set(a.requiredChecks.map((c) => `${c.name}\u0000${c.appId ?? ""}`));
  const added = (b.requiredChecks ?? []).filter((c) => !seen.has(`${c.name}\u0000${c.appId ?? ""}`));
  return {
    ...a,
    requiredChecks: [...a.requiredChecks, ...added],
    strictUpToDate: a.strictUpToDate || (b.strictUpToDate ?? false),
    requiredApprovingReviewCount: Math.max(a.requiredApprovingReviewCount, b.requiredApprovingReviewCount ?? 0),
    requireCodeOwnerReview: a.requireCodeOwnerReview || (b.requireCodeOwnerReview ?? false),
    dismissStaleReviewsOnPush: a.dismissStaleReviewsOnPush || (b.dismissStaleReviewsOnPush ?? false),
    threadResolutionRequired: a.threadResolutionRequired || (b.threadResolutionRequired ?? false),
    mergeQueue: a.mergeQueue || (b.mergeQueue ?? false),
    allowedMergeMethods: [...new Set([...a.allowedMergeMethods, ...(b.allowedMergeMethods ?? [])])],
  };
}

/** Parse `GET repos/{r}/rules/branches/{base}`. */
export function parseRulesetRules(text: string): Partial<RulesFacts> {
  let facts = EMPTY_RULES;
  for (const rule of arr(parseJson(text, "rules"), "rules")) {
    if (!isObj(rule)) {
      throw new ReadError("rules: expected an object");
    }
    const type = str(member(rule, "type"), "rule.type");
    const parameters = member(rule, "parameters");
    if (type === "required_status_checks" && isObj(parameters)) {
      const checks: RequiredCheck[] = arr(member(parameters, "required_status_checks"), "required_status_checks").map((c) => ({
        name: str(path(c, "context"), "required check context"),
        appId: appId(path(c, "integration_id")),
        source: "ruleset",
      }));
      facts = merge(facts, {
        requiredChecks: checks,
        strictUpToDate: member(parameters, "strict_required_status_checks_policy") === true,
      });
    } else if (type === "pull_request" && isObj(parameters)) {
      facts = merge(facts, {
        requiredApprovingReviewCount: num(member(parameters, "required_approving_review_count"), "required_approving_review_count"),
        requireCodeOwnerReview: bool(member(parameters, "require_code_owner_review"), "require_code_owner_review"),
        dismissStaleReviewsOnPush: bool(member(parameters, "dismiss_stale_reviews_on_push"), "dismiss_stale_reviews_on_push"),
        threadResolutionRequired: bool(member(parameters, "required_review_thread_resolution"), "required_review_thread_resolution"),
        allowedMergeMethods: arr(member(parameters, "allowed_merge_methods") ?? [], "allowed_merge_methods").map((m) => str(m, "merge method")),
      });
    } else if (type === "merge_queue") {
      facts = merge(facts, { mergeQueue: true });
    }
  }
  return facts;
}

/** Parse `GET repos/{r}/branches/{base}`. An absent `protection` object gives no facts. */
export function parseClassicProtection(text: string): Partial<RulesFacts> {
  const protection = path(parseJson(text, "branch"), "protection");
  if (!isObj(protection)) {
    return {};
  }
  const status = member(protection, "required_status_checks");
  const checks: RequiredCheck[] = isObj(status) && Array.isArray(member(status, "checks"))
    ? arr(member(status, "checks"), "checks").map((c) => ({
        name: str(path(c, "context"), "protection check context"),
        appId: appId(path(c, "app_id")),
        source: "protection" as const,
      }))
    : [];
  const reviews = member(protection, "required_pull_request_reviews");
  const resolution = path(protection, "required_conversation_resolution", "enabled");
  return {
    requiredChecks: checks,
    strictUpToDate: isObj(status) && member(status, "strict") === true,
    requiredApprovingReviewCount: isObj(reviews) ? (numOrNull(member(reviews, "required_approving_review_count"), "count") ?? 0) : 0,
    requireCodeOwnerReview: isObj(reviews) && member(reviews, "require_code_owner_reviews") === true,
    dismissStaleReviewsOnPush: isObj(reviews) && member(reviews, "dismiss_stale_reviews") === true,
    threadResolutionRequired: resolution === true,
  };
}

export interface RulesResult {
  readonly rules: RulesFacts;
  readonly problems: readonly string[];
}

/** Read both sources. A 404 means no rules. Another failure makes `known` false. */
export async function gatherRules(run: GhRun, repo: RepoSlug, base: string): Promise<RulesResult> {
  const encoded = base.split("/").map(encodeURIComponent).join("/");
  const problems: string[] = [];
  let facts = EMPTY_RULES;
  const sources: readonly { readonly name: string; readonly endpoint: string; readonly parse: (text: string) => Partial<RulesFacts>; readonly tolerate403: boolean }[] = [
    { name: "rules API", endpoint: `repos/${repo}/rules/branches/${encoded}`, parse: parseRulesetRules, tolerate403: false },
    { name: "branch protection", endpoint: `repos/${repo}/branches/${encoded}`, parse: parseClassicProtection, tolerate403: true },
  ];
  for (const source of sources) {
    const result = await run(["api", "-X", "GET", source.endpoint]);
    if (result.code !== 0) {
      if (!isNotFound(result) && !(source.tolerate403 && /\bHTTP 403\b/.test(result.stderr))) {
        problems.push(`${source.name} could not be read: ${result.stderr.trim().split("\n")[0] ?? ""}`);
        facts = { ...facts, known: false };
      }
      continue;
    }
    try {
      facts = merge(facts, source.parse(result.stdout));
    } catch (error) {
      problems.push(`${source.name}: ${error instanceof ReadError ? error.message : "unreadable"}`);
      facts = { ...facts, known: false };
    }
  }
  return { rules: facts, problems };
}

