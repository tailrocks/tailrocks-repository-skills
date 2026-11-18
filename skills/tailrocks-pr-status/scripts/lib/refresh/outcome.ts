// The result of one refresh run. Every mode returns one Outcome. The CLI maps
// it to an exit code: 0 done, 20 blocked or refused, 2 usage or policy error.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface Outcome {
  readonly exit: 0 | 2 | 20;
  readonly state: "DONE" | "BLOCKED" | "USAGE";
  /** A stable machine code, for example `conflict` or `protected_branch`. `ok` for success. */
  readonly code: string;
  readonly headline: string;
  readonly details: readonly string[];
  readonly next: string;
  readonly data: { readonly [key: string]: JsonValue };
}

export function done(
  headline: string,
  details: readonly string[] = [],
  data: { readonly [key: string]: JsonValue } = {},
  next = "none",
): Outcome {
  return { exit: 0, state: "DONE", code: "ok", headline, details, next, data };
}

export function blocked(
  code: string,
  headline: string,
  next: string,
  details: readonly string[] = [],
  data: { readonly [key: string]: JsonValue } = {},
): Outcome {
  return { exit: 20, state: "BLOCKED", code, headline, details, next, data };
}

export function usage(headline: string, details: readonly string[] = []): Outcome {
  return { exit: 2, state: "USAGE", code: "usage", headline, details, next: "fix the command line", data: {} };
}

export function renderOutcome(mode: string, outcome: Outcome): string {
  const lines = [`pr-refresh ${mode}: ${outcome.state} (${outcome.code}) - ${outcome.headline}`];
  for (const detail of outcome.details) {
    lines.push(`  ${detail}`);
  }
  if (outcome.next !== "none") {
    lines.push(`  next: ${outcome.next}`);
  }
  return lines.join("\n");
}

export function outcomeObject(mode: string, number: number | null, outcome: Outcome) {
  return {
    schema: 1,
    mode,
    pr: number,
    state: outcome.state,
    code: outcome.code,
    headline: outcome.headline,
    details: outcome.details,
    next: outcome.next,
    data: outcome.data,
  };
}
