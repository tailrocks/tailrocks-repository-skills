import { createHash } from "node:crypto";

export const mergeRequestSchema = "tailrocks.merge-pr-request/v1" as const;
export const mergeReceiptSchema = "tailrocks.merge-pr/v1" as const;

type MergeMethod = "merge" | "rebase" | "squash";

export interface MergeRequest {
  readonly schema: typeof mergeRequestSchema;
  readonly root: string;
  readonly repository: string;
  readonly pr: number;
  readonly head: string;
  readonly base: string;
  readonly mergeBase: string;
  readonly method: MergeMethod;
  readonly expectedTitle: string;
  readonly expectedBody: string;
  readonly mergeSubject: string;
  readonly mergeBody: string;
  readonly blastRadius: "normal" | "high";
  readonly highBlastRadiusConfirmed: boolean;
  readonly waivers: readonly {
    readonly gate: "delivery" | "documentation";
    readonly reason: string;
  }[];
  readonly adminCheck?: string;
}

export interface MergeReceipt {
  readonly schema: typeof mergeReceiptSchema;
  readonly outcome: "blocked" | "refused";
  readonly code:
    | "invalid_request"
    | "authority_missing"
    | "target_cas_unavailable";
  readonly repository?: string;
  readonly pr?: number;
  readonly head?: string;
  readonly base?: string;
  readonly mergeBase?: string;
  readonly method?: MergeMethod;
  readonly titleDigest?: string;
  readonly prBodyDigest?: string;
  readonly subjectDigest?: string;
  readonly bodyDigest?: string;
  readonly adminCheck?: string;
  readonly waivers?: MergeRequest["waivers"];
  readonly mergeAttempted: boolean;
  readonly commands: readonly (readonly string[])[];
  readonly detail: string;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw new Error(`${label} has unknown or missing keys`);
}

function safeText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > maximum ||
    /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}

function safeSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function parseRequest(value: unknown): MergeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("request is not an object");
  const input = value as Record<string, unknown>;
  const expected = [
    "base",
    "blastRadius",
    "expectedBody",
    "expectedTitle",
    "head",
    "highBlastRadiusConfirmed",
    "mergeBase",
    "mergeBody",
    "mergeSubject",
    "method",
    "pr",
    "repository",
    "root",
    "schema",
    "waivers",
    ...(input.adminCheck === undefined ? [] : ["adminCheck"]),
  ];
  exactKeys(input, expected, "request");
  if (input.schema !== mergeRequestSchema) throw new Error("request schema is invalid");
  if (typeof input.root !== "string" || input.root.length === 0 || Buffer.byteLength(input.root) > 4_096)
    throw new Error("root is invalid");
  if (typeof input.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository))
    throw new Error("repository is invalid");
  if (!Number.isSafeInteger(input.pr) || (input.pr as number) < 1) throw new Error("PR is invalid");
  const method = input.method;
  if (method !== "merge" && method !== "rebase" && method !== "squash")
    throw new Error("merge method is invalid");
  if (input.blastRadius !== "normal" && input.blastRadius !== "high")
    throw new Error("blast radius is invalid");
  if (typeof input.highBlastRadiusConfirmed !== "boolean")
    throw new Error("high-blast confirmation is invalid");
  const adminCheck =
    input.adminCheck === undefined ? undefined : safeText(input.adminCheck, "admin check", 256);
  if (!Array.isArray(input.waivers) || input.waivers.length > 2) throw new Error("waivers are invalid");
  const waivers = input.waivers.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`waiver ${index + 1} is invalid`);
    const waiver = value as Record<string, unknown>;
    exactKeys(waiver, ["gate", "reason"], `waiver ${index + 1}`);
    if (waiver.gate !== "delivery" && waiver.gate !== "documentation")
      throw new Error(`waiver ${index + 1} gate is invalid`);
    return { gate: waiver.gate, reason: safeText(waiver.reason, `waiver ${index + 1} reason`, 2_000) };
  });
  if (new Set(waivers.map((waiver) => waiver.gate)).size !== waivers.length)
    throw new Error("waivers contain duplicate gates");
  return {
    schema: mergeRequestSchema,
    root: input.root,
    repository: input.repository,
    pr: input.pr as number,
    head: safeSha(input.head, "head"),
    base: safeSha(input.base, "base"),
    mergeBase: safeSha(input.mergeBase, "merge base"),
    method,
    expectedTitle: safeText(input.expectedTitle, "expected title", 512),
    expectedBody: safeText(input.expectedBody, "expected body", 1_000_000),
    mergeSubject: safeText(input.mergeSubject, "merge subject", 512),
    mergeBody: safeText(input.mergeBody, "merge body", 1_000_000),
    blastRadius: input.blastRadius,
    highBlastRadiusConfirmed: input.highBlastRadiusConfirmed,
    waivers,
    ...(adminCheck ? { adminCheck } : {}),
  };
}

function baseReceipt(
  outcome: MergeReceipt["outcome"],
  code: MergeReceipt["code"],
  commands: readonly (readonly string[])[],
  detail: string,
): MergeReceipt {
  return { schema: mergeReceiptSchema, outcome, code, mergeAttempted: false, commands, detail };
}

function targetFields(request: MergeRequest) {
  return {
    repository: request.repository,
    pr: request.pr,
    head: request.head,
    base: request.base,
    mergeBase: request.mergeBase,
    method: request.method,
    titleDigest: createHash("sha256").update(request.expectedTitle).digest("hex"),
    prBodyDigest: createHash("sha256").update(request.expectedBody).digest("hex"),
    subjectDigest: createHash("sha256").update(request.mergeSubject).digest("hex"),
    bodyDigest: createHash("sha256").update(request.mergeBody).digest("hex"),
    waivers: request.waivers,
    ...(request.adminCheck ? { adminCheck: request.adminCheck } : {}),
  };
}

export async function mergePullRequest(value: unknown): Promise<MergeReceipt> {
  const commands: (readonly string[])[] = [];
  let request: MergeRequest;
  try {
    request = parseRequest(value);
  } catch (error) {
    return baseReceipt(
      "refused",
      "invalid_request",
      commands,
      error instanceof Error ? error.message : String(error),
    );
  }
  const fields = targetFields(request);
  if (
    (request.blastRadius === "high" || request.adminCheck !== undefined) &&
    !request.highBlastRadiusConfirmed
  )
    return {
      ...baseReceipt("refused", "authority_missing", commands, "fresh high-blast confirmation is required"),
      ...fields,
    };
  if (request.adminCheck !== undefined && request.blastRadius !== "high")
    return {
      ...baseReceipt("refused", "authority_missing", commands, "admin bypass requires high blast radius"),
      ...fields,
    };
  // GitHub's PR merge mutation can guard only the head OID. It cannot atomically
  // bind the selected base ref to request.base, so this owner must fail closed
  // before any command or remote mutation when target CAS is unavailable.
  return {
    ...baseReceipt(
      "blocked",
      "target_cas_unavailable",
      commands,
      "selected target ref/OID CAS is unavailable in the GitHub PR merge API; remote merge was not attempted",
    ),
    ...fields,
  };
}

async function readStdin(maximumBytes = 4_000_000, timeoutMilliseconds = 5_000): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stdin timed out")), timeoutMilliseconds);
    process.stdin.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        clearTimeout(timer);
        process.stdin.destroy();
        reject(new Error("stdin is saturated"));
      } else chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
    process.stdin.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export const readMergeRequestStdin = readStdin;
