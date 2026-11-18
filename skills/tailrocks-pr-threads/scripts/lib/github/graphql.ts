// Run one GraphQL read query through the guarded `gh` runner and parse the reply.

import type { RunResult } from "../proc.ts";
import { gh } from "../gh.ts";
import { type Obj, obj, parseJson, ReadError } from "./read.ts";

export type GhRun = (args: readonly string[]) => Promise<RunResult>;

export function defaultGh(cwd: string): GhRun {
  return (args) => gh(args, { cwd });
}

export type Variable = { readonly kind: "string"; readonly value: string } | { readonly kind: "int"; readonly value: number };

export const text = (value: string): Variable => ({ kind: "string", value });
export const int = (value: number): Variable => ({ kind: "int", value });

/**
 * Run a query constant with variables. Returns the `data` object. Throws
 * ReadError when gh fails, the reply is not JSON, or GraphQL reports errors.
 */
export async function graphql(run: GhRun, query: string, variables: Readonly<Record<string, Variable>>): Promise<Obj> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, variable] of Object.entries(variables)) {
    args.push(variable.kind === "int" ? "-F" : "-f", `${key}=${variable.value}`);
  }
  const result = await run(args);
  let reply: unknown;
  try {
    reply = parseJson(result.stdout, "graphql reply");
  } catch (error) {
    const detail = result.stderr.trim().split("\n")[0] ?? "";
    throw new ReadError(`gh api graphql failed (exit ${result.code}): ${detail || (error instanceof Error ? error.message : "")}`);
  }
  const root = obj(reply, "graphql reply");
  const errors = root["errors"];
  if (Array.isArray(errors) && errors.length > 0) {
    const first = obj(errors[0], "graphql error")["message"];
    throw new ReadError(`GraphQL error: ${typeof first === "string" ? first : "unknown"}`);
  }
  return obj(root["data"], "graphql data");
}

/** GET a REST endpoint. Returns the raw result so the caller can tolerate a 404. */
export function rest(run: GhRun, endpoint: string, raw = false): Promise<RunResult> {
  const args = ["api", "-X", "GET"];
  if (raw) {
    args.push("-H", "Accept: application/vnd.github.raw+json");
  }
  args.push(endpoint);
  return run(args);
}

export function isNotFound(result: RunResult): boolean {
  return result.code !== 0 && /\bHTTP 404\b|Not Found/i.test(result.stderr);
}
