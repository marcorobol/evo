import type { TurnBasedScenario } from "../turn-based-environment.js";
import { runBenchmark, runPartialObservationBenchmark } from "./benchmark-runner.js";
import { compileCandidate, type CandidateProposal } from "./candidate-policy.js";
import type { BenchmarkEpisode, EvolvableAgent } from "./contracts.js";
import { createEvolvingAgent } from "./evolving-agent.js";
import { fitness, improves, type Fitness } from "./fitness.js";
import { policyCapability, type DecisionCapability } from "./capability-registry.js";

export interface NamedScenario {
  name: string;
  scenario: TurnBasedScenario;
  observationRadius?: number;
  /** Distribution metadata is evidence in reports, never an action shortcut. */
  family?: string;
  split?: "training" | "holdout";
  seed?: number;
}
export interface CandidateEvaluation {
  proposal: CandidateProposal;
  baseline: BenchmarkEpisode[];
  training: BenchmarkEpisode[];
  holdout: BenchmarkEpisode[];
  objectives: { baseline: { training: Fitness; holdout: Fitness }; candidate: { training: Fitness; holdout: Fitness } };
  accepted: boolean;
  reason: string;
}

export interface EvaluationOptions {
  /** Previously promoted behavior is part of the baseline for later evolution. */
  baseCapabilities?: ReadonlyArray<DecisionCapability>;
  /** Declared activation priority of the candidate; 0 when unspecified. */
  candidatePriority?: number;
}

/**
 * Promotion optimizes a population, not a single episode: a candidate needs a
 * strict aggregate training improvement, cannot lose training score/success,
 * and must retain every previously solved holdout task.
 */
export function evaluateCandidate(proposal: CandidateProposal, training: NamedScenario[], holdout: NamedScenario[], options: EvaluationOptions = {}): CandidateEvaluation {
  const baseCapabilities = options.baseCapabilities ?? [];
  const baselineAgent = () => createEvolvingAgent({ capabilities: baseCapabilities });
  const baseline = [...training, ...holdout].map((item) => runNamedScenario(item, baselineAgent()));
  const extension = compileCandidate(proposal);
  const candidateID = `candidate:${proposal.id}`;
  const candidateCapability = policyCapability(candidateID, extension, options.candidatePriority ?? 0);
  const candidate = (items: NamedScenario[]) => items.map((item) => runNamedScenario(item, createEvolvingAgent({ capabilities: [candidateCapability, ...baseCapabilities] })));
  const trainingResult = candidate(training);
  const holdoutResult = candidate(holdout);
  const baseTraining = baseline.slice(0, training.length);
  const baseHoldout = baseline.slice(training.length);
  const trainingRegression = trainingResult.some((episode, index) => episode.score < (baseTraining[index]?.score ?? 0) || ((baseTraining[index]?.achieved ?? false) && !episode.achieved));
  const holdoutRegression = holdoutResult.some((episode, index) => (baseHoldout[index]?.achieved ?? false) && !episode.achieved);
  const objectives = {
    baseline: { training: fitness(baseTraining), holdout: fitness(baseHoldout) },
    candidate: { training: fitness(trainingResult), holdout: fitness(holdoutResult) },
  };
  const activationStats = [...trainingResult, ...holdoutResult].map((episode) => episode.capabilityActivations?.find((entry) => entry.id === candidateID));
  const activated = activationStats.some((entry) => (entry?.decisions ?? 0) > 0);
  const invocations = activationStats.reduce((total, entry) => total + (entry?.invocations ?? 0), 0);
  const improvement = improves(objectives.candidate.training, objectives.baseline.training);
  const accepted = activated && improvement && !trainingRegression && !holdoutRegression;
  const reason = accepted
    ? "Candidate improved population-level training fitness without a training or holdout regression."
    : !activated ? invocations === 0
      ? "Candidate was never invoked in any evaluated episode; it is shadowed by higher-priority capabilities or never applicable."
      : `Candidate deferred on all ${invocations} invocation(s); it never returned a decision.`
      : !improvement ? "Candidate did not improve population-level training fitness."
      : trainingRegression ? "Candidate regressed a training score or success."
        : "Candidate lost a baseline holdout success.";
  return { proposal, baseline, training: trainingResult, holdout: holdoutResult, objectives, accepted, reason };
}

export function runNamedScenario(item: NamedScenario, agent: EvolvableAgent): BenchmarkEpisode {
  return item.observationRadius === undefined
    ? runBenchmark(item.name, item.scenario, agent)
    : runPartialObservationBenchmark(item.name, item.scenario, agent, item.observationRadius);
}
