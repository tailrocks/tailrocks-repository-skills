// Capability for the DCO-only force-with-lease push (design section 7).
//
// Only the DCO module (lib/dco.ts, added later) may call `mintDcoCapability`.
// tests/safety.test.ts scans the source tree and fails when any other file
// references it. The class has a private constructor and a private field, so
// no other module can build a look-alike value.

import type { Sha } from "./types.ts";

export interface DcoGrant {
  readonly branch: string;
  readonly oldHead: Sha;
  readonly newHead: Sha;
}

// Not exported: only `mint` can pass it, so `new DcoCapability(...)` fails at run time too.
const MINT_TOKEN = Symbol("dco-capability-mint");

export class DcoCapability {
  readonly #grant: DcoGrant;

  private constructor(grant: DcoGrant, token: symbol) {
    if (token !== MINT_TOKEN) {
      throw new TypeError("a DCO capability can be minted only by the DCO module");
    }
    this.#grant = grant;
  }

  get grant(): DcoGrant {
    return this.#grant;
  }

  /** Internal factory. Call it only from the DCO module. */
  static mint(grant: DcoGrant): DcoCapability {
    return new DcoCapability({ ...grant }, MINT_TOKEN);
  }
}

export function mintDcoCapability(grant: DcoGrant): DcoCapability {
  return DcoCapability.mint(grant);
}
