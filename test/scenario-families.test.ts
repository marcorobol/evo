import assert from "node:assert/strict";
import test from "node:test";
import { fitness, improves } from "../src/agent-workspace/fitness.js";
import { batteryReturnFamily } from "../src/agent-workspace/scenario-families.js";
import type { BenchmarkEpisode } from "../src/agent-workspace/contracts.js";

function episode(overrides: Partial<BenchmarkEpisode> = {}): BenchmarkEpisode {
  return { name: "episode", achieved: true, score: 10, steps: 5, acceptedActions: 5, blockedActions: 0, blockedReasons: [], waits: 0, decisions: [], ...overrides };
}

test("scenario family is deterministic and keeps training and holdout seed-disjoint", () => {
  const first = batteryReturnFamily([11, 29], [71, 89]);
  const second = batteryReturnFamily([11, 29], [71, 89]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.training.map((item) => item.seed), [11, 29]);
  assert.deepEqual(first.holdout.map((item) => item.seed), [71, 89]);
  assert.equal(first.training.some((item) => first.holdout.some((other) => other.seed === item.seed)), false);
});

test("fitness does not reward a short failed run as efficient", () => {
  const baseline = fitness([episode({ steps: 8 })]);
  const abandoned = fitness([episode({ achieved: false, score: 0, steps: 1, waits: 1 })]);
  assert.equal(abandoned.meanSuccessfulSteps, null);
  assert.equal(improves(abandoned, baseline), false);
});

test("fitness accepts a strictly faster successful population", () => {
  assert.equal(improves(fitness([episode({ steps: 4 })]), fitness([episode({ steps: 6 })])), true);
});
