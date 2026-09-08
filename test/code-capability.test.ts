import assert from "node:assert/strict";
import test from "node:test";
import type { CodeCapability } from "../src/capability-contract.js";
import { validateCodeCapability } from "../src/code-capability-validator.js";
import { TurnBasedEnvironment } from "../src/turn-based-environment.js";

const capability: CodeCapability = {
  name: "deliver-through-known-door",
  goal: "Deliver a parcel through a known door.",
  applicability: "A key starts under the agent and a parcel is behind the door.",
  preconditions: { requiresKey: true, requiresDoor: true, requiresBattery: false, minimumParcels: 1 },
  source: "(context) => context.keys.length > 0 ? [{ kind: 'pickup' }, { kind: 'move', direction: 'right' }, { kind: 'pickup' }, { kind: 'move', direction: 'right' }, { kind: 'putdown' }] : [{ kind: 'wait', reason: 'No key available.' }]",
  rationale: "The code adapts to whether a key is still available.",
};

test("executes and validates a procedural capability in the isolated environment", () => {
  const environment = new TurnBasedEnvironment({
    agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 },
    tiles: [{ x: 0, y: 0, type: "3" }, { x: 1, y: 0, type: "3" }, { x: 2, y: 0, type: "2" }],
    keys: [{ x: 0, y: 0 }],
    doors: [{ x: 1, y: 0 }],
    parcels: [{ id: "parcel", x: 1, y: 0, reward: 10 }],
  });
  const result = validateCodeCapability(environment, capability);
  assert.equal(result.validation.accepted, true);
  assert.equal(result.validation.rewardDelta, 10);
});

test("rejects code with access to host capabilities", () => {
  const unsafe = { ...capability, source: "() => process.exit()" };
  const environment = new TurnBasedEnvironment({ agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 }, tiles: [{ x: 0, y: 0, type: "2" }] });
  assert.throws(() => validateCodeCapability(environment, unsafe), /forbidden/);
});

test("generalizes a key-door plan across mirrored directions", () => {
  const generalized: CodeCapability = {
    ...capability,
    name: "generalized-key-door-delivery",
    source: "(context) => { const door = context.doors[0]; const direction = door.x > context.me.x ? 'right' : 'left'; return [{ kind: 'pickup' }, { kind: 'move', direction }, { kind: 'pickup' }, { kind: 'move', direction }, { kind: 'putdown' }]; }",
  };
  const mirror = new TurnBasedEnvironment({
    agent: { id: "agent", name: "agent", x: 2, y: 0, score: 0 },
    tiles: [{ x: 0, y: 0, type: "2" }, { x: 1, y: 0, type: "3" }, { x: 2, y: 0, type: "3" }],
    keys: [{ x: 2, y: 0 }],
    doors: [{ x: 1, y: 0 }],
    parcels: [{ id: "parcel", x: 1, y: 0, reward: 10 }],
  });
  assert.equal(validateCodeCapability(mirror, generalized).validation.accepted, true);
});
