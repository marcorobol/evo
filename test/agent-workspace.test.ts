import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../src/agent-workspace/benchmark-runner.js";
import { runPartialObservationBenchmark } from "../src/agent-workspace/benchmark-runner.js";
import { diagnose } from "../src/agent-workspace/diagnostics.js";
import { createEvolvingAgent } from "../src/agent-workspace/evolving-agent.js";
import { findPath } from "../src/agent-workspace/navigation.js";
import { HeatmapMemory } from "../src/agent-workspace/memory.js";
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
      return next ? { action: { kind: "move", direction: next.direction }, confidence: 1, rationale: "frontier only" } : undefined;
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
