import type { PrimitiveAction } from "./domain.js";
import type { EnvironmentManifest, EnvironmentStep, ExperimentEnvironment } from "./environment-contract.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

export interface TurnBasedObservation {
  me: unknown;
  tiles: unknown[];
  parcels: unknown[];
  keys: unknown[];
  doors: unknown[];
  batteries: unknown[];
  energy?: number;
}

/** Deliveroo-specific knowledge stops at this adapter. */
export class TurnBasedAdapter implements ExperimentEnvironment<PrimitiveAction, TurnBasedObservation> {
  readonly manifest: EnvironmentManifest = {
    id: "turn-based-grid",
    version: 1,
    observationDescription: "JSON state containing an agent, typed tiles, movable objects, and optional environmental objects.",
    actions: [
      { name: "move", inputDescription: "{kind:'move', direction:'up'|'right'|'down'|'left'}" },
      { name: "pickup", inputDescription: "{kind:'pickup'}" },
      { name: "putdown", inputDescription: "{kind:'putdown'}" },
      { name: "wait", inputDescription: "{kind:'wait', reason:string}" },
    ],
    successDescription: "The environment reports objective achievement through positive terminal score.",
  };

  constructor(private readonly environment: TurnBasedEnvironment) {}

  observe(): TurnBasedObservation { return serialize(this.environment.observation()); }
  fork(): TurnBasedAdapter { return new TurnBasedAdapter(this.environment.fork()); }
  step(action: PrimitiveAction): EnvironmentStep<TurnBasedObservation> {
    const result = this.environment.step(action);
    return { accepted: result.accepted, events: result.events, observation: serialize(result.observation) };
  }
  outcome() {
    const score = this.environment.observation().me?.score ?? 0;
    return { score, achieved: score > 0 };
  }
}

function serialize(beliefs: ReturnType<TurnBasedEnvironment["observation"]>): TurnBasedObservation {
  return {
    me: beliefs.me,
    tiles: [...beliefs.tiles.values()],
    parcels: [...beliefs.parcels.values()],
    keys: beliefs.keys ?? [],
    doors: beliefs.doors ?? [],
    batteries: beliefs.batteries ?? [],
    ...(beliefs.energy === undefined ? {} : { energy: beliefs.energy }),
  };
}
