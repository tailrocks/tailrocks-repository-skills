// Order the attempts of one check. A later attempt has a higher check-run
// database id. Start times can tie or be missing, so the id comes first.

interface Attempt {
  readonly runId: number | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/**
 * Sort oldest first. When every attempt has a database id, the id decides and
 * the start time only breaks a tie. A status context has no id, so a list with
 * one of them falls back to the start time. An attempt that has not started (a
 * queued re-run) counts as the newest one in that fallback.
 */
export function oldestFirst<T extends Attempt>(attempts: readonly T[]): readonly T[] {
  const byId = attempts.length > 0 && attempts.every((a) => a.runId !== null);
  const stamp = (a: T): string => a.startedAt ?? a.completedAt ?? "￿";
  const indexed = attempts.map((attempt, index) => ({ attempt, index }));
  indexed.sort((a, b) => {
    if (byId) {
      const diff = (a.attempt.runId ?? 0) - (b.attempt.runId ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return stamp(a.attempt).localeCompare(stamp(b.attempt)) || a.index - b.index;
  });
  return indexed.map((entry) => entry.attempt);
}

export function newestOf<T extends Attempt>(attempts: readonly T[]): T | undefined {
  return oldestFirst(attempts).at(-1);
}
