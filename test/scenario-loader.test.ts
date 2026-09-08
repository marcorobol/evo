import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadScenario } from "../src/scenario-loader.js";

test("loads the versioned key-door scenario", async () => {
  const path = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
  const { metadata, scenario } = await loadScenario(path);
  assert.equal(metadata.version, 1);
  assert.equal(metadata.name, "key-door-delivery");
  assert.equal(scenario.doors?.length, 1);
  assert.equal(scenario.keys?.length, 1);
});
