// Typed readers for untrusted JSON. Each reader checks the shape and throws
// ReadError with the path of the bad value. No `as` cast touches external data.

export type Obj = { readonly [key: string]: unknown };

export class ReadError extends Error {
  override readonly name = "ReadError";
}

export function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function obj(value: unknown, where: string): Obj {
  if (!isObj(value)) {
    throw new ReadError(`${where}: expected an object`);
  }
  return value;
}

export function arr(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ReadError(`${where}: expected an array`);
  }
  return value;
}

export function str(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new ReadError(`${where}: expected a string`);
  }
  return value;
}

export function num(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReadError(`${where}: expected a number`);
  }
  return value;
}

export function bool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new ReadError(`${where}: expected a boolean`);
  }
  return value;
}

/** A string, or null when the value is null or absent. */
export function strOrNull(value: unknown, where: string): string | null {
  return value === null || value === undefined ? null : str(value, where);
}

export function numOrNull(value: unknown, where: string): number | null {
  return value === null || value === undefined ? null : num(value, where);
}

/** One of the listed literals. The result type is the literal union. */
export function oneOf<const T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  const hit = allowed.find((candidate) => candidate === value);
  if (hit === undefined) {
    throw new ReadError(`${where}: unexpected value ${JSON.stringify(value)}`);
  }
  return hit;
}

/** Read a member of an object. Missing members give undefined. */
export function member(o: Obj, key: string): unknown {
  return o[key];
}

/** Read a nested path. A null or missing step gives undefined. */
export function path(value: unknown, ...keys: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isObj(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/** Parse JSON text. Throws ReadError on bad text. */
export function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ReadError(`${where}: not valid JSON`);
  }
}
