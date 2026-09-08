import { z } from "zod";
import type { ExperimentEnvironment } from "./environment-contract.js";

export const genericCapabilitySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  goal: z.string().min(1).max(500),
  applicability: z.string().min(1).max(1_000),
  actions: z.array(z.record(z.string(), z.unknown())).min(1).max(80),
  rationale: z.string().min(1).max(1_000),
});

export type GenericCapability = z.infer<typeof genericCapabilitySchema>;

export interface GenericValidation {
  accepted: boolean;
  scoreDelta: number;
  successfulActions: number;
  failedActions: number;
  achieved: boolean;
}

/** Core validator: it has no knowledge of parcels, keys, maps, or delivery. */
export function validateGenericCapability<Action, Observation>(
  environment: ExperimentEnvironment<Action, Observation>,
  capability: GenericCapability,
  decodeAction: (action: Record<string, unknown>) => Action | undefined,
): GenericValidation {
  const sandbox = environment.fork();
  const initial = sandbox.outcome().score;
  let successfulActions = 0;
  let failedActions = 0;
  for (const action of capability.actions) {
    const decoded = decodeAction(action);
    if (decoded === undefined) {
      failedActions += 1;
      continue;
    }
    if (sandbox.step(decoded).accepted) successfulActions += 1;
    else failedActions += 1;
  }
  const outcome = sandbox.outcome();
  return {
    accepted: failedActions === 0 && outcome.achieved,
    scoreDelta: outcome.score - initial,
    successfulActions,
    failedActions,
    achieved: outcome.achieved,
  };
}
