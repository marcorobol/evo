import assert from "node:assert/strict";
import test from "node:test";
import { BeliefStore } from "../src/belief-store.js";
import { DeliverooLiveAdapter } from "../src/deliveroo-live-adapter.js";

test("translates an action through the live boundary and exposes only generic observation", async () => {
  const beliefs = new BeliefStore();
  beliefs.apply({ type: "map", width: 2, height: 1, tiles: [{ x: 0, y: 0, type: "1" }, { x: 1, y: 0, type: "2" }] });
  beliefs.apply({ type: "you", agent: { id: "a", name: "agent", x: 0, y: 0, score: 0 } });
  beliefs.apply({ type: "sensing", parcels: [{ id: "p", x: 1, y: 0, reward: 10 }] });
  const actions: string[] = [];
  const adapter = new DeliverooLiveAdapter(beliefs, { execute: async (action) => {
    actions.push(action.kind);
    return { ok: true, detail: "ok" };
  } }, 0);

  const result = await adapter.step({ kind: "move", direction: "right" });
  assert.equal(result.accepted, true);
  assert.deepEqual(actions, ["move"]);
  assert.deepEqual(adapter.observe().parcels, [{ id: "p", x: 1, y: 0, reward: 10 }]);
  assert.throws(() => adapter.fork(), /cannot be forked/);
});
