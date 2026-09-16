import vm from "node:vm";
import { z } from "zod";
import type { ModuleDecision, PolicyContext, PolicyExtension } from "./contracts.js";

/**
 * The deliberately narrow unit a coding model is allowed to produce first.
 * It is executable code, but has no imports, filesystem, network, or
 * environment handle. Broader module edits can reuse this evaluation gate.
 */
export const candidateProposalSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,80}$/),
  bottleneck: z.string().min(1).max(600),
  /** Arbitrary capability label chosen by the proposing agent; never host-enumerated. */
  module: z.string().min(3).max(120),
  rationale: z.string().min(1).max(1_500),
  expectedMetric: z.string().min(1).max(1_000),
  source: z.string().min(20).max(12_000)
    .refine((source) => source.includes("context.observation"), "source must read state through context.observation"),
});

export type CandidateProposal = z.infer<typeof candidateProposalSchema>;

const forbidden = /\b(?:import|export|require|process|globalThis|constructor|Function|eval|WebAssembly|fetch|XMLHttpRequest)\b/;

export function compileCandidate(proposal: CandidateProposal): PolicyExtension {
  if (forbidden.test(proposal.source)) throw new Error("Candidate source uses a forbidden capability.");
  let value: unknown;
  try {
    value = new vm.Script(`\"use strict\"; (${proposal.source})`, { filename: `${proposal.id}.candidate.js` })
      .runInNewContext(Object.create(null), { timeout: 100 });
  } catch (error) {
    throw new Error(`Candidate does not compile: ${message(error)}`);
  }
  if (typeof value !== "function") throw new Error("Candidate source must be one function expression.");
  return (context) => {
    let result: unknown;
    try {
      result = (value as (input: Readonly<PolicyContext>) => unknown)(structuredClone(context));
    } catch (error) {
      throw new Error(`Candidate execution failed: ${message(error)}`);
    }
    if (result === undefined || result === null) return undefined;
    return parseDecision(result, proposal.id);
  };
}

function parseDecision(value: unknown, id: string): ModuleDecision {
  const action = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("move"), direction: z.enum(["up", "right", "down", "left"]) }),
    z.object({ kind: z.literal("pickup") }),
    z.object({ kind: z.literal("putdown") }),
    z.object({ kind: z.literal("wait"), reason: z.string().min(1).max(240) }),
  ]).safeParse((value as { action?: unknown }).action);
  if (!action.success) throw new Error(`Candidate returned an invalid action: ${action.error.issues[0]?.message ?? "unknown error"}`);
  const confidence = typeof (value as { confidence?: unknown }).confidence === "number" ? (value as { confidence: number }).confidence : 0.5;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Candidate confidence must be between 0 and 1.");
  const rationale = typeof (value as { rationale?: unknown }).rationale === "string" ? (value as { rationale: string }).rationale : "Candidate policy override.";
  return { action: action.data, confidence, rationale: rationale.slice(0, 500), module: `candidate:${id}` };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
