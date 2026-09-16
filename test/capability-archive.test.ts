import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { archiveCapability, findSimilarCapability, loadCapabilityArchive } from "../src/agent-workspace/capability-archive.js";

test("capability archive preserves rejected proposals as reusable evidence", async () => {
  // The production archive is fixed; this test only verifies the record shape
  // through a real immutable write and then removes its own unique artifact.
  const runID = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = await archiveCapability({ runID, attempt: 1, model: "test", createdAt: new Date().toISOString(), accepted: false, reason: "not enough evidence", proposal: { id: "candidate-a", source: "x" } });
  const all = await loadCapabilityArchive();
  const stored = all.find((entry) => entry.runID === runID);
  assert.deepEqual(stored?.proposal, { id: "candidate-a", source: "x" });
  await rm(path, { force: true });
});

test("duplicate guard rejects a repeated capability but permits a distinct hypothesis", () => {
  const archive = [{ runID: "old", attempt: 1, model: "test", createdAt: "now", accepted: false, reason: "no gain", proposal: { id: "energy-model", module: "energy-model", files: [{ content: "export function choose() { return 1; }" }] } }];
  assert.equal(findSimilarCapability({ id: "energy-model", module: "energy-model", files: [{ content: "export function choose() { return 1; }" }] }, archive)?.id, "energy-model");
  assert.equal(findSimilarCapability({ id: "frontier-model", module: "frontier-model", files: [{ content: "export function discover(state) { return state.tiles.length; }" }] }, archive), undefined);
});

test("duplicate guard can recover a proposal preserved only as raw JSON", () => {
  const proposal = { id: "door-model", module: "door-model", files: [{ content: "export function decide() { return 'key'; }" }] };
  const archive = [{ runID: "old", attempt: 1, model: "test", createdAt: "now", accepted: false, reason: "runtime error", raw: JSON.stringify(proposal) }];
  assert.equal(findSimilarCapability(proposal, archive)?.id, "door-model");
});
