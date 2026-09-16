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

interface EpisodeMetric {
  scenario: string;
  outcome: "reused" | "evolved" | "unresolved";
  capability?: string;
  reuseCandidate?: string;
  explorationSteps: number;
  scoreDelta: number;
}

if (existsSync(".env")) process.loadEnvFile(".env");
const scenariosDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));
const order = [
  "key-door-delivery.v1.json",
  "key-door-delivery-mirror.v1.json",
  "simple-delivery.v1.json",
  "double-delivery.v1.json",
  "two-parcels.v1.json",
  "battery-return.v1.json",
  "detour-delivery.v1.json",
];
const library = new GenericCapabilityLibrary();
const runner = await createOpenCodeCapabilityRunner();
const metrics: EpisodeMetric[] = [];

try {
  const explorer = new GenericExplorer(runner.model);
  for (const filename of order) {
    const { metadata, scenario } = await loadScenario(`${scenariosDirectory}/${filename}`);
    const environment = new TurnBasedAdapter(new TurnBasedEnvironment(scenario));
    const reusable = await library.bestFor(metadata.description);
    const reused = reusable && validateGenericCapability(environment, reusable.capability, decodeTurnBasedAction);
    if (reused?.accepted) {
      await library.recordUse(reusable.id);
      metrics.push({ scenario: metadata.name, outcome: "reused", capability: reusable.capability.name, reuseCandidate: reusable.capability.name, explorationSteps: 0, scoreDelta: reused.scoreDelta });
      continue;
    }

    console.log(`[evaluate] exploring '${metadata.name}' after reuse miss`);
    const trace = await explorer.explore(environment, decodeTurnBasedAction);
    if (!trace.outcome.achieved) {
      metrics.push({ scenario: metadata.name, outcome: "unresolved", reuseCandidate: reusable?.capability.name, explorationSteps: trace.steps.length, scoreDelta: trace.outcome.score });
      continue;
    }
    const capability = await explorer.generalizeSuccessfulTrace(metadata.description, trace);
    const validation = validateGenericCapability(new TurnBasedAdapter(new TurnBasedEnvironment(scenario)), capability, decodeTurnBasedAction);
    if (validation.accepted) await library.add(capability, validation);
    metrics.push({ scenario: metadata.name, outcome: validation.accepted ? "evolved" : "unresolved", capability: capability.name, reuseCandidate: reusable?.capability.name, explorationSteps: trace.steps.length, scoreDelta: validation.scoreDelta });
  }
} finally {
  runner.close();
}

const report = {
  timestamp: new Date().toISOString(),
  backend: "opencode-sdk",
  model: `${process.env.OPENCODE_PROVIDER ?? "unitn-litellm"}/${process.env.OPENAI_MODEL ?? "qwen3.8-27b"}`,
  episodes: metrics,
  summary: {
    reused: metrics.filter((episode) => episode.outcome === "reused").length,
    evolved: metrics.filter((episode) => episode.outcome === "evolved").length,
    unresolved: metrics.filter((episode) => episode.outcome === "unresolved").length,
    explorationSteps: metrics.reduce((total, episode) => total + episode.explorationSteps, 0),
  },
};
const reportPath = "reports/generic-opencode-curriculum.json";
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
