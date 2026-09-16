import assert from "node:assert/strict";
import test from "node:test";
import { loadRequirementBacklog } from "../src/agent-workspace/requirements.js";

test("research backlog exposes only benchmark-backed requirements as ready", async () => {
  const backlog = await loadRequirementBacklog();
  assert.ok(backlog.requirements.some((item) => item.id === "heatmap-frontier-exploration" && item.status === "ready"));
  assert.ok(backlog.requirements.some((item) => item.id === "multi-agent-task-reservation" && item.status === "blocked-by-benchmark"));
});
