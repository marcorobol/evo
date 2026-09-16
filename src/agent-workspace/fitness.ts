import type { BenchmarkEpisode } from "./contracts.js";

/**
 * Comparable population-level objectives.  A single map is evidence, not the
 * optimization target: these values always describe an entire split/family.
 */
export interface Fitness {
  episodes: number;
  successRate: number;
  meanScore: number;
  worstScore: number;
  meanSuccessfulSteps: number | null;
  meanBlockedActions: number;
  meanWaits: number;
}

export function fitness(episodes: readonly BenchmarkEpisode[]): Fitness {
  const count = episodes.length;
  const successes = episodes.filter((episode) => episode.achieved);
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  return {
    episodes: count,
    successRate: count === 0 ? 1 : successes.length / count,
    meanScore: count === 0 ? 0 : sum(episodes.map((episode) => episode.score)) / count,
    worstScore: count === 0 ? 0 : Math.min(...episodes.map((episode) => episode.score)),
    // Failed episodes may terminate early, so efficiency is measured only on
    // successful behavior and cannot reward giving up.
    meanSuccessfulSteps: successes.length === 0 ? null : sum(successes.map((episode) => episode.steps)) / successes.length,
    meanBlockedActions: count === 0 ? 0 : sum(episodes.map((episode) => episode.blockedActions)) / count,
    meanWaits: count === 0 ? 0 : sum(episodes.map((episode) => episode.waits)) / count,
  };
}

/** True only for an unambiguous population-level improvement. */
export function improves(candidate: Fitness, baseline: Fitness): boolean {
  if (candidate.successRate > baseline.successRate) return true;
  if (candidate.meanScore > baseline.meanScore) return true;
  if (candidate.worstScore > baseline.worstScore) return true;
  if (candidate.successRate !== baseline.successRate || candidate.meanScore !== baseline.meanScore || candidate.worstScore !== baseline.worstScore) return false;
  if (candidate.meanSuccessfulSteps !== null && baseline.meanSuccessfulSteps !== null && candidate.meanSuccessfulSteps < baseline.meanSuccessfulSteps) return true;
  if (candidate.meanBlockedActions < baseline.meanBlockedActions) return true;
  return candidate.meanWaits < baseline.meanWaits;
}
