import assert from "node:assert/strict";
import test from "node:test";
import { capabilityProposalSchema } from "../src/capability-contract.js";

test("rejects proposals that invent an unsupported action", () => {
  const result = capabilityProposalSchema.safeParse({
    name: "recharge-plan",
    goal: "Recharge the battery.",
    applicability: "Battery is low.",
    preconditions: { requiresKey: false, requiresDoor: false, requiresBattery: true, minimumParcels: 0 },
    plan: [{ kind: "recharge" }],
    rationale: "The agent should recharge.",
  });
  assert.equal(result.success, false);
});

test("accepts a proposal composed of allowed primitives", () => {
  const result = capabilityProposalSchema.safeParse({
    name: "deliver-visible-parcel",
    goal: "Deliver the selected parcel.",
    applicability: "A parcel and a delivery tile are known.",
    preconditions: { requiresKey: false, requiresDoor: false, requiresBattery: false, minimumParcels: 1 },
    plan: [{ kind: "move", direction: "right" }, { kind: "pickup" }],
    rationale: "The first move reaches the parcel.",
  });
  assert.equal(result.success, true);
});
