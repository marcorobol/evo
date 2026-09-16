import type { TurnBasedScenario } from "../turn-based-environment.js";
import { TurnBasedEnvironment } from "../turn-based-environment.js";
import { PartialObservationEnvironment } from "../partial-observation-environment.js";
import type { BenchmarkEpisode, EvolvableAgent } from "./contracts.js";

export function runBenchmark(name: string, scenario: TurnBasedScenario, agent: EvolvableAgent, maximumSteps = 30): BenchmarkEpisode {
  return runEnvironmentBenchmark(name, new TurnBasedEnvironment(scenario), agent, maximumSteps);
}

export function runPartialObservationBenchmark(name: string, scenario: TurnBasedScenario, agent: EvolvableAgent, radius = 0, maximumSteps = 30): BenchmarkEpisode {
  return runEnvironmentBenchmark(name, new PartialObservationEnvironment(scenario, radius), agent, maximumSteps);
}

interface BenchmarkEnvironment {
  observation(): ReturnType<TurnBasedEnvironment["observation"]>;
  step(action: import("../domain.js").PrimitiveAction): ReturnType<TurnBasedEnvironment["step"]>;
}

function runEnvironmentBenchmark(name: string, environment: BenchmarkEnvironment, agent: EvolvableAgent, maximumSteps: number): BenchmarkEpisode {
  agent.reset();
  const decisions = [];
  let acceptedActions = 0;
  let blockedActions = 0;
  const blockedReasons: string[] = [];
  let waits = 0;
  let repeatedBlock = 0;
  let lastBlockedAction: string | undefined;
  for (let step = 0; step < maximumSteps && !environment.observation().me?.score; step += 1) {
    const decision = agent.nextAction(environment.observation());
    decisions.push(decision);
    if (decision.action.kind === "wait") waits += 1;
    const result = environment.step(decision.action);
    agent.recordOutcome(result.accepted);
    if (result.accepted) {
      acceptedActions += 1;
      repeatedBlock = 0;
      lastBlockedAction = undefined;
    } else {
      blockedActions += 1;
      blockedReasons.push(...result.events.map((event) => event.detail));
      const action = JSON.stringify(decision.action);
      repeatedBlock = action === lastBlockedAction ? repeatedBlock + 1 : 1;
      lastBlockedAction = action;
    }
    if (waits >= 2 || repeatedBlock >= 3) break;
  }
  const outcome = environment.observation().me?.score ?? 0;
  return { name, achieved: outcome > 0, score: outcome, steps: decisions.length, acceptedActions, blockedActions, blockedReasons, waits, decisions, capabilityActivations: agent.capabilityStats() };
}
