import assert from "node:assert/strict";
import test from "node:test";
import { validateCapability } from "../src/capability-validator.js";
import { TurnBasedEnvironment } from "../src/turn-based-environment.js";

function world(): TurnBasedEnvironment {
  return new TurnBasedEnvironment({
    agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 },
    tiles: [
      { x: 0, y: 0, type: "3" },
      { x: 1, y: 0, type: "3" },
      { x: 2, y: 0, type: "2" },
    ],
    parcels: [{ id: "p1", x: 1, y: 0, reward: 10 }],
  });
}

test("scores a successful capability without modifying the source episode", () => {
  const environment = world();
  const validation = validateCapability(environment, {
    name: "deliver-parcel",
    goal: "Deliver the visible parcel.",
    applicability: "A parcel and a delivery tile are known.",
    plan: [
      { kind: "move", direction: "right" },
      { kind: "pickup" },
      { kind: "move", direction: "right" },
      { kind: "putdown" },
    ],
    rationale: "The route is known and unobstructed.",
  });

  assert.equal(validation.accepted, true);
  assert.equal(validation.rewardDelta, 10);
  assert.ok(validation.fitness > 0);
  assert.equal(environment.observation().me?.score, 0);
  assert.equal(environment.observation().parcels.size, 1);
});

test("rejects a syntactically valid plan that does not complete a delivery", () => {
  const environment = new TurnBasedEnvironment({
    agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 },
    tiles: [{ x: 0, y: 0, type: "2" }],
    parcels: [{ id: "parcel", x: 0, y: 0, reward: 5 }],
  });
  const validation = validateCapability(environment, {
    name: "pick-up-only",
    goal: "Deliver the parcel.",
    applicability: "A parcel is on the starting tile.",
    preconditions: { requiresKey: false, requiresDoor: false, requiresBattery: false, minimumParcels: 1 },
    plan: [{ kind: "pickup" }],
    rationale: "This intentionally omits delivery.",
  });
  assert.equal(validation.accepted, false);
  assert.equal(validation.rewardDelta, 0);
});
