import assert from "node:assert/strict";
import test from "node:test";
import { GenericExplorer } from "../src/generic-explorer.js";
import { TurnBasedAdapter, decodeTurnBasedAction } from "../src/turn-based-adapter.js";
import { TurnBasedEnvironment } from "../src/turn-based-environment.js";

test("normalizes concise string actions from a planner", async () => {
  const replies = [
    { action: "pickup", hypothesis: "Collect the object here." },
    { action: "putdown", hypothesis: "Test whether this position accepts the object." },
  ];
  const explorer = new GenericExplorer({ generate: async () => replies.shift() });
  const environment = new TurnBasedAdapter(new TurnBasedEnvironment({
    agent: { id: "agent", name: "agent", x: 0, y: 0, score: 0 },
    tiles: [{ x: 0, y: 0, type: "2" }],
    parcels: [{ id: "parcel", x: 0, y: 0, reward: 5 }],
  }));
  const trace = await explorer.explore(environment, decodeTurnBasedAction, 2);
  assert.equal(trace.outcome.achieved, true);
  assert.deepEqual(trace.steps.map((step) => step.action), [{ kind: "pickup" }, { kind: "putdown" }]);
});
