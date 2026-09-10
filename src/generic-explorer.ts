import { z } from "zod";
import type { CapabilityModel } from "./capability-proposer.js";
import { genericCapabilitySchema, parseGenericCapability, type GenericCapability } from "./generic-capability.js";
import type { EnvironmentManifest, ExperimentEnvironment } from "./environment-contract.js";

const decisionSchema = z.object({
  action: z.record(z.string(), z.unknown()),
  // Local reasoning models may be overly verbose even when asked for a short
  // hypothesis. Preserve the decision, then compact only the stored trace.
  hypothesis: z.string().min(1).max(4_000),
});

export interface ExplorationStep<Observation> {
  index: number;
  action: Record<string, unknown>;
  hypothesis: string;
  accepted: boolean;
  events: Array<{ type: string; detail: string }>;
  observation: Observation;
  outcome: { score: number; achieved: boolean };
}

export interface ExplorationResult<Observation> {
  manifest: EnvironmentManifest;
  initialObservation: Observation;
  steps: ExplorationStep<Observation>[];
  outcome: { score: number; achieved: boolean };
}

/**
 * A generic experiment loop. The model receives no hidden domain rules: it
 * makes one falsifiable action hypothesis at a time and learns from observed
 * events and score changes produced by the environment.
 */
export class GenericExplorer {
  constructor(private readonly model: CapabilityModel) {}

  async explore<Action, Observation>(
    environment: ExperimentEnvironment<Action, Observation>,
    decodeAction: (action: Record<string, unknown>) => Action | undefined,
    maximumSteps = 12,
  ): Promise<ExplorationResult<Observation>> {
    const initialObservation = environment.observe();
    const steps: ExplorationStep<Observation>[] = [];
    let consecutiveStagnantWaits = 0;
    for (let index = 0; index < maximumSteps && !environment.outcome().achieved; index += 1) {
      const decision = await this.nextDecision(
        [
          "You are experimentally discovering an unknown environment.",
          "Choose exactly one next action from the manifest and state a falsifiable hypothesis in one sentence (at most 240 characters).",
          "Do not assume meanings for identifiers or tile types; infer rules only from observations, events, and score changes.",
          "Return JSON only with action and hypothesis. Do not call tools.",
        ].join(" "),
        JSON.stringify({ manifest: environment.manifest, initialObservation, history: steps, currentObservation: environment.observe(), outcome: environment.outcome() }),
      );
      const hypothesis = compactHypothesis(decision.hypothesis);
      const decoded = decodeAction(decision.action);
      if (decoded === undefined) {
        steps.push({ index, action: decision.action, hypothesis, accepted: false, events: [{ type: "invalid-action", detail: "The action was not declared by the environment." }], observation: environment.observe(), outcome: environment.outcome() });
        continue;
      }
      const result = environment.step(decoded);
      const outcome = environment.outcome();
      steps.push({ index, action: decision.action, hypothesis, accepted: result.accepted, events: result.events, observation: result.observation, outcome });
      console.log(`[explore] step ${index + 1}: ${JSON.stringify(decision.action)} → ${result.accepted ? "accepted" : "rejected"}; score=${outcome.score}; achieved=${outcome.achieved}`);
      consecutiveStagnantWaits = decision.action.kind === "wait" && result.accepted && outcome.score === steps.at(-2)?.outcome.score
        ? consecutiveStagnantWaits + 1
        : 0;
      if (consecutiveStagnantWaits >= 2) {
        console.log("[explore] stopping early: two accepted waits produced no observable progress.");
        break;
      }
    }
    return { manifest: environment.manifest, initialObservation, steps, outcome: environment.outcome() };
  }

  private async nextDecision(system: string, prompt: string) {
    let error: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try { return decisionSchema.parse(await this.model.generate(system, prompt)); }
      catch (caught) {
        error = caught;
        console.log(`[explore] malformed planner response; retrying (${attempt}/2)`);
      }
    }
    throw error;
  }

  async generalizeSuccessfulTrace<Observation>(goal: string, trace: ExplorationResult<Observation>): Promise<GenericCapability> {
    if (!trace.outcome.achieved) throw new Error("A capability can only be generalized from a successful exploration trace.");
    return parseGenericCapability(await this.model.generate(
      "Generalize the successful trace into one reusable capability. Return JSON only with name, goal, applicability, actions, and rationale. name, goal, applicability, and rationale must each be plain JSON strings, never objects or arrays. Preserve the exact successful action sequence; do not add actions or domain assumptions.",
      JSON.stringify({ goal, manifest: trace.manifest, trace }),
      genericCapabilitySchema,
    ));
  }
}

function compactHypothesis(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`;
}
