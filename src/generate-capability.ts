import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
console.log("Preparing capability generation...");

if (existsSync(".env")) process.loadEnvFile(".env");

console.log("Loading the scenario...");
const { loadScenario } = await import("./scenario-loader.js");
const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);

console.log("Loading the capability validator...");
const [{ CapabilityProposer }, { validateCapability }, { configuredModel, verifyModelConnection }, { TurnBasedEnvironment }, { CapabilityLibrary }] = await Promise.all([
  import("./capability-proposer.js"),
  import("./capability-validator.js"),
  import("./model-provider.js"),
  import("./turn-based-environment.js"),
  import("./capability-library.js"),
]);

const environment = new TurnBasedEnvironment(scenario);
const proposer = new CapabilityProposer(configuredModel());
console.log(`Generating a capability for scenario '${metadata.name}' with OpenAI-compatible/${process.env.OPENAI_MODEL ?? "qwen3.8-27b"}...`);

try {
  await verifyModelConnection();
  const proposal = await proposer.propose(
    process.env.CAPABILITY_GOAL ?? "Deliver a visible parcel while respecting the known environment constraints.",
    environment.observation(),
  );
  const validation = validateCapability(environment, proposal);
  const libraryEntry = validation.accepted
    ? await new CapabilityLibrary().add({ representation: "plan", capability: proposal }, validation)
    : undefined;
  console.log(JSON.stringify({ scenario: metadata, proposal, validation, libraryEntry }, null, 2));
  process.exitCode = validation.accepted ? 0 : 2;
} catch (error) {
  console.error("Capability generation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
