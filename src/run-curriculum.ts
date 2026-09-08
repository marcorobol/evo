import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CapabilityLibrary } from "./capability-library.js";
import { validateCapability } from "./capability-validator.js";
import { validateCodeCapability } from "./code-capability-validator.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

const scenarioDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));
const library = new CapabilityLibrary();
const files = (await readdir(scenarioDirectory)).filter((file) => file.endsWith(".v1.json")).sort();
const episodes: Array<{ scenario: string; selected?: string; representation?: string; accepted: boolean; fitness?: number; rewardDelta?: number }> = [];

for (const file of files) {
  const { metadata, scenario } = await loadScenario(`${scenarioDirectory}/${file}`);
  const environment = new TurnBasedEnvironment(scenario);
  const selected = await library.bestFor(metadata.description, environment.observation());
  if (!selected) {
    episodes.push({ scenario: metadata.name, accepted: false });
    continue;
  }
  const validation = selected.representation === "plan"
    ? validateCapability(environment, selected.capability)
    : validateCodeCapability(environment, selected.capability).validation;
  if (validation.accepted) await library.recordUse(selected.id);
  episodes.push({
    scenario: metadata.name,
    selected: selected.capability.name,
    representation: selected.representation,
    accepted: validation.accepted,
    fitness: validation.fitness,
    rewardDelta: validation.rewardDelta,
  });
}

const accepted = episodes.filter((episode) => episode.accepted);
console.log(JSON.stringify({
  episodes,
  summary: {
    total: episodes.length,
    accepted: accepted.length,
    reuseRate: episodes.length === 0 ? 0 : accepted.length / episodes.length,
    meanFitness: accepted.length === 0 ? 0 : accepted.reduce((sum, episode) => sum + (episode.fitness ?? 0), 0) / accepted.length,
  },
}, null, 2));
