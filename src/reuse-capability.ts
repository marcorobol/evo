import { fileURLToPath } from "node:url";
import { CapabilityLibrary } from "./capability-library.js";
import { validateCapability } from "./capability-validator.js";
import { validateCodeCapability } from "./code-capability-validator.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);
const environment = new TurnBasedEnvironment(scenario);
const goal = process.env.CAPABILITY_GOAL ?? "Deliver a visible parcel while respecting the known environment constraints.";
const library = new CapabilityLibrary();
const selected = await library.bestFor(goal, environment.observation());

if (!selected) {
  console.error("No reusable capability is available in the library.");
  process.exitCode = 2;
} else {
  const validation = selected.representation === "plan"
    ? validateCapability(environment, selected.capability)
    : validateCodeCapability(environment, selected.capability).validation;
  if (validation.accepted) await library.recordUse(selected.id);
  console.log(JSON.stringify({ scenario: metadata, selected, validation, reused: validation.accepted }, null, 2));
  process.exitCode = validation.accepted ? 0 : 2;
}
