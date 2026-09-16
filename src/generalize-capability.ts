import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CapabilityLibrary } from "./capability-library.js";
import { CodeCapabilityProposer } from "./code-capability-proposer.js";
import { validateCodeCapability } from "./code-capability-validator.js";
import { configuredModel, verifyModelConnection } from "./model-provider.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const referencePath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const mirrorPath = fileURLToPath(new URL("../scenarios/key-door-delivery-mirror.v1.json", import.meta.url));
const [{ scenario: referenceScenario }, { scenario: mirrorScenario }] = await Promise.all([loadScenario(referencePath), loadScenario(mirrorPath)]);
const reference = new TurnBasedEnvironment(referenceScenario);
const mirror = new TurnBasedEnvironment(mirrorScenario);
const library = new CapabilityLibrary();
const seed = (await library.list()).find((entry) => entry.representation === "plan" && entry.capability.name === (process.env.SOURCE_CAPABILITY ?? "key-door-parcel-delivery"));

if (!seed || seed.representation !== "plan") {
  throw new Error("No validated JSON seed capability was found. Set SOURCE_CAPABILITY if needed.");
}

await verifyModelConnection();
const capability = await new CodeCapabilityProposer(configuredModel()).generalize(seed.capability, reference.observation());
const referenceValidation = validateCodeCapability(reference, capability).validation;
const mirrorValidation = validateCodeCapability(mirror, capability).validation;
const accepted = referenceValidation.accepted && mirrorValidation.accepted;
const libraryEntry = accepted
  ? await library.add({ representation: "code", capability }, referenceValidation)
  : undefined;
console.log(JSON.stringify({ seed: seed.capability.name, capability, referenceValidation, mirrorValidation, accepted, libraryEntry }, null, 2));
process.exitCode = accepted ? 0 : 2;
