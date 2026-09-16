import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

console.log("Preparing procedural capability generation...");
if (existsSync(".env")) process.loadEnvFile(".env");

const [{ loadScenario }, { TurnBasedEnvironment }, { CodeCapabilityProposer }, { validateCodeCapability }, { configuredModel, verifyModelConnection }, { CapabilityLibrary }] = await Promise.all([
  import("./scenario-loader.js"),
  import("./turn-based-environment.js"),
  import("./code-capability-proposer.js"),
  import("./code-capability-validator.js"),
  import("./model-provider.js"),
  import("./capability-library.js"),
]);
const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);
const environment = new TurnBasedEnvironment(scenario);

try {
  await verifyModelConnection();
  const capability = await new CodeCapabilityProposer(configuredModel()).propose(
    process.env.CAPABILITY_GOAL ?? "Deliver a visible parcel while respecting the known environment constraints.",
    environment.observation(),
  );
  const result = validateCodeCapability(environment, capability);
  const libraryEntry = result.validation.accepted
    ? await new CapabilityLibrary().add({ representation: "code", capability }, result.validation)
    : undefined;
  console.log(JSON.stringify({ scenario: metadata, capability, ...result, libraryEntry }, null, 2));
  process.exitCode = result.validation.accepted ? 0 : 2;
} catch (error) {
  console.error("Procedural capability generation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
