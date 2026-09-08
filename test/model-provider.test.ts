import assert from "node:assert/strict";
import test from "node:test";
import { parseLmStudioResponse } from "../src/model-provider.js";

test("uses a local reasoning model's structured response when content is empty", () => {
  const proposal = { name: "deliver", plan: [] };
  assert.deepEqual(
    parseLmStudioResponse({ choices: [{ message: { content: "", reasoning_content: JSON.stringify(proposal) } }] }),
    proposal,
  );
});

test("prefers ordinary content when it is present", () => {
  assert.deepEqual(
    parseLmStudioResponse({ choices: [{ message: { content: '{"name":"ordinary"}', reasoning_content: '{"name":"reasoning"}' } }] }),
    { name: "ordinary" },
  );
});
