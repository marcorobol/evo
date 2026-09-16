import { mkdir, writeFile } from "node:fs/promises";
import { runNamedScenario } from "./agent-workspace/candidate-evaluator.js";
import { createEvolvingAgent } from "./agent-workspace/evolving-agent.js";
import { fitness } from "./agent-workspace/fitness.js";
import { loadActivePolicies } from "./agent-workspace/promoted-policy.js";
import { builtInScenarioFamilies } from "./agent-workspace/scenario-families.js";

const runID = `family-benchmark-${Date.now()}`;
const active = await loadActivePolicies();
const families = builtInScenarioFamilies();
const makeAgent = () => createEvolvingAgent({
  extensions: active.map((policy) => policy.extension),
  extensionModules: active.map((policy) => `promoted:${policy.proposal.id}`),
});
const results = families.map((family) => {
  const training = family.training.map((item) => runNamedScenario(item, makeAgent()));
  const holdout = family.holdout.map((item) => runNamedScenario(item, makeAgent()));
  return { id: family.id, description: family.description, training, holdout, objectives: { training: fitness(training), holdout: fitness(holdout) } };
});

for (const family of results) {
  console.log(`[family-benchmark] ${family.id}: training success=${percent(family.objectives.training.successRate)} holdout success=${percent(family.objectives.holdout.successRate)} holdout steps=${display(family.objectives.holdout.meanSuccessfulSteps)} blocked=${family.objectives.holdout.meanBlockedActions.toFixed(2)} waits=${family.objectives.holdout.meanWaits.toFixed(2)}`);
}
await mkdir("reports", { recursive: true });
await writeFile(`reports/${runID}.json`, `${JSON.stringify({ runID, activePolicies: active.map((policy) => policy.proposal.id), families: results }, null, 2)}\n`);
console.log(`[family-benchmark] report: reports/${runID}.json`);

function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function display(value: number | null): string { return value === null ? "n/a" : value.toFixed(2); }
