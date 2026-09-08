import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CapabilityLibrary } from "./capability-library.js";
import { CapabilityProposer } from "./capability-proposer.js";
import { validateCapability } from "./capability-validator.js";
import { validateCodeCapability } from "./code-capability-validator.js";
import { configuredModel, verifyLmStudioConnection } from "./model-provider.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const scenarioDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));
const files = (await readdir(scenarioDirectory)).filter((file) => file.endsWith(".v1.json")).sort();
const library = new CapabilityLibrary();
const proposer = new CapabilityProposer(configuredModel());
const maxRepairAttempts = Number.parseInt(process.env.MAX_REPAIR_ATTEMPTS ?? "2", 10);
await verifyLmStudioConnection(process.env.LLM_BASE_URL ?? "http://localhost:1234/v1");

const episodes: Array<{ scenario: string; outcome: "reused" | "evolved" | "repaired" | "rejected" | "error"; capability?: string; fitness?: number; error?: string }> = [];
for (const file of files) {
  const { metadata, scenario } = await loadScenario(`${scenarioDirectory}/${file}`);
  const environment = new TurnBasedEnvironment(scenario);
  const reusable = await library.bestFor(metadata.description, environment.observation());
  if (reusable) {
    const validation = reusable.representation === "plan"
      ? validateCapability(environment, reusable.capability)
      : validateCodeCapability(environment, reusable.capability).validation;
    if (validation.accepted) {
      await library.recordUse(reusable.id);
      episodes.push({ scenario: metadata.name, outcome: "reused", capability: reusable.capability.name, fitness: validation.fitness });
      continue;
    }
  }

  try {
    let candidate = await proposer.propose(metadata.description, environment.observation());
    let validation = validateCapability(environment, candidate);
    if (validation.accepted) {
      await library.add({ representation: "plan", capability: candidate }, validation);
      episodes.push({ scenario: metadata.name, outcome: "evolved", capability: candidate.name, fitness: validation.fitness });
    } else {
      let repaired = false;
      for (let attempt = 0; attempt < maxRepairAttempts; attempt += 1) {
        candidate = await proposer.repair(metadata.description, environment.observation(), candidate, validation);
        validation = validateCapability(environment, candidate);
        if (validation.accepted) {
          await library.add({ representation: "plan", capability: candidate }, validation);
          episodes.push({ scenario: metadata.name, outcome: "repaired", capability: candidate.name, fitness: validation.fitness });
          repaired = true;
          break;
        }
      }
      if (!repaired) episodes.push({ scenario: metadata.name, outcome: "rejected", capability: candidate.name, fitness: validation.fitness });
    }
  } catch (error) {
    episodes.push({ scenario: metadata.name, outcome: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

const counts = Object.fromEntries(["reused", "evolved", "repaired", "rejected", "error"].map((outcome) => [outcome, episodes.filter((episode) => episode.outcome === outcome).length]));
console.log(JSON.stringify({ episodes, summary: { total: episodes.length, ...counts, librarySize: (await library.list()).length } }, null, 2));
