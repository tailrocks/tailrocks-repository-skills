// Capability for the DCO-only force-with-lease push (design section 7).
//
// Only the DCO module (lib/dco.ts, added later) may call `mintDcoCapability`.
// tests/safety-git.test.ts scans the source tree and fails when any other file
// names it or builds a `DcoCapability` directly. The constructor is private and
// checks a module-private token, and the only factory is a closure that the
// class body captures. No static `mint` exists, so no other path leads to a
// value that passes `instanceof DcoCapability`.

import type { Sha } from "./types.ts";

export interface DcoGrant {
  readonly branch: string;
  readonly oldHead: Sha;
  readonly newHead: Sha;
}

// Not exported: a caller cannot pass it, so `new DcoCapability(...)` fails at run time too.
const MINT_TOKEN = Symbol("dco-capability-mint");

let create: ((grant: DcoGrant) => DcoCapability) | null = null;

export class DcoCapability {
  readonly #grant: DcoGrant;

  private constructor(grant: DcoGrant, token: symbol) {
    if (token !== MINT_TOKEN) {
      throw new TypeError("a DCO capability can be minted only by the DCO module");
    }
    this.#grant = grant;
  }

  static {
    create = (grant) => new DcoCapability({ ...grant }, MINT_TOKEN);
  }

  get grant(): DcoGrant {
    return this.#grant;
  }
}

export function mintDcoCapability(grant: DcoGrant): DcoCapability {
  if (create === null) {
    throw new TypeError("DcoCapability is not initialized");
  }
  return create(grant);
}
