// Facade for the safety layer (design section 8). The guards are allow-lists:
// anything not named here is refused.

export { ALLOWED, SafetyError, assertAllowed, refuse } from "./guard.ts";
export type { Guard } from "./guard.ts";
export { checkGh, ghMutationArgv } from "./safety-gh.ts";
export type { GhMutation } from "./safety-gh.ts";
export { checkGit, checkGitDcoPush } from "./safety-git.ts";
