import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../src/agent-workspace/benchmark-runner.js";
import { runPartialObservationBenchmark } from "../src/agent-workspace/benchmark-runner.js";
import { diagnose } from "../src/agent-workspace/diagnostics.js";
import { createEvolvingAgent } from "../src/agent-workspace/evolving-agent.js";
import { findPath } from "../src/agent-workspace/navigation.js";
import { HeatmapMemory } from "../src/agent-workspace/memory.js";
import { capabilityArtifactSchema } from "../src/agent-workspace/capability-artifact.js";
import { improves, type Fitness } from "../src/agent-workspace/fitness.js";
import type { Tile } from "../src/domain.js";
import { loadScenario } from "../src/scenario-loader.js";
import { fileURLToPath } from "node:url";

test("A* navigation takes a detour through known walkable tiles", () => {
  const tiles: Tile[] = [
    { x: 0, y: 0, type: "2" }, { x: 1, y: 0, type: "0" }, { x: 2, y: 0, type: "1" },
    { x: 0, y: 1, type: "1" }, { x: 1, y: 1, type: "1" }, { x: 2, y: 1, type: "1" },
  ];
  const path = findPath({ tiles: new Map(tiles.map((tile) => [`${tile.x},${tile.y}`, tile])), canEnter: (tile) => tile.type !== "0" }, { x: 0, y: 0 }, { x: 2, y: 0 });
  assert.deepEqual(path, ["down", "right", "right", "up"]);
});

test("workspace agent solves direct delivery and produces no bottleneck", async () => {
  const path = fileURLToPath(new URL("../scenarios/simple-delivery.v1.json", import.meta.url));
  const { metadata, scenario } = await loadScenario(path);
  const episode = runBenchmark(metadata.name, scenario, createEvolvingAgent());
  assert.equal(episode.achieved, true);
  assert.equal(episode.score, 5);
  assert.deepEqual(diagnose(episode), []);
});

test("blank-slate substrate defers every decision and scores nothing", async () => {
  process.env.EVOLUTION_BLANK_SLATE = "1";
  try {
    const path = fileURLToPath(new URL("../scenarios/simple-delivery.v1.json", import.meta.url));
    const { metadata, scenario } = await loadScenario(path);
    const episode = runBenchmark(metadata.name, scenario, createEvolvingAgent());
    assert.equal(episode.achieved, false);
    assert.equal(episode.score, 0);
    assert.ok(episode.decisions.every((entry) => entry.action.kind === "wait"));
    assert.equal(episode.decisions[0]?.module, "substrate");
  } finally {
    delete process.env.EVOLUTION_BLANK_SLATE;
  }
});

test("efficiency tie-breaks never promote an all-failing population", () => {
  const allFailing = (overrides: Partial<Fitness>): Fitness => ({ episodes: 7, successRate: 0, meanScore: 0, worstScore: 0, meanSuccessfulSteps: null, meanBlockedActions: 0, meanWaits: 2, ...overrides });
  // Fewer waits or blocked-but-active behavior must not count as improvement
  // when nothing is solved (the degenerate blank-baseline case).
  assert.equal(improves(allFailing({ meanWaits: 0, meanBlockedActions: 3 }), allFailing({})), false);
  assert.equal(improves(allFailing({ meanWaits: 0 }), allFailing({})), false);
  // Equally-successful populations are still ranked by efficiency.
  const solving = (overrides: Partial<Fitness>): Fitness => ({ episodes: 7, successRate: 1, meanScore: 8, worstScore: 5, meanSuccessfulSteps: 7, meanBlockedActions: 1, meanWaits: 0.5, ...overrides });
  assert.equal(improves(solving({ meanSuccessfulSteps: 5 }), solving({})), true);
  assert.equal(improves(solving({ meanWaits: 0.2 }), solving({})), true);
});

test("a terminal score is not diagnosed as a navigation regression", () => {
  assert.deepEqual(diagnose({
    name: "terminal-energy-case", achieved: true, score: 10, steps: 4,
    acceptedActions: 3, blockedActions: 1, blockedReasons: ["The putdown exhausted the agent's energy."], waits: 0, decisions: [],
  }), []);
});

test("partial observation exposes an exploration bottleneck to the baseline", async () => {
  const path = fileURLToPath(new URL("../scenarios/partial-observation-frontier.v1.json", import.meta.url));
  const { metadata, scenario } = await loadScenario(path);
  const episode = runPartialObservationBenchmark(metadata.name, scenario, createEvolvingAgent(), 1);
  assert.equal(episode.achieved, false);
  assert.equal(episode.waits, 2);
  assert.equal(diagnose(episode)[0]?.id, "unseen-state");
});

test("frontier-only exploration exposes a dead-end bottleneck", async () => {
  const path = fileURLToPath(new URL("../scenarios/partial-observation-backtrack.v1.json", import.meta.url));
  const { metadata, scenario } = await loadScenario(path);
  const episode = runPartialObservationBenchmark(metadata.name, scenario, createEvolvingAgent({
    extension: (context) => {
      const o = context.observation;
      if (o.parcels.length || !o.me) return undefined;
      const visited = new Set(context.memory.map((item) => `${item.x},${item.y}`));
      const next = [{ direction: "down" as const, x: o.me.x, y: o.me.y + 1 }, { direction: "right" as const, x: o.me.x + 1, y: o.me.y }]
        .find((item) => !visited.has(`${item.x},${item.y}`));
      return next ? { action: { kind: "move", direction: next.direction }, confidence: 1, rationale: "frontier only", module: "frontier-only-test" } : undefined;
    }, extensionModule: "frontier-only-test",
  }), 1);
  assert.equal(episode.achieved, false);
  assert.equal(diagnose(episode)[0]?.id, "unseen-state");
});

test("episodic memory records whether a proposed move was accepted", () => {
  const memory = new HeatmapMemory();
  memory.record({ tiles: new Map(), parcels: new Map(), me: { id: "a", name: "a", x: 0, y: 0, score: 0 }, observedAt: 0 }, { action: { kind: "move", direction: "right" }, confidence: 1, rationale: "test", module: "test" });
  memory.recordOutcome(false);
  assert.equal(memory.snapshot()[0]?.accepted, false);
});

test("registered capability is invoked and its decision activation is measurable", () => {
  const agent = createEvolvingAgent({ capabilities: [{
    descriptor: { id: "co-located-pickup", version: 1, purpose: "Test capability." }, priority: 1,
    decide: (context) => context.observation.parcels.some((parcel) => parcel.x === context.observation.me?.x && parcel.y === context.observation.me?.y)
      ? { action: { kind: "pickup" }, confidence: 1, rationale: "capability activation", module: "co-located-pickup" }
      : undefined,
  }] });
  agent.nextAction({ tiles: new Map(), parcels: new Map([["p", { id: "p", x: 0, y: 0, reward: 1 }]]), me: { id: "a", name: "a", x: 0, y: 0, score: 0 }, observedAt: 0 });
  assert.deepEqual(agent.capabilityStats(), [{ id: "co-located-pickup", invocations: 1, decisions: 1 }]);
});

test("a self-contained capability artifact is attached without core edits", () => {
  const agent = createEvolvingAgent({ artifacts: [{ id: "artifact-pickup", purpose: "Pick up co-located work.", activation: { hook: "decision", priority: 1 }, source: "(context) => { const me = context.observation.me; return context.observation.parcels.some((p) => me && p.x === me.x && p.y === me.y) ? { action: { kind: 'pickup' }, confidence: 1, rationale: 'artifact' } : undefined; }" }] });
  const result = agent.nextAction({ tiles: new Map(), parcels: new Map([["p", { id: "p", x: 0, y: 0, reward: 1 }]]), me: { id: "a", name: "a", x: 0, y: 0, score: 0 }, observedAt: 0 });
  assert.equal(result.module, "candidate:artifact-pickup");
  assert.deepEqual(agent.capabilityStats(), [{ id: "artifact-pickup", invocations: 1, decisions: 1 }]);
});

test("capability artifact contract rejects pseudo-code and unstructured actions", () => {
  const base = { id: "strict-artifact", purpose: "test", activation: { hook: "decision" as const, priority: 0 }, source: "(context) => { return { action: { kind: 'pickup' }, confidence: 1, rationale: 'ok' }; }" };
  assert.doesNotThrow(() => capabilityArtifactSchema.parse(base));
  assert.throws(() => capabilityArtifactSchema.parse({ ...base, source: "(context) => { return getBestAction(context); } function getBestAction() {}" }));
  assert.throws(() => capabilityArtifactSchema.parse({ ...base, source: "(context) => { return { action: 'pickup' }; }" }));
});
