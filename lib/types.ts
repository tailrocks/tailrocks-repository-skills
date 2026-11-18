// Shared branded types and small parse helpers.

export type Sha = string & { readonly __brand: "Sha" };
export type RepoSlug = string & { readonly __brand: "RepoSlug" };

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function isSha(text: string): boolean {
  return SHA_PATTERN.test(text);
}

export function parseSha(text: string): Parsed<Sha> {
  if (!SHA_PATTERN.test(text)) {
    return { ok: false, error: "expected a 40-character lowercase hex commit id" };
  }
  return { ok: true, value: text as Sha };
}

export function parseRepoSlug(text: string): Parsed<RepoSlug> {
  if (!REPO_SLUG_PATTERN.test(text) || text.includes("..")) {
    return { ok: false, error: "expected a repository in owner/name form" };
  }
  return { ok: true, value: text as RepoSlug };
}
