import { z } from "zod";
import { compileCandidate } from "./candidate-policy.js";
import type { CandidateProposal } from "./candidate-policy.js";
import type { DecisionCapability } from "./capability-registry.js";

/** A self-contained, domain-neutral capability proposed by the coding model. */
export const capabilityArtifactSchema = z.object({
  id: z.string().min(3).max(120),
  purpose: z.string().min(1).max(1_500),
  activation: z.object({ hook: z.literal("decision"), priority: z.number().finite().min(-100).max(100).default(0) }),
  source: z.string().min(20).max(20_000)
    .refine((source) => /^\s*\(?\s*context\s*\)?\s*=>\s*\{/.test(source), "source must be one arrow function beginning with context")
    .refine((source) => !/\bfunction\b|\.\.\.|Math\.random|Date\.|new\s+Promise\b/.test(source), "source cannot use helpers, placeholders, randomness, or async control flow")
    .refine((source) => /kind\s*:\s*["'](?:move|pickup|putdown|wait)["']/.test(source), "source must directly return a declared structured action"),
});
export type CapabilityArtifact = z.infer<typeof capabilityArtifactSchema>;

/** Compile an artifact through the existing pure-VM boundary. */
export function compileCapabilityArtifact(artifact: CapabilityArtifact): DecisionCapability {
  const decide = compileCandidate(asCandidateProposal(artifact));
  return { descriptor: { id: artifact.id, version: 1, purpose: artifact.purpose }, priority: artifact.activation.priority, decide };
}

export function asCandidateProposal(artifact: CapabilityArtifact): CandidateProposal {
  return {
    id: artifact.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "capability",
    module: artifact.id,
    bottleneck: artifact.purpose,
    rationale: artifact.purpose,
    expectedMetric: "Capability activation and benchmark improvement.",
    source: artifact.source,
  };
}
