// Turn schema-validated JSON (defaults applied) into a typed Policy, with no
// type assertions. A missing or mistyped value throws ShapeError. That can
// happen only when the schema and this builder disagree, and it fails closed.

import { isJsonObject, type JsonObject, type JsonValue } from "./schema-validate.ts";
import type { Policy } from "./types.ts";

export class ShapeError extends Error {
  override readonly name = "ShapeError";
  readonly pointer: string;
  constructor(pointer: string, message: string) {
    super(message);
    this.pointer = pointer;
  }
}

class Reader {
  readonly #object: JsonObject;
  readonly #pointer: string;

  constructor(value: JsonValue | undefined, pointer: string) {
    if (value === undefined || !isJsonObject(value)) {
      throw new ShapeError(pointer, "expected a table");
    }
    this.#object = value;
    this.#pointer = pointer;
  }

  #fail(key: string, expected: string): never {
    throw new ShapeError(`${this.#pointer}/${key}`, `expected ${expected}`);
  }

  string(key: string): string {
    const value = this.#object[key];
    return typeof value === "string" ? value : this.#fail(key, "a string");
  }

  boolean(key: string): boolean {
    const value = this.#object[key];
    return typeof value === "boolean" ? value : this.#fail(key, "a boolean");
  }

  integer(key: string): number {
    const value = this.#object[key];
    return typeof value === "number" && Number.isInteger(value) ? value : this.#fail(key, "an integer");
  }

  /** An integer that the schema gives no default: null when the key is absent. */
  integerOrNull(key: string): number | null {
    return this.#object[key] === undefined ? null : this.integer(key);
  }

  strings(key: string): readonly string[] {
    const value = this.#object[key];
    if (!Array.isArray(value)) {
      return this.#fail(key, "an array of strings");
    }
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== "string") {
        return this.#fail(key, "an array of strings");
      }
      out.push(item);
    }
    return out;
  }

  integers(key: string): readonly number[] {
    const value = this.#object[key];
    if (!Array.isArray(value)) {
      return this.#fail(key, "an array of integers");
    }
    const out: number[] = [];
    for (const item of value) {
      if (typeof item !== "number" || !Number.isInteger(item)) {
        return this.#fail(key, "an array of integers");
      }
      out.push(item);
    }
    return out;
  }

  choice<T extends string>(key: string, allowed: readonly T[]): T {
    const value = this.string(key);
    const match = allowed.find((option) => option === value);
    return match ?? this.#fail(key, `one of ${allowed.join(", ")}`);
  }

  table(key: string): Reader {
    return new Reader(this.#object[key], `${this.#pointer}/${key}`);
  }

  tables(key: string): readonly Reader[] {
    const value = this.#object[key];
    if (!Array.isArray(value)) {
      return this.#fail(key, "an array of tables");
    }
    return value.map((item, index) => new Reader(item, `${this.#pointer}/${key}/${index}`));
  }
}

export function buildPolicy(value: JsonValue): Policy {
  const root = new Reader(value, "");
  if (root.integer("schema") !== 1) {
    throw new ShapeError("/schema", "expected schema 1");
  }
  const branches = root.table("branches");
  const checks = root.table("checks");
  const review = root.table("review");
  const rerequest = review.table("rerequest");
  const threads = root.table("threads");
  const dco = root.table("dco");
  const merge = root.table("merge");
  const draft = root.table("draft");
  const labels = root.table("labels");
  const ci = root.table("ci");
  const issues = root.table("issues");
  const body = root.table("pr_body");
  const fleet = root.table("fleet");
  return {
    schema: 1,
    branches: {
      protected: branches.strings("protected"),
      name_pattern: branches.string("name_pattern"),
      bases: branches.strings("bases"),
    },
    checks: {
      required: checks.strings("required"),
      flaky: checks.strings("flaky"),
      flaky_reruns: checks.integer("flaky_reruns"),
      accept_skipped: checks.strings("accept_skipped"),
      base_sensitive: checks.strings("base_sensitive"),
      cancellation_is_load: checks.boolean("cancellation_is_load"),
      watched_workflows: checks.strings("watched_workflows"),
    },
    review: {
      source: review.choice("source", ["github-approval", "comment-verdict"]),
      reviewers: review.strings("reviewers"),
      count_author: review.boolean("count_author"),
      approve_pattern: review.string("approve_pattern"),
      changes_pattern: review.string("changes_pattern"),
      blocking_pattern: review.string("blocking_pattern"),
      flags: review.string("flags"),
      carry_over: review.choice("carry_over", ["none", "clean-base-merge"]),
      max_carry_merges: review.integer("max_carry_merges"),
      rerequest: { comment: rerequest.string("comment"), reviewers: rerequest.strings("reviewers") },
    },
    threads: {
      bots: threads.strings("bots"),
      fix_pattern: threads.string("fix_pattern"),
      defer_reply: threads.string("defer_reply"),
    },
    dco: {
      required: dco.boolean("required"),
      bot_authors: dco.strings("bot_authors"),
      bot_commits: dco.choice("bot_commits", ["exempt", "rewrite"]),
      fix: dco.choice("fix", ["rewrite-trailers", "report"]),
      dequeue_for_fix: dco.boolean("dequeue_for_fix"),
    },
    merge: {
      method: merge.choice("method", ["squash", "merge", "rebase"]),
      queue: merge.choice("queue", ["auto", "required", "never"]),
      jump: merge.choice("jump", ["never", "labelled"]),
      jump_labels: merge.strings("jump_labels"),
      delete_branch: merge.choice("delete_branch", ["own-only", "never"]),
      high_risk_paths: merge.strings("high_risk_paths"),
      watch_interval_seconds: merge.integer("watch_interval_seconds"),
    },
    draft: {
      create_as_draft: draft.boolean("create_as_draft"),
      ready_when: draft.choice("ready_when", ["immediately", "checks-and-review", "manual"]),
    },
    labels: {
      pr_ci: labels.choice("pr_ci", ["always", "label"]),
      run_once: labels.string("run_once"),
      run_always: labels.string("run_always"),
    },
    ci: {
      congestion_queue_length: ci.integer("congestion_queue_length"),
      max_refreshes: ci.integer("max_refreshes"),
      max_refreshes_congested: ci.integer("max_refreshes_congested"),
    },
    issues: {
      link: issues.choice("link", ["closes-when-complete"]),
      done_when_heading: issues.string("done_when_heading"),
      done_when: issues.choice("done_when", ["block", "warn", "off"]),
    },
    pr_body: {
      sections: body.strings("sections"),
      template: body.string("template"),
      footer: body.string("footer"),
      enforce: body.boolean("enforce"),
    },
    prepush: root.tables("prepush").map((step) => ({
      name: step.string("name"),
      run: step.strings("run"),
      cwd: step.string("cwd"),
      when_changed: step.strings("when_changed"),
    })),
    regenerate: root.tables("regenerate").map((step) => ({
      name: step.string("name"),
      run: step.strings("run"),
      cwd: step.string("cwd"),
      when_changed: step.strings("when_changed"),
      outputs: step.strings("outputs"),
    })),
    inventories: root.tables("inventories").map((inventory) => ({
      name: inventory.string("name"),
      file: inventory.string("file"),
      added: inventory.strings("added"),
      exclude: inventory.strings("exclude"),
      group_depth: inventory.integer("group_depth"),
      update: inventory.strings("update"),
    })),
    gates: root.tables("gates").map((gate) => ({
      name: gate.string("name"),
      kind: gate.choice("kind", ["label-absent", "label-present", "check-pass"]),
      value: gate.string("value"),
    })),
    fleet: {
      freeze: fleet.boolean("freeze"),
      hold: fleet.integers("hold"),
      max_merges_per_pass: fleet.integerOrNull("max_merges_per_pass"),
    },
  };
}
