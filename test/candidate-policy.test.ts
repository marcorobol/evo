import assert from "node:assert/strict";
import test from "node:test";
import { compileCandidate, candidateProposalSchema } from "../src/agent-workspace/candidate-policy.js";
import { evaluateCandidate } from "../src/agent-workspace/candidate-evaluator.js";
import { loadScenario } from "../src/scenario-loader.js";
import { fileURLToPath } from "node:url";

const proposal = candidateProposalSchema.parse({
  id: "test-pickup-extension",
  bottleneck: "Direct co-located parcels require pickup before route planning.",
  module: "task-selection",
  rationale: "Use observed co-location only.",
  expectedMetric: "No loss on direct delivery.",
  source: "(context) => { const me = context.observation.me; const parcel = context.observation.parcels.find((p) => !p.carriedBy && me && p.x === me.x && p.y === me.y); return parcel ? { action: { kind: 'pickup' }, confidence: 1, rationale: 'Pick up co-located work.' } : undefined; }",
});

test("candidate extension executes through the narrow decision contract", () => {
  const extension = compileCandidate(proposal);
  const result = extension({
    observation: { me: { id: "a", x: 0, y: 0, score: 0 }, tiles: [], parcels: [{ id: "p", x: 0, y: 0, reward: 1 }], keys: [], doors: [], batteries: [] },
    baseline: { action: { kind: "wait", reason: "baseline" }, confidence: 0, rationale: "baseline", module: "baseline" }, memory: [],
  });
  assert.deepEqual(result?.action, { kind: "pickup" });
  assert.equal(result?.module, "candidate:test-pickup-extension");
});

test("candidate evaluator rejects a candidate that does not improve training", async () => {
  const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
  const loaded = await loadScenario(`${root}/simple-delivery.v1.json`);
  const evaluation = evaluateCandidate(proposal, [{ name: loaded.metadata.name, scenario: loaded.scenario }], []);
  assert.equal(evaluation.accepted, false);
  assert.match(evaluation.reason, /did not improve/);
});

test("candidate schema rejects code that bypasses the observation boundary", () => {
  assert.throws(() => candidateProposalSchema.parse({ ...proposal, id: "invalid-context-access", source: "(context) => context.me ? { action: { kind: 'pickup' } } : undefined" }), /context\.observation/);
});
