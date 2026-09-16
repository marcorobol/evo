import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { asCandidateProposal, capabilityArtifactSchema } from "./agent-workspace/capability-artifact.js";
import { archiveCapability, findSimilarCapability, loadCapabilityArchive } from "./agent-workspace/capability-archive.js";
import { evaluateCandidate, type NamedScenario } from "./agent-workspace/candidate-evaluator.js";
import { loadDiscoveredCapabilities } from "./agent-workspace/capability-store.js";
import { builtInScenarioFamilies } from "./agent-workspace/scenario-families.js";
import { generateStructuredJson } from "./openai-compatible-structured.js";
import { loadScenario } from "./scenario-loader.js";

try { process.loadEnvFile(".env"); } catch { /* optional */ }
const runID = process.env.CAPABILITY_ARTIFACT_RUN_ID ?? `artifact-evolve-${Date.now()}`;
const model = process.env.CAPABILITY_ARTIFACT_MODEL ?? process.env.OPENAI_MODEL ?? "qwen3.8-27b";
const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
const load = async (name: string, observationRadius?: number): Promise<NamedScenario> => { const item = await loadScenario(`${root}/${name}.v1.json`); return { name: item.metadata.name, scenario: item.scenario, ...(observationRadius === undefined ? {} : { observationRadius }) }; };
const families = builtInScenarioFamilies();
const training = [...await Promise.all([load("key-door-delivery"), load("battery-return"), load("partial-observation-frontier", 1), load("partial-observation-backtrack", 1)]), ...families.flatMap((family) => family.training)];
const holdout = [...await Promise.all([load("simple-delivery"), load("two-parcels"), load("detour-delivery"), load("partial-observation-frontier-mirror", 1), load("partial-observation-backtrack-mirror", 1)]), ...families.flatMap((family) => family.holdout)];
const active = await loadDiscoveredCapabilities();
const archive = await loadCapabilityArchive();
console.log(`[artifact-evolve] model=${model}; archived=${archive.length}; promoted=${active.length}`);
const response = await generateStructuredJson({ model, schemaName: "capability_artifact", schema: schema(), system: "Generate exactly one reusable domain-neutral decision capability. Do not patch files. Return JSON only. source must be a COMPLETE single JavaScript arrow expression beginning exactly '(context) => {'. It must be self-contained: no helper functions, imports, TypeScript, randomness, async code, placeholders, ellipsis, or code fences. It may read only context.observation and context.memory. Every non-undefined return must exactly look like { action: { kind: 'move', direction: 'up'|'right'|'down'|'left' } | { kind: 'pickup' } | { kind: 'putdown' } | { kind: 'wait', reason: '...' }, confidence: number, rationale: string }. Return undefined when inapplicable. Invent id and purpose from evidence, avoiding archived duplicates.", prompt: JSON.stringify({ archive, failures: ["key required before a locked transition", "finite energy can make a delivery route infeasible", "partial observations may initially reveal no task"], activationContract: { hook: "decision", priority: "number" } }) });
const artifact = capabilityArtifactSchema.parse(response.value);
const duplicate = findSimilarCapability(artifact, archive);
let evaluation: ReturnType<typeof evaluateCandidate> | undefined;
let reason = duplicate ? `Duplicate of ${duplicate.id}.` : "No evaluation.";
if (!duplicate) {
  try { evaluation = evaluateCandidate(asCandidateProposal(artifact), training, holdout, { baseCapabilities: active }); reason = evaluation.reason; }
  catch (error) { reason = `Rejected before evaluation: ${error instanceof Error ? error.message : String(error)}`; }
}
const archivePath = await archiveCapability({ runID, attempt: 1, model, createdAt: new Date().toISOString(), accepted: evaluation?.accepted ?? false, reason, proposal: artifact, raw: response.rawText });
await mkdir("reports", { recursive: true });
await writeFile(`reports/${runID}.json`, `${JSON.stringify({ runID, artifact, evaluation, reason, archivePath, usage: response.usage }, null, 2)}\n`);
console.log(`[artifact-evolve] ${artifact.id}: ${evaluation?.accepted ? "PROMOTABLE" : "rejected"}; ${reason}`);
console.log(`[artifact-evolve] report: reports/${runID}.json`);
function schema(): object { return { type: "object", additionalProperties: false, required: ["id", "purpose", "activation", "source"], properties: { id: { type: "string" }, purpose: { type: "string" }, activation: { type: "object", additionalProperties: false, required: ["hook", "priority"], properties: { hook: { const: "decision" }, priority: { type: "number" } } }, source: { type: "string" } } }; }
