import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GenericCapabilityLibrary } from "./generic-capability-library.js";
import { GenericCapabilityProposer } from "./generic-capability-proposer.js";
import { validateGenericCapability } from "./generic-capability.js";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedAdapter, decodeTurnBasedAction } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);
const environment = new TurnBasedAdapter(new TurnBasedEnvironment(scenario));
const runner = await createOpenCodeCapabilityRunner();

try {
  const capability = await new GenericCapabilityProposer(runner.model).propose(
    metadata.description,
    environment.manifest,
    environment.observe(),
  );
  const validation = validateGenericCapability(environment, capability, decodeTurnBasedAction);
  const entry = validation.accepted ? await new GenericCapabilityLibrary().add(capability, validation) : undefined;
  console.log(JSON.stringify({ backend: "opencode-sdk", model: process.env.LLM_MODEL, capability, validation, entry }, null, 2));
  process.exitCode = validation.accepted ? 0 : 2;
} finally {
  runner.close();
}
