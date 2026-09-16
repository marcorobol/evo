import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateModulePatch, modulePatchProposalSchema } from "../src/agent-workspace/module-patch.js";
import { batteryReturnFamily } from "../src/agent-workspace/scenario-families.js";

test("module patch schema permits only the declared module surface", async () => {
  const proposal = modulePatchProposalSchema.parse({
    id: "navigation-revision", module: "navigation", bottleneck: "test", rationale: "test", expectedMetric: "test",
    files: [{ path: "src/agent-workspace/navigation.ts", content: "export const test = 1;" }],
  });
  assert.equal(proposal.module, "navigation");
  await assert.rejects(evaluateModulePatch({ ...proposal, files: [{ path: "package.json", content: "{}" }] }, [], []), /outside the declared evolvable workspace surface/);
});

test("module revision runs in a disposable clone and rejects a no-op", { timeout: 20_000 }, async () => {
  const source = await readFile("src/agent-workspace/navigation.ts", "utf8");
  const proposal = modulePatchProposalSchema.parse({
    id: "navigation-noop", module: "navigation", bottleneck: "No-op validation.", rationale: "Same source must not be promoted.", expectedMetric: "No fitness improvement.",
    files: [{ path: "src/agent-workspace/navigation.ts", content: source }],
  });
  const family = batteryReturnFamily([11], []);
  const evaluation = await evaluateModulePatch(proposal, family.training, family.holdout);
  assert.equal(evaluation.accepted, false);
  assert.match(evaluation.reason, /did not improve/);
});
