// Stop signals. A watcher that harness code stops with one of these signals
// must remove its lock before it ends.

export const STOP_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

export type StopSignal = (typeof STOP_SIGNALS)[number];

/** Run `handler` once on a stop signal. Returns a function that removes the handlers. */
export function onStopSignal(handler: (signal: StopSignal) => void): () => void {
  const installed = STOP_SIGNALS.map((signal) => {
    const listener = (): void => handler(signal);
    process.on(signal, listener);
    return { signal, listener };
  });
  return () => {
    for (const { signal, listener } of installed) {
      process.off(signal, listener);
    }
  };
}
