import type { TurnBasedScenario } from "../turn-based-environment.js";
import { batteryReturnVariant } from "../scenario-variants.js";
import type { NamedScenario } from "./candidate-evaluator.js";

export interface ScenarioFamily {
  id: string;
  description: string;
  training: NamedScenario[];
  holdout: NamedScenario[];
}

/**
 * Deterministic scenario distributions. Seeds in holdout are never exposed to
 * the coding model; they protect against coordinate- or seed-specific rules.
 */
export function builtInScenarioFamilies(): ScenarioFamily[] {
  return [batteryReturnFamily([11, 29, 47], [71, 89, 107])];
}

export function batteryReturnFamily(trainingSeeds: number[], holdoutSeeds: number[]): ScenarioFamily {
  return {
    id: "battery-return",
    description: "Recharge-and-deliver corridors with independently sampled distance and orientation.",
    training: trainingSeeds.map((seed) => named("battery-return", "training", seed, batteryReturnVariant(seed))),
    holdout: holdoutSeeds.map((seed) => named("battery-return", "holdout", seed, batteryReturnVariant(seed))),
  };
}

function named(family: string, split: "training" | "holdout", seed: number, scenario: TurnBasedScenario): NamedScenario {
  return { name: `${family}/${split}/seed-${seed}`, scenario, family, split, seed };
}
