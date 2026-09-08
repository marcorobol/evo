import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CapabilityLibrary } from "../src/capability-library.js";
import type { CapabilityProposal } from "../src/capability-contract.js";

const capability: CapabilityProposal = {
  name: "key-door-delivery",
  goal: "Deliver a parcel through a locked door.",
  applicability: "A key and door are known.",
  preconditions: { requiresKey: true, requiresDoor: true, requiresBattery: false, minimumParcels: 1 },
  plan: [{ kind: "pickup" }],
  rationale: "A minimal reusable example.",
};
const validation = { accepted: true, fitness: 10, rewardDelta: 1, successfulActions: 1, failedActions: 0, turns: [] };

test("persists validated capabilities and tracks reuse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolving-deliveroo-library-"));
  try {
    const library = new CapabilityLibrary(join(directory, "library.json"));
    const entry = await library.add({ representation: "plan", capability }, validation);
    assert.equal((await library.list()).length, 1);
    assert.equal((await library.bestFor("deliver parcel through door"))?.id, entry.id);
    await library.recordUse(entry.id);
    assert.equal((await library.list())[0]?.uses, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
