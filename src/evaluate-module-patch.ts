import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { evaluateModulePatch, modulePatchProposalSchema } from "./agent-workspace/module-patch.js";
import type { NamedScenario } from "./agent-workspace/candidate-evaluator.js";
import { loadDiscoveredCapabilities } from "./agent-workspace/capability-store.js";
import { builtInScenarioFamilies } from "./agent-workspace/scenario-families.js";
import { loadScenario } from "./scenario-loader.js";

const input = process.argv[2];
if (!input) throw new Error("Usage: bun run src/evaluate-module-patch.ts <proposal.json>");
const proposal = modulePatchProposalSchema.parse(JSON.parse(await readFile(input, "utf8")));
const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
async function scenario(file: string, observationRadius?: number): Promise<NamedScenario> {
  const loaded = await loadScenario(`${root}/${file}.v1.json`);
  return { name: loaded.metadata.name, scenario: loaded.scenario, ...(observationRadius === undefined ? {} : { observationRadius }) };
}
const families = builtInScenarioFamilies();
const training = [...await Promise.all([scenario("key-door-delivery"), scenario("battery-return"), scenario("partial-observation-frontier", 1), scenario("partial-observation-backtrack", 1)]), ...families.flatMap((family) => family.training)];
const holdout = [...await Promise.all([scenario("simple-delivery"), scenario("two-parcels"), scenario("detour-delivery"), scenario("partial-observation-frontier-mirror", 1), scenario("partial-observation-backtrack-mirror", 1)]), ...families.flatMap((family) => family.holdout)];
const active = await loadDiscoveredCapabilities();
const evaluation = await evaluateModulePatch(proposal, training, holdout, { baseCapabilities: active });
await mkdir("reports", { recursive: true });
const runID = `module-patch-${proposal.id}-${Date.now()}`;
await writeFile(`reports/${runID}.json`, `${JSON.stringify({ runID, ...evaluation, activeCapabilities: active.map((capability) => capability.descriptor.id) }, null, 2)}\n`);
console.log(`[module-patch] ${proposal.id}: ${evaluation.accepted ? "PROMOTABLE" : "rejected"}; ${evaluation.reason}`);
console.log(`[module-patch] report: reports/${runID}.json`);
