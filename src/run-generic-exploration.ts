import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GenericExplorer } from "./generic-explorer.js";
import { GenericCapabilityLibrary } from "./generic-capability-library.js";
import { validateGenericCapability, type GenericValidation } from "./generic-capability.js";
import {
  GenericCodeSynthesizer,
  validateGenericCodeCapability,
  writeGenericCodeCapability,
  type GenericCodeCapability,
} from "./generic-code-capability.js";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedAdapter, decodeTurnBasedAction } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const mirrorScenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery-mirror.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);
const { scenario: mirrorScenario } = await loadScenario(mirrorScenarioPath);
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
  console.log("[explore] synthesizing a reusable code capability from the validated trace");
  const synthesizer = new GenericCodeSynthesizer(runner.model);
  let codeCapability: GenericCodeCapability | undefined;
  let codeValidation: GenericValidation | undefined;
  let mirrorValidation: GenericValidation | undefined;
  let codeError: string | undefined;
  if (trace.outcome.achieved) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        codeCapability = attempt === 0
          ? await synthesizer.synthesize(metadata.description, trace)
          : await synthesizer.repair(metadata.description, trace, codeCapability!, { reference: codeValidation, mirror: mirrorValidation });
        codeValidation = validateGenericCodeCapability(
          new TurnBasedAdapter(new TurnBasedEnvironment(scenario)), codeCapability, decodeTurnBasedAction,
        );
        mirrorValidation = validateGenericCodeCapability(
          new TurnBasedAdapter(new TurnBasedEnvironment(mirrorScenario)), codeCapability, decodeTurnBasedAction,
        );
        console.log(`[explore] code candidate ${attempt + 1}/3: reference=${codeValidation.accepted}, mirror=${mirrorValidation.accepted}`);
        if (codeValidation.accepted && mirrorValidation.accepted) break;
      } catch (error) {
        codeError = error instanceof Error ? error.message : String(error);
        console.log(`[explore] code candidate ${attempt + 1}/3 rejected before validation: ${codeError}`);
        if (codeCapability === undefined) break;
      }
    }
  }
  const generatedCodePath = codeCapability && codeValidation?.accepted && mirrorValidation?.accepted
    ? await writeGenericCodeCapability(codeCapability)
    : undefined;
  console.log(JSON.stringify({
    backend: "opencode-sdk", trace, capability, validation, entry,
    codeCapability, codeValidation, mirrorValidation, codeError, generatedCodePath,
  }, null, 2));
  process.exitCode = trace.outcome.achieved && validation?.accepted && codeValidation?.accepted && mirrorValidation?.accepted ? 0 : 2;
} finally {
  runner.close();
}
