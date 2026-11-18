// High-risk paths. The globs come from the policy key `merge.high_risk_paths`.
// A PR that touches one needs `--accept-risk` from the user. A rename counts
// when the old path or the new path matches.

import { matchesAnyGlob } from "../glob.ts";
import type { ChangedFiles } from "./github.ts";

export type Risk =
  | { readonly level: "none" }
  | { readonly level: "high"; readonly reason: string; readonly paths: readonly string[] };

export function classifyRisk(files: ChangedFiles, globs: readonly string[]): Risk {
  if (!files.known) {
    return { level: "high", reason: `the changed files are unknown (${files.reason})`, paths: [] };
  }
  const paths = [...new Set(files.files.filter((file) => matchesAnyGlob(globs, file)))];
  return paths.length === 0
    ? { level: "none" }
    : { level: "high", reason: `${paths.length} changed path${paths.length === 1 ? "" : "s"} in high-risk areas`, paths };
}
