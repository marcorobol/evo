import assert from "node:assert/strict";
import test from "node:test";
import { nextBaselineAction } from "../src/baseline-policy.js";
import type { BeliefState } from "../src/domain.js";

function state(overrides: Partial<BeliefState> = {}): BeliefState {
  return {
    observedAt: 0,
    tiles: new Map([
      ["0,0", { x: 0, y: 0, type: "3" }],
      ["1,0", { x: 1, y: 0, type: "3" }],
      ["2,0", { x: 2, y: 0, type: "2" }],
    ]),
    parcels: new Map(),
    me: { id: "me", name: "agent", x: 0, y: 0, score: 0 },
    ...overrides,
  };
}

test("moves towards a visible parcel", () => {
  const beliefs = state({ parcels: new Map([["p", { id: "p", x: 1, y: 0, reward: 1 }]]) });
  assert.deepEqual(nextBaselineAction(beliefs), { kind: "move", direction: "right" });
});

test("delivers a carried parcel", () => {
  const beliefs = state({
    parcels: new Map([["p", { id: "p", x: 0, y: 0, reward: 1, carriedBy: "me" }]]),
  });
  assert.deepEqual(nextBaselineAction(beliefs), { kind: "move", direction: "right" });
});

test("picks up a parcel on its tile", () => {
  const beliefs = state({ parcels: new Map([["p", { id: "p", x: 0, y: 0, reward: 1 }]]) });
  assert.deepEqual(nextBaselineAction(beliefs), { kind: "pickup" });
});
