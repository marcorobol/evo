import assert from "node:assert/strict";
import test from "node:test";
import { TurnBasedEnvironment } from "../src/turn-based-environment.js";

function environment() {
  return new TurnBasedEnvironment({
    agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 },
    initialEnergy: 5,
    energyCost: 1,
    tiles: [
      { x: 0, y: 0, type: "3" },
      { x: 1, y: 0, type: "3" },
      { x: 2, y: 0, type: "2" },
    ],
    keys: [{ x: 0, y: 0 }],
    doors: [{ x: 1, y: 0 }],
    parcels: [{ id: "p1", x: 1, y: 0, reward: 10 }],
  });
}

test("does not advance through a locked door without a key", () => {
  const world = environment();
  assert.equal(world.step({ kind: "move", direction: "right" }).accepted, false);
});

test("exposes keys and doors to the capability generator", () => {
  const beliefs = environment().observation();
  assert.deepEqual(beliefs.keys, [{ x: 0, y: 0 }]);
  assert.deepEqual(beliefs.doors, [{ x: 1, y: 0 }]);
});

test("uses a picked-up key to reach and deliver a parcel one turn at a time", () => {
  const world = environment();
  assert.equal(world.step({ kind: "pickup" }).accepted, true);
  assert.equal(world.step({ kind: "move", direction: "right" }).accepted, true);
  assert.equal(world.step({ kind: "pickup" }).accepted, true);
  assert.equal(world.step({ kind: "move", direction: "right" }).accepted, true);
  const result = world.step({ kind: "putdown" });
  assert.equal(result.accepted, true);
  assert.equal(result.observation.me?.score, 10);
  assert.equal(result.observation.parcels.size, 0);
});
