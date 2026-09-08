import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GenericCapabilityLibrary } from "./generic-capability-library.js";
import { GenericCapabilityProposer } from "./generic-capability-proposer.js";
import { validateGenericCapability } from "./generic-capability.js";
import { configuredModel, verifyLmStudioConnection } from "./model-provider.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedAdapter, decodeTurnBasedAction } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const directory = fileURLToPath(new URL("../scenarios/", import.meta.url));
const files = (await readdir(directory)).filter((file) => file.endsWith(".v1.json")).sort();
const library = new GenericCapabilityLibrary();
const proposer = new GenericCapabilityProposer(configuredModel());
await verifyLmStudioConnection(process.env.LLM_BASE_URL ?? "http://localhost:1234/v1");
const episodes: Array<{ scenario: string; outcome: "reused" | "evolved" | "rejected"; capability?: string; scoreDelta?: number }> = [];

for (const file of files) {
  const { metadata, scenario } = await loadScenario(`${directory}/${file}`);
  const environment = new TurnBasedAdapter(new TurnBasedEnvironment(scenario));
  const reusable = await library.bestFor(metadata.description);
  if (reusable) {
    const validation = validateGenericCapability(environment, reusable.capability, decodeTurnBasedAction);
    if (validation.accepted) {
      await library.recordUse(reusable.id);
      episodes.push({ scenario: metadata.name, outcome: "reused", capability: reusable.capability.name, scoreDelta: validation.scoreDelta });
      continue;
    }
  }
  const candidate = await proposer.propose(metadata.description, environment.manifest, environment.observe());
  const validation = validateGenericCapability(environment, candidate, decodeTurnBasedAction);
  if (validation.accepted) {
    await library.add(candidate, validation);
    episodes.push({ scenario: metadata.name, outcome: "evolved", capability: candidate.name, scoreDelta: validation.scoreDelta });
  } else episodes.push({ scenario: metadata.name, outcome: "rejected", capability: candidate.name, scoreDelta: validation.scoreDelta });
}
console.log(JSON.stringify({ episodes, librarySize: (await library.list()).length }, null, 2));
