import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GenericExplorer } from "./generic-explorer.js";
import { GenericCapabilityLibrary } from "./generic-capability-library.js";
import { validateGenericCapability } from "./generic-capability.js";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedAdapter, decodeTurnBasedAction } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);
console.log(`[explore] loaded deterministic scenario '${metadata.name}'`);
console.log("[explore] preparing OpenCode-backed explorer");
const runner = await createOpenCodeCapabilityRunner();

try {
  const explorer = new GenericExplorer(runner.model);
  const trace = await explorer.explore(new TurnBasedAdapter(new TurnBasedEnvironment(scenario)), decodeTurnBasedAction);
  const capability = trace.outcome.achieved ? await explorer.generalizeSuccessfulTrace(metadata.description, trace) : undefined;
  const validation = capability
    ? validateGenericCapability(new TurnBasedAdapter(new TurnBasedEnvironment(scenario)), capability, decodeTurnBasedAction)
    : undefined;
  const entry = capability && validation?.accepted ? await new GenericCapabilityLibrary().add(capability, validation) : undefined;
  console.log(JSON.stringify({ backend: "opencode-sdk", trace, capability, validation, entry }, null, 2));
  process.exitCode = trace.outcome.achieved && validation?.accepted ? 0 : 2;
} finally {
  runner.close();
}
