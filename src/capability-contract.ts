import { z } from "zod";
import type { PrimitiveAction } from "./domain.js";

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), direction: z.enum(["up", "right", "down", "left"]) }),
  z.object({ kind: z.literal("pickup") }),
  z.object({ kind: z.literal("putdown") }),
  z.object({ kind: z.literal("wait"), reason: z.string().min(1).max(240) }),
]);

export const actionPlanSchema = z.array(actionSchema).min(1).max(40);

export const preconditionsSchema = z.object({
  requiresKey: z.boolean(),
  requiresDoor: z.boolean(),
  requiresBattery: z.boolean(),
  minimumParcels: z.number().int().min(0).max(20),
});

export const capabilityProposalSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  goal: z.string().min(1).max(500),
  applicability: z.string().min(1).max(1_000),
  preconditions: preconditionsSchema,
  plan: actionPlanSchema,
  rationale: z.string().min(1).max(1_000),
});

export type CapabilityProposal = z.infer<typeof capabilityProposalSchema>;

export function isExecutableProposal(proposal: CapabilityProposal): proposal is CapabilityProposal & { plan: PrimitiveAction[] } {
  return proposal.plan.length > 0;
}

export const codeCapabilitySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  goal: z.string().min(1).max(500),
  applicability: z.string().min(1).max(1_000),
  preconditions: preconditionsSchema,
  source: z.string().min(20).max(6_000),
  rationale: z.string().min(1).max(1_000),
});

export type CodeCapability = z.infer<typeof codeCapabilitySchema>;
