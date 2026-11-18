// Core of the allow-list guards. A guard is a pure function: it takes an
// argv and returns a decision. It never spawns anything.

export type Guard =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export const ALLOWED: Guard = { allowed: true };

export function refuse(reason: string): Guard {
  return { allowed: false, reason };
}

export class SafetyError extends Error {
  override readonly name = "SafetyError";
}

export function assertAllowed(guard: Guard, what: string): void {
  if (!guard.allowed) {
    throw new SafetyError(`${what} refused: ${guard.reason}`);
  }
}

/** True when the token looks like a command-line flag. */
export function isFlag(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}
