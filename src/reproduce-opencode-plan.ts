import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedAdapter } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const providerID = process.env.OPENCODE_PROVIDER ?? "lmstudio";
const modelName = process.env.LLM_MODEL ?? "qwen/qwen3.8-27b";
const modelID = modelName.startsWith(`${providerID}/`) ? modelName.slice(providerID.length + 1) : modelName;
if (!modelID) throw new Error("LLM_MODEL must name an LM Studio model.");

const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);
const environment = new TurnBasedAdapter(new TurnBasedEnvironment(scenario));
const system = [
  "You discover a capability for an unknown environment.",
  "Return exactly one JSON object with name, goal, applicability, actions, and rationale.",
  "Use only actions declared in the supplied manifest, with exactly their documented JSON inputs.",
  "Do not assume domain concepts beyond the manifest and observation. Do not write code or call tools.",
  "Return JSON only. This is a read-only planning task: do not call tools.",
].join(" ");
const prompt = JSON.stringify({ goal: metadata.description, manifest: environment.manifest, observation: environment.observe() });

console.log(JSON.stringify({ request: { model: `${providerID}/${modelID}`, system, prompt } }, null, 2));
console.log("[reproduce] loading stable SDK package");
const { createOpencode } = await Promise.race([
  import("@opencode-ai/sdk"),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OpenCode SDK import exceeded 120s.")), 120_000)),
]);
const opencode = await createOpencode({ timeout: 30_000 });

try {
  await opencode.client.project.list();
  const session = await opencode.client.session.create({ body: { title: "Reproduce structured plan request" } });
  if (!session.data) throw new Error("OpenCode did not create a session.");
  const response = await opencode.client.session.prompt({
    path: { id: session.data.id },
    body: { model: { providerID, modelID }, tools: {}, system, parts: [{ type: "text", text: prompt }] },
  });
  console.log(JSON.stringify({ response: response.data, error: response.error }, null, 2));
} finally {
  opencode.server.close();
}
