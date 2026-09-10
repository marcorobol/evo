import assert from "node:assert/strict";
import test from "node:test";
import { OnlineExplorer } from "../src/online-explorer.js";
import type { BeliefState } from "../src/domain.js";

function state(): BeliefState {
  return { observedAt: 0, tiles: new Map(), parcels: new Map(), me: { id: "a", name: "agent", x: 0, y: 0, score: 0 } };
}

test("tries each movement direction before repeating one at an empty position", () => {
  const explorer = new OnlineExplorer();
  const world = state();
  const actions = [];
  for (let index = 0; index < 4; index += 1) {
    const action = explorer.next(world).action;
    assert.equal(action.kind, "move");
    actions.push(action.direction);
    explorer.observe(world, action, { ok: false, detail: false });
  }
  assert.deepEqual(actions, ["up", "right", "down", "left"]);
});
