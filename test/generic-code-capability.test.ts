import assert from "node:assert/strict";
import test from "node:test";
import type { GenericCodeCapability } from "../src/generic-code-capability.js";
import { executeGenericCodeCapability, validateGenericCodeCapability } from "../src/generic-code-capability.js";
import { TurnBasedAdapter, decodeTurnBasedAction } from "../src/turn-based-adapter.js";
import { TurnBasedEnvironment } from "../src/turn-based-environment.js";

const capability: GenericCodeCapability = {
  name: "generic-key-door-delivery",
  goal: "Deliver the observed parcel.",
  applicability: "An observed door separates the agent from a parcel and the movement direction can be inferred from coordinates.",
  source: "(context) => { const door = context.observation.doors[0]; const me = context.observation.me; const direction = door.x > me.x ? 'right' : 'left'; return [{ kind: 'pickup' }, { kind: 'move', direction }, { kind: 'pickup' }, { kind: 'move', direction }, { kind: 'putdown' }]; }",
  rationale: "The source only reads the supplied observation and derives a direction from observed coordinates.",
};

function environment(mirrored = false) {
  return new TurnBasedAdapter(new TurnBasedEnvironment(mirrored
    ? {
      agent: { id: "agent", name: "agent", x: 2, y: 0, score: 0 },
      tiles: [{ x: 0, y: 0, type: "2" }, { x: 1, y: 0, type: "3" }, { x: 2, y: 0, type: "3" }],
      keys: [{ x: 2, y: 0 }], doors: [{ x: 1, y: 0 }], parcels: [{ id: "parcel", x: 1, y: 0, reward: 10 }],
    }
    : {
      agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 },
      tiles: [{ x: 0, y: 0, type: "3" }, { x: 1, y: 0, type: "3" }, { x: 2, y: 0, type: "2" }],
      keys: [{ x: 0, y: 0 }], doors: [{ x: 1, y: 0 }], parcels: [{ id: "parcel", x: 1, y: 0, reward: 10 }],
    }));
}

test("runs a generic generated program on both observed orientations", () => {
  assert.equal(validateGenericCodeCapability(environment(), capability, decodeTurnBasedAction).accepted, true);
  assert.equal(validateGenericCodeCapability(environment(true), capability, decodeTurnBasedAction).scoreDelta, 10);
});

test("does not grant generated code host access", () => {
  assert.throws(() => executeGenericCodeCapability({ ...capability, source: "() => process.exit()" }, environment().observe()), /forbidden/);
});
