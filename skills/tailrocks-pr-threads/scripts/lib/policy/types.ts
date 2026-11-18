// Typed view of schemas/pr-policy.schema.json. Key names match the TOML keys.

export interface PolicyPrepushStep {
  readonly name: string;
  readonly run: readonly string[];
  readonly cwd: string;
  readonly when_changed: readonly string[];
}

export interface PolicyRegenerateStep {
  readonly name: string;
  readonly run: readonly string[];
  readonly cwd: string;
  readonly when_changed: readonly string[];
  readonly outputs: readonly string[];
}

export interface PolicyInventory {
  readonly name: string;
  readonly file: string;
  readonly added: readonly string[];
  readonly exclude: readonly string[];
  readonly group_depth: number;
  readonly update: readonly string[];
}

export interface PolicyGate {
  readonly name: string;
  readonly kind: "label-absent" | "label-present" | "check-pass";
  readonly value: string;
}

export interface Policy {
  readonly schema: 1;
  readonly branches: {
    readonly protected: readonly string[];
    readonly name_pattern: string;
    readonly bases: readonly string[];
  };
  readonly checks: {
    readonly required: readonly string[];
    readonly flaky: readonly string[];
    readonly flaky_reruns: number;
    readonly accept_skipped: readonly string[];
    readonly base_sensitive: readonly string[];
    readonly cancellation_is_load: boolean;
    readonly watched_workflows: readonly string[];
  };
  readonly review: {
    readonly source: "github-approval" | "comment-verdict";
    readonly reviewers: readonly string[];
    readonly count_author: boolean;
    readonly approve_pattern: string;
    readonly changes_pattern: string;
    readonly blocking_pattern: string;
    readonly flags: string;
    readonly carry_over: "none" | "clean-base-merge";
    readonly max_carry_merges: number;
    readonly rerequest: { readonly comment: string; readonly reviewers: readonly string[] };
  };
  readonly threads: {
    readonly bots: readonly string[];
    readonly fix_pattern: string;
    readonly defer_reply: string;
  };
  readonly dco: {
    readonly required: boolean;
    readonly bot_authors: readonly string[];
    readonly bot_commits: "exempt" | "rewrite";
    readonly fix: "rewrite-trailers" | "report";
    readonly dequeue_for_fix: boolean;
  };
  readonly merge: {
    readonly method: "squash" | "merge" | "rebase";
    readonly queue: "auto" | "required" | "never";
    readonly jump: "never" | "labelled";
    readonly jump_labels: readonly string[];
    readonly delete_branch: "own-only" | "never";
    readonly high_risk_paths: readonly string[];
    readonly watch_interval_seconds: number;
  };
  readonly draft: {
    readonly create_as_draft: boolean;
    readonly ready_when: "immediately" | "checks-and-review" | "manual";
  };
  readonly labels: {
    readonly pr_ci: "always" | "label";
    readonly run_once: string;
    readonly run_always: string;
  };
  readonly ci: {
    readonly congestion_queue_length: number;
    readonly max_refreshes: number;
    readonly max_refreshes_congested: number;
  };
  readonly issues: {
    readonly link: "closes-when-complete";
    readonly done_when_heading: string;
    readonly done_when: "block" | "warn" | "off";
  };
  readonly pr_body: {
    readonly sections: readonly string[];
    readonly template: string;
    readonly footer: string;
    readonly enforce: boolean;
  };
  readonly prepush: readonly PolicyPrepushStep[];
  readonly regenerate: readonly PolicyRegenerateStep[];
  readonly inventories: readonly PolicyInventory[];
  readonly gates: readonly PolicyGate[];
  readonly fleet: { readonly freeze: boolean; readonly hold: readonly number[] };
}

export type PolicySource = "base-branch" | "local" | "default";

export interface PolicyError {
  /** JSON pointer into the policy file ("" is the whole file). */
  readonly pointer: string;
  readonly message: string;
}

export type PolicyResult =
  | { readonly ok: true; readonly policy: Policy; readonly source: PolicySource }
  | {
      readonly ok: false;
      readonly errors: readonly PolicyError[];
      /** True when the file could not be read (a transient failure). False: it was read and is invalid. */
      readonly unreadable?: boolean;
    };
