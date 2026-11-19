import { main, type MainOptions } from "../../lib/fleet/cli.ts";
import { buildPlan, type FleetDeps } from "../../lib/fleet/plan.ts";
import type { Plan } from "../../lib/fleet/types.ts";
import { newShared } from "../../lib/merge/types.ts";
import { parseRepoSlug } from "../../lib/types.ts";
import type { FleetWorld } from "./fleet-world.ts";
import { fakeRefresh, REPO } from "./fleet-world.ts";

export interface FleetRun {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}

export async function runFleet(world: FleetWorld, argv: readonly string[], options: Partial<MainOptions> = {}): Promise<FleetRun> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main([...argv, "--repo", REPO], {
    io: world.io,
    cwd: "/",
    env: {},
    refresh: fakeRefresh(),
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    ...options,
  });
  return { code, out, err };
}

/** Build the plan with the library, as `plan` does. */
export async function planOf(world: FleetWorld, patch: Partial<FleetDeps> = {}): Promise<Plan> {
  const slug = parseRepoSlug(REPO);
  if (!slug.ok) {
    throw new Error("slug");
  }
  const built = await buildPlan(slug.value, {
    cwd: "/",
    io: world.io,
    refresh: fakeRefresh(),
    env: {},
    gitDir: null,
    localPolicy: null,
    wait: false,
    shared: newShared(),
    ...patch,
  });
  if (!built.ok) {
    throw new Error(`plan failed with ${built.exit}: ${built.message}`);
  }
  return built.plan;
}

export function numbersOf(entries: readonly { readonly number: number }[]): readonly number[] {
  return entries.map((e) => e.number);
}
