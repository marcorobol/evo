import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateModulePatch, modulePatchProposalSchema } from "./agent-workspace/module-patch.js";
import type { NamedScenario } from "./agent-workspace/candidate-evaluator.js";
import { loadDiscoveredCapabilities } from "./agent-workspace/capability-store.js";
import { builtInScenarioFamilies } from "./agent-workspace/scenario-families.js";
import { loadScenario } from "./scenario-loader.js";

export async function main(options: { proposalPath: string }): Promise<number> {
  try { process.loadEnvFile(".env"); } catch { /* optional */ }
  const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
  async function scenario(file: string, observationRadius?: number): Promise<NamedScenario> {
    const loaded = await loadScenario(`${root}/${file}.v1.json`);
    return { name: loaded.metadata.name, scenario: loaded.scenario, ...(observationRadius === undefined ? {} : { observationRadius }) };
  }
  const rawProposal = JSON.parse(await readFile(options.proposalPath, "utf8")) as unknown;
  // Accept both raw proposal and archive entries (which wrap proposal under a 'proposal' key).
  let parsed: ReturnType<typeof modulePatchProposalSchema.parse>;
  const directResult = modulePatchProposalSchema.safeParse(rawProposal);
  if (directResult.success) {
    parsed = directResult.data;
  } else if (typeof rawProposal === "object" && rawProposal !== null && "proposal" in rawProposal) {
    parsed = modulePatchProposalSchema.parse((rawProposal as { proposal: unknown }).proposal);
  } else {
    throw directResult.error;
  }
  const families = builtInScenarioFamilies();
  const training = [...await Promise.all([scenario("key-door-delivery"), scenario("battery-return"), scenario("partial-observation-frontier", 1), scenario("partial-observation-backtrack", 1)]), ...families.flatMap((family) => family.training)];
  const holdout = [...await Promise.all([scenario("simple-delivery"), scenario("two-parcels"), scenario("detour-delivery"), scenario("partial-observation-frontier-mirror", 1), scenario("partial-observation-backtrack-mirror", 1)]), ...families.flatMap((family) => family.holdout)];
  const active = await loadDiscoveredCapabilities();
  const evaluation = await evaluateModulePatch(parsed, training, holdout, { baseCapabilities: active });
  await mkdir("reports", { recursive: true });
  const runID = `module-patch-${parsed.id}-${Date.now()}`;
  await writeFile(`reports/${runID}.json`, `${JSON.stringify({ runID, ...evaluation, activeCapabilities: active.map((capability) => capability.descriptor.id) }, null, 2)}\n`);
  console.log(`[module-patch] ${parsed.id}: ${evaluation.accepted ? "PROMOTABLE" : "rejected"}; ${evaluation.reason}`);
  console.log(`[module-patch] report: reports/${runID}.json`);
  return 0;
}

const invokedAsScript = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (invokedAsScript) {
  const input = process.argv[2];
  if (!input) { console.error("Usage: bun run src/evaluate-module-patch.ts <proposal.json>"); process.exitCode = 1; }
  else process.exitCode = await main({ proposalPath: input });
}
