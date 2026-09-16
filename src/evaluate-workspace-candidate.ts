import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { candidateProposalSchema } from "./agent-workspace/candidate-policy.js";
import { evaluateCandidate, type NamedScenario } from "./agent-workspace/candidate-evaluator.js";
import { loadScenario } from "./scenario-loader.js";
import { builtInScenarioFamilies } from "./agent-workspace/scenario-families.js";

const input = process.argv[2];
if (!input) throw new Error("Usage: bun run src/evaluate-workspace-candidate.ts <proposal.json>");
const proposal = candidateProposalSchema.parse(JSON.parse(await readFile(input, "utf8")));
const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
async function scenario(file: string): Promise<NamedScenario> {
  const loaded = await loadScenario(`${root}/${file}.v1.json`);
  return { name: loaded.metadata.name, scenario: loaded.scenario };
}
const families = builtInScenarioFamilies();
const training = [...await Promise.all([scenario("key-door-delivery"), scenario("battery-return")]), ...families.flatMap((family) => family.training)];
const holdout = [...await Promise.all([scenario("simple-delivery"), scenario("two-parcels"), scenario("detour-delivery")]), ...families.flatMap((family) => family.holdout)];
const evaluation = evaluateCandidate(proposal, training, holdout);
await mkdir("reports", { recursive: true });
const report = `reports/workspace-candidate-${proposal.id}-${Date.now()}.json`;
await writeFile(report, `${JSON.stringify({ ...evaluation, families: families.map(({ id, description }) => ({ id, description })) }, null, 2)}\n`);
console.log(`[candidate] ${proposal.id}: ${evaluation.accepted ? "PROMOTABLE" : "rejected"}; ${evaluation.reason}`);
console.log(`[candidate] report: ${report}`);
