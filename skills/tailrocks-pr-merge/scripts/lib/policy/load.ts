// Load, validate, and type the repository policy file.

import schemaFile from "../../schemas/pr-policy.schema.json" with { type: "json" };
import { buildPolicy, ShapeError } from "./build.ts";
import {
  applyDefaults,
  isJsonObject,
  type JsonValue,
  SchemaError,
  validate,
} from "./schema-validate.ts";
import type { Policy, PolicyError, PolicyResult, PolicySource } from "./types.ts";

const schema: JsonValue = toJson(schemaFile) ?? null;

/** Convert parsed data to plain JSON values. Returns undefined for anything else (dates, functions). */
function toJson(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const converted = toJson(item);
      if (converted === undefined) {
        return undefined;
      }
      items.push(converted);
    }
    return items;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries: [string, JsonValue][] = [];
    for (const [key, item] of Object.entries(value)) {
      const converted = toJson(item);
      if (converted === undefined) {
        return undefined;
      }
      entries.push([key, converted]);
    }
    return Object.fromEntries(entries);
  }
  return undefined;
}

function compileCheck(pattern: string, flags: string, pointer: string, errors: PolicyError[]): void {
  if (pattern === "") {
    return;
  }
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid regular expression";
    errors.push({ pointer, message: `does not compile as a regular expression: ${reason}` });
  }
}

function checkUniqueNames(
  items: readonly { readonly name: string }[],
  section: string,
  errors: PolicyError[],
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.name)) {
      errors.push({ pointer: `/${section}/${index}/name`, message: `duplicate name "${item.name}"` });
    }
    seen.add(item.name);
  });
}

function checkRelativeCwd(
  items: readonly { readonly cwd: string }[],
  section: string,
  errors: PolicyError[],
): void {
  items.forEach((item, index) => {
    if (item.cwd.startsWith("/") || item.cwd.split("/").includes("..")) {
      errors.push({
        pointer: `/${section}/${index}/cwd`,
        message: "must stay inside the repository (no absolute path, no ..)",
      });
    }
  });
}

/** Rules that a JSON schema cannot express: compiled regexes and cross-key rules. */
function crossChecks(policy: Policy): readonly PolicyError[] {
  const errors: PolicyError[] = [];
  const { review } = policy;
  compileCheck(policy.branches.name_pattern, "", "/branches/name_pattern", errors);
  compileCheck(review.approve_pattern, review.flags, "/review/approve_pattern", errors);
  compileCheck(review.changes_pattern, review.flags, "/review/changes_pattern", errors);
  compileCheck(review.blocking_pattern, review.flags, "/review/blocking_pattern", errors);
  compileCheck(policy.threads.fix_pattern, review.flags, "/threads/fix_pattern", errors);
  if (review.source === "comment-verdict") {
    for (const key of ["approve_pattern", "changes_pattern"] as const) {
      if (review[key] === "") {
        errors.push({ pointer: `/review/${key}`, message: 'is required when review.source is "comment-verdict"' });
      }
    }
  }
  if (review.carry_over === "clean-base-merge" && review.source !== "comment-verdict") {
    errors.push({
      pointer: "/review/carry_over",
      message: 'needs review.source "comment-verdict"; GitHub dismisses stale approvals itself',
    });
  }
  if (policy.labels.pr_ci === "label" && policy.labels.run_once === "" && policy.labels.run_always === "") {
    errors.push({ pointer: "/labels/pr_ci", message: 'needs labels.run_once or labels.run_always when pr_ci is "label"' });
  }
  if (policy.merge.jump === "labelled" && policy.merge.jump_labels.length === 0) {
    errors.push({ pointer: "/merge/jump_labels", message: 'must list at least one label when merge.jump is "labelled"' });
  }
  checkUniqueNames(policy.prepush, "prepush", errors);
  checkUniqueNames(policy.regenerate, "regenerate", errors);
  checkUniqueNames(policy.inventories, "inventories", errors);
  checkUniqueNames(policy.gates, "gates", errors);
  checkRelativeCwd(policy.prepush, "prepush", errors);
  checkRelativeCwd(policy.regenerate, "regenerate", errors);
  return errors;
}

export interface LoadRequest {
  readonly text: string;
  readonly source: "base-branch" | "local";
}

/** Parse, validate, and type a policy file. Never throws on bad input. */
export function loadPolicy(request: LoadRequest): PolicyResult {
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(request.text);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] ?? "" : "unreadable";
    return { ok: false, errors: [{ pointer: "", message: `TOML syntax error: ${reason}` }] };
  }
  const data = toJson(parsed);
  if (data === undefined || !isJsonObject(data)) {
    return {
      ok: false,
      errors: [{ pointer: "", message: "the file holds a value that JSON cannot express (for example a date)" }],
    };
  }
  return finish(data, request.source);
}

function finish(data: JsonValue, source: PolicySource): PolicyResult {
  try {
    const problems = validate(schema, data);
    if (problems.length > 0) {
      return { ok: false, errors: problems };
    }
    const policy = buildPolicy(applyDefaults(schema, data));
    const errors = crossChecks(policy);
    return errors.length > 0 ? { ok: false, errors } : { ok: true, policy, source };
  } catch (error) {
    if (error instanceof ShapeError) {
      return { ok: false, errors: [{ pointer: error.pointer, message: `internal schema mismatch: ${error.message}` }] };
    }
    if (error instanceof SchemaError) {
      return { ok: false, errors: [{ pointer: "", message: `policy schema is unusable: ${error.message}` }] };
    }
    throw error;
  }
}

/** The built-in policy: the defaults of the schema. Used when the file is absent. */
export function defaultPolicy(): PolicyResult {
  return finish({ schema: 1 }, "default");
}

/** Format errors for the terminal: one line each, with the JSON pointer. */
export function formatPolicyErrors(errors: readonly PolicyError[]): string {
  return errors.map((e) => `${e.pointer === "" ? "(file)" : e.pointer}: ${e.message}`).join("\n");
}
