// Classify a failed `git push` from the ref status lines that git prints, never
// from words anywhere in the output. Git prints one status line per ref:
//
//    ! [rejected]        <src> -> <dst> (non-fast-forward)
//    ! [rejected]        <src> -> <dst> (fetch first)
//    ! [rejected]        <src> -> <dst> (stale info)
//    ! [remote rejected] <src> -> <dst> (<reason from the remote>)
//
// `To <url>` is the first line of the push output and names no cause. Text that a
// hook prints (`remote: ...`) and text of the error summary can hold any word, so
// they never decide the class.

export type PushFailure =
  | { readonly kind: "moved"; readonly cause: string }
  | { readonly kind: "declined"; readonly cause: string }
  | { readonly kind: "other"; readonly cause: string };

const STATUS_LINE = /^\s*!\s+\[(rejected|remote rejected)\]\s+\S+\s+->\s+\S+(?:\s+\((.*)\))?\s*$/;
const MOVED_REASONS: ReadonlySet<string> = new Set(["non-fast-forward", "fetch first", "stale info"]);
const CAUSE_FALLBACK = /^(?:error|fatal):\s*\S/;

/** Classify the stderr of a failed push. `exitCode` only names the cause when git printed no usable line. */
export function classifyPush(stderr: string, exitCode: number): PushFailure {
  const lines = stderr.split("\n").map((l) => l.trimEnd());
  for (const line of lines) {
    const match = STATUS_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const reason = match[2] ?? "";
    if (match[1] === "rejected" && MOVED_REASONS.has(reason)) {
      return { kind: "moved", cause: line.trim() };
    }
    return { kind: match[1] === "remote rejected" ? "declined" : "other", cause: line.trim() };
  }
  const fallback = lines.find((l) => CAUSE_FALLBACK.test(l.trim()));
  if (fallback !== undefined) {
    return { kind: "other", cause: fallback.trim() };
  }
  const first = lines.find((l) => l.trim() !== "" && !/^To\s/.test(l.trim()));
  return { kind: "other", cause: first?.trim() ?? `exit ${exitCode}` };
}
