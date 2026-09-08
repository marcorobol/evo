import type { CapabilityProposal } from "./capability-contract.js";
import type { TurnResult } from "./turn-based-environment.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

export interface CapabilityValidation {
  accepted: boolean;
  fitness: number;
  rewardDelta: number;
  successfulActions: number;
  failedActions: number;
  turns: TurnResult[];
}

/**
 * Executes a candidate only in a fork of the environment. The caller's episode
 * is left untouched, so selection can compare alternatives fairly.
 */
export function validateCapability(environment: TurnBasedEnvironment, proposal: CapabilityProposal): CapabilityValidation {
  const sandbox = environment.fork();
  const initialScore = sandbox.observation().me?.score ?? 0;
  const turns = proposal.plan.map((action) => sandbox.step(action));
  const successfulActions = turns.filter((turn) => turn.accepted).length;
  const failedActions = turns.length - successfulActions;
  const rewardDelta = (sandbox.observation().me?.score ?? initialScore) - initialScore;

  // The formula is intentionally transparent; experiment configurations may
  // replace its weights without changing the environment semantics.
  const fitness = rewardDelta * 10 + successfulActions - failedActions * 5 - turns.length * 0.05;
  return {
    // Curriculum episodes are delivery tasks: a no-op plan is not an evolved
    // capability even when every primitive action was syntactically valid.
    accepted: failedActions === 0 && rewardDelta > 0,
    fitness,
    rewardDelta,
    successfulActions,
    failedActions,
    turns,
  };
}
