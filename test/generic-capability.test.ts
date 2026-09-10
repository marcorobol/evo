import assert from "node:assert/strict";
import test from "node:test";
import { parseGenericCapability, validateGenericCapability, type GenericCapability } from "../src/generic-capability.js";
import { decodeTurnBasedAction, TurnBasedAdapter } from "../src/turn-based-adapter.js";
import { TurnBasedEnvironment } from "../src/turn-based-environment.js";

test("the domain-agnostic core validates an adapter-provided action plan", () => {
  const adapter = new TurnBasedAdapter(new TurnBasedEnvironment({
    agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 },
    tiles: [{ x: 0, y: 0, type: "2" }],
    parcels: [{ id: "parcel", x: 0, y: 0, reward: 5 }],
  }));
  const capability: GenericCapability = {
    name: "collect-and-finish",
    goal: "Complete the environment objective.",
    applicability: "The observation contains a movable object on the current position.",
    actions: [{ kind: "pickup" }, { kind: "putdown" }],
    rationale: "The adapter determines the semantics of both actions.",
  };
  const result = validateGenericCapability(adapter, capability, decodeTurnBasedAction);
  assert.equal(result.accepted, true);
  assert.equal(result.scoreDelta, 5);
});

test("accepts plan as a transport alias emitted by older model prompts", () => {
  const capability = parseGenericCapability({
    name: "legacy-plan-alias",
    goal: "Complete the objective.",
    applicability: "The trace supports this sequence.",
    plan: [{ kind: "pickup" }, { kind: "putdown" }],
    rationale: "Only the field name differs from the current contract.",
  });
  assert.equal(capability.actions.length, 2);
});
