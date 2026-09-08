import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericCapabilityLibrary } from "./generic-capability-library.js";
import { validateGenericCapability } from "./generic-capability.js";
import { GenericExplorer } from "./generic-explorer.js";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedAdapter, decodeTurnBasedAction } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

interface DiscoveryEpisode {
  scenario: string;
  achieved: boolean;
  steps: number;
  score: number;
  learnedCapability?: string;
}

if (existsSync(".env")) process.loadEnvFile(".env");
const runID = process.env.DISCOVERY_RUN_ID ?? `discovery-${Date.now()}`;
const maximumSteps = Number.parseInt(process.env.DISCOVERY_MAX_STEPS ?? "20", 10);
if (!Number.isSafeInteger(maximumSteps) || maximumSteps < 1) throw new Error("DISCOVERY_MAX_STEPS must be a positive integer.");

const scenariosDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));
// The order deliberately starts with simple feedback, then adds gates, symmetry,
// resource constraints, and multi-object behaviour. The agent sees only each
// environment's manifest and observations, not these hidden labels or rules.
const curriculum = [
  "simple-delivery.v1.json",
  "key-door-delivery.v1.json",
  "key-door-delivery-mirror.v1.json",
  "double-delivery.v1.json",
  "two-parcels.v1.json",
  "battery-return.v1.json",
  "detour-delivery.v1.json",
];
const library = new GenericCapabilityLibrary(`capabilities/${runID}.json`);
const reportPath = `reports/${runID}.json`;
const episodes: DiscoveryEpisode[] = [];

async function checkpoint(): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ runID, maximumSteps, episodes, libraryPath: `capabilities/${runID}.json` }, null, 2)}\n`);
}

console.log(`[discovery] starting fresh run '${runID}' with ${maximumSteps} actions per environment`);
const runner = await createOpenCodeCapabilityRunner();
try {
  const explorer = new GenericExplorer(runner.model);
  for (const filename of curriculum) {
    const { metadata, scenario } = await loadScenario(`${scenariosDirectory}/${filename}`);
    console.log(`\n[discovery] entering new environment '${metadata.name}'`);
    const environment = new TurnBasedAdapter(new TurnBasedEnvironment(scenario));
    const trace = await explorer.explore(environment, decodeTurnBasedAction, maximumSteps);
    let learnedCapability: string | undefined;
    if (trace.outcome.achieved) {
      const capability = await explorer.generalizeSuccessfulTrace(metadata.description, trace);
      const validation = validateGenericCapability(new TurnBasedAdapter(new TurnBasedEnvironment(scenario)), capability, decodeTurnBasedAction);
      if (validation.accepted) {
        await library.add(capability, validation);
        learnedCapability = capability.name;
      }
    }
    episodes.push({ scenario: metadata.name, achieved: trace.outcome.achieved, steps: trace.steps.length, score: trace.outcome.score, ...(learnedCapability ? { learnedCapability } : {}) });
    await checkpoint();
  }
} finally {
  runner.close();
}

console.log(`\n[discovery] complete. Checkpoint: ${reportPath}`);
