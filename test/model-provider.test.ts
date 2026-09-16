import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenAICompatibleResponse } from "../src/model-provider.js";

test("uses a local reasoning model's structured response when content is empty", () => {
  const proposal = { name: "deliver", plan: [] };
  assert.deepEqual(
    parseOpenAICompatibleResponse({ choices: [{ message: { content: "", reasoning_content: JSON.stringify(proposal) } }] }),
    proposal,
  );
});

test("prefers ordinary content when it is present", () => {
  assert.deepEqual(
    parseOpenAICompatibleResponse({ choices: [{ message: { content: '{"name":"ordinary"}', reasoning_content: '{"name":"reasoning"}' } }] }),
    { name: "ordinary" },
  );
});
