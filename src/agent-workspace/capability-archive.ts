import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const root = "agent-workspace/capability-archive";

/** Immutable record: rejected candidates remain reusable research evidence. */
export interface ArchivedCapability {
  runID: string;
  attempt: number;
  model: string;
  createdAt: string;
  accepted: boolean;
  reason: string;
  proposal?: unknown;
  raw?: string;
}

export interface SimilarCapability { id: string; score: number; reason: string; }

export async function archiveCapability(record: ArchivedCapability): Promise<string> {
  await mkdir(root, { recursive: true });
  const label = proposalID(record.proposal) ?? "unparsed";
  const path = `${root}/${safe(label)}-${record.runID}-${record.attempt}.json`;
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return path;
}

/** Every archived proposal is supplied as prior work to the next evolution. */
export async function loadCapabilityArchive(): Promise<ArchivedCapability[]> {
  try {
    const files = (await readdir(root)).filter((file) => file.endsWith(".json")).sort();
    return Promise.all(files.map(async (file) => JSON.parse(await readFile(`${root}/${file}`, "utf8")) as ArchivedCapability));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Reject literal repeats and near-identical revisions before spending benchmark
 * time. A repair is still possible, but it must make a material code change or
 * state a new capability identity.
 */
export function findSimilarCapability(proposal: unknown, archive: readonly ArchivedCapability[]): SimilarCapability | undefined {
  const candidate = representation(proposal);
  if (!candidate) return undefined;
  let closest: SimilarCapability | undefined;
  for (const entry of archive) {
    const prior = representation(entry.proposal ?? parseRawProposal(entry.raw));
    if (!prior) continue;
    const score = similarity(candidate.tokens, prior.tokens);
    const sameIdentity = candidate.id === prior.id && candidate.module === prior.module;
    if (score === 1 || (sameIdentity && score >= 0.85) || score >= 0.995) {
      const match = { id: prior.id, score, reason: score === 1 ? "identical code" : sameIdentity ? "same capability identity with near-identical code" : "near-identical code" };
      if (!closest || match.score > closest.score) closest = match;
    }
  }
  return closest;
}

function proposalID(proposal: unknown): string | undefined {
  if (typeof proposal !== "object" || proposal === null || !("id" in proposal)) return undefined;
  const id = (proposal as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}
function safe(value: string): string { return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "proposal"; }

function representation(value: unknown): { id: string; module: string; tokens: Set<string> } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as { id?: unknown; module?: unknown; files?: unknown; source?: unknown };
  if (typeof item.id !== "string" || typeof item.module !== "string") return undefined;
  const content = Array.isArray(item.files)
    ? item.files.map((file) => typeof file === "object" && file !== null && typeof (file as { content?: unknown }).content === "string" ? (file as { content: string }).content : "").join("\n")
    : typeof item.source === "string" ? item.source : "";
  if (!content) return undefined;
  return { id: item.id, module: item.module, tokens: new Set(content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ").match(/[A-Za-z_$][\w$]*|\d+|=>|===|!==|==|!=|[{}()[\].,;:+*/<>-]/g) ?? []) };
}

function similarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function parseRawProposal(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}
