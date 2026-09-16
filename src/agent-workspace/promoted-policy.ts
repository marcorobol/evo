import { mkdir, readFile, writeFile } from "node:fs/promises";
import { candidateProposalSchema, compileCandidate, type CandidateProposal } from "./candidate-policy.js";
import type { PolicyExtension } from "./contracts.js";

const activePath = "agent-workspace/promoted/active.json";

export interface ActivePolicy {
  proposal: CandidateProposal;
  extension: PolicyExtension;
}

/** Load the ordered set of explicitly promoted policy layers. */
export async function loadActivePolicies(): Promise<ActivePolicy[]> {
  try {
    const proposals = parseManifest(JSON.parse(await readFile(activePath, "utf8")));
    return proposals.map((proposal) => ({ proposal, extension: compileCandidate(proposal) }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw new Error(`The promoted policy is invalid and was not loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Promotion is host-controlled; a model cannot call this function itself. */
export async function promote(proposal: CandidateProposal): Promise<string> {
  await mkdir("agent-workspace/promoted/history", { recursive: true });
  const content = `${JSON.stringify(proposal, null, 2)}\n`;
  const history = `agent-workspace/promoted/history/${proposal.id}.json`;
  try { await writeFile(history, content, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const existing = await readManifest();
  // New validated behavior is tried first. Earlier layers remain available as
  // fallbacks when the new policy defers, and as immutable history on disk.
  const policies = [proposal, ...existing.filter((item) => item.id !== proposal.id)];
  await writeFile(activePath, `${JSON.stringify({ version: 1, policies }, null, 2)}\n`);
  return history;
}

async function readManifest(): Promise<CandidateProposal[]> {
  try { return parseManifest(JSON.parse(await readFile(activePath, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Accept the v0 single-policy file so experiments made before composition remain readable. */
function parseManifest(value: unknown): CandidateProposal[] {
  if (typeof value === "object" && value !== null && "policies" in value) {
    const policies = (value as { policies: unknown }).policies;
    if (!Array.isArray(policies)) throw new Error("Promoted policy manifest has a non-array policies field.");
    return policies.map((proposal) => candidateProposalSchema.parse(proposal));
  }
  return [candidateProposalSchema.parse(value)];
}
