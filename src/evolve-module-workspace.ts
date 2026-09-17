import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEvolvingAgent } from "./agent-workspace/evolving-agent.js";
import { archiveCapability, findSimilarCapability, loadCapabilityArchive, type ArchivedCapability } from "./agent-workspace/capability-archive.js";
import { evaluateModulePatch, modulePatchManifest, modulePatchProposalSchema } from "./agent-workspace/module-patch.js";
import { runNamedScenario, type NamedScenario } from "./agent-workspace/candidate-evaluator.js";
import { loadDiscoveredCapabilities } from "./agent-workspace/capability-store.js";
import { builtInScenarioFamilies } from "./agent-workspace/scenario-families.js";
import { generateStructuredJson, StructuredJsonError, type StructuredUsage } from "./openai-compatible-structured.js";
import { loadScenario } from "./scenario-loader.js";

export async function main(options: { runID?: string; attempts?: number; models?: string[]; fromScratch?: boolean } = {}): Promise<number> {
  try { process.loadEnvFile(".env"); } catch { /* optional */ }
  const attempts = options.attempts ?? positive("MODULE_PATCH_ATTEMPTS", 2);
  const models = options.models ?? (process.env.MODULE_PATCH_MODELS ?? "llama-3.3-70b,qwen3.8-27b").split(",").map((value) => value.trim()).filter(Boolean);
  const runID = options.runID ?? process.env.MODULE_PATCH_RUN_ID ?? `module-evolve-${Date.now()}`;
  const fromScratch = options.fromScratch ?? process.env.EVOLUTION_FROM_SCRATCH === "1";
  const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
  const families = builtInScenarioFamilies();
  const training = [...await Promise.all([scenario("key-door-delivery"), scenario("battery-return"), scenario("partial-observation-frontier", 1), scenario("partial-observation-backtrack", 1)]), ...families.flatMap((family) => family.training)];
  const holdout = [...await Promise.all([scenario("simple-delivery"), scenario("two-parcels"), scenario("detour-delivery"), scenario("partial-observation-frontier-mirror", 1), scenario("partial-observation-backtrack-mirror", 1)]), ...families.flatMap((family) => family.holdout)];
  const active = fromScratch ? [] : await loadDiscoveredCapabilities();
  const priorCapabilities = await loadCapabilityArchive();
  const knownCapabilities: ArchivedCapability[] = [...priorCapabilities];
  const agentOptions = { capabilities: active };
  const baseline = [...training, ...holdout].map((item) => runNamedScenario(item, createEvolvingAgent(agentOptions)));
  const failures = baseline.filter((episode) => !episode.achieved);
  const usage: StructuredUsage = { input: 0, output: 0, reasoning: 0, requests: 0 };
  const proposals: Array<{ attempt: number; model: string; accepted: boolean; reason: string; proposal?: unknown; raw?: string }> = [];
  const archivePaths: string[] = [];
  let feedback: string | undefined;

  console.log(`[module-evolve] ${fromScratch ? "fresh substrate (no promoted capabilities)" : `${active.length} promoted capability layer(s)`}; ${failures.length}/${baseline.length} episodes currently fail`);
  if (!failures.length) console.log("[module-evolve] no change: all benchmark episodes already succeed.");
  for (let attempt = 1; failures.length && attempt <= attempts; attempt += 1) {
    const model = models[(attempt - 1) % models.length]!;
    let raw: string | undefined;
    let parsedProposal: ReturnType<typeof modulePatchProposalSchema.parse> | undefined;
    try {
      console.log(`[module-evolve] requesting revision ${attempt}/${attempts} from ${model}`);
      const response = await generateStructuredJson({ model, system: systemPrompt(), prompt: JSON.stringify({ manifest: modulePatchManifest(), failures, sources: await sources(root), priorCapabilities: knownCapabilities, previousFeedback: feedback }), schemaName: "module_patch", schema: schema() });
      usage.input += response.usage.input; usage.output += response.usage.output; usage.reasoning += response.usage.reasoning; usage.requests += response.usage.requests;
      raw = response.rawText;
      const proposal = parsedProposal = modulePatchProposalSchema.parse(response.value);
      const duplicate = findSimilarCapability(proposal, knownCapabilities);
      if (duplicate) {
        const reason = `Rejected before evaluation: ${duplicate.reason} of archived capability '${duplicate.id}' (similarity ${(duplicate.score * 100).toFixed(1)}%). Propose a materially different capability.`;
        proposals.push({ attempt, model, accepted: false, reason, proposal, raw });
        const archived = { runID, attempt, model, createdAt: new Date().toISOString(), accepted: false, reason, proposal, raw };
        archivePaths.push(await archiveCapability(archived));
        knownCapabilities.push(archived);
        feedback = reason;
        console.log(`[module-evolve] ${proposal.id}: duplicate rejected before evaluation`);
        continue;
      }
      const evaluation = await evaluateModulePatch(proposal, training, holdout, { baseCapabilities: active });
      proposals.push({ attempt, model, accepted: evaluation.accepted, reason: evaluation.reason, proposal, raw });
      const archived = { runID, attempt, model, createdAt: new Date().toISOString(), accepted: evaluation.accepted, reason: evaluation.reason, proposal, ...(raw ? { raw } : {}) };
      archivePaths.push(await archiveCapability(archived));
      knownCapabilities.push(archived);
      feedback = evaluation.reason;
      console.log(`[module-evolve] ${proposal.id}: ${evaluation.accepted ? "PROMOTABLE" : "rejected"}; ${evaluation.reason}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const storedRaw = raw ?? (error instanceof StructuredJsonError ? error.rawText : undefined);
      proposals.push({ attempt, model, accepted: false, reason, ...(parsedProposal ? { proposal: parsedProposal } : {}), ...(storedRaw ? { raw: storedRaw } : {}) });
      const archived = { runID, attempt, model, createdAt: new Date().toISOString(), accepted: false, reason, ...(parsedProposal ? { proposal: parsedProposal } : {}), ...(storedRaw ? { raw: storedRaw } : {}) };
      archivePaths.push(await archiveCapability(archived));
      knownCapabilities.push(archived);
      feedback = reason;
    }
  }
  await mkdir("reports", { recursive: true });
  await writeFile(`reports/${runID}.json`, `${JSON.stringify({ runID, fromScratch, models, activeCapabilities: active.map((capability) => capability.descriptor.id), priorCapabilityCount: priorCapabilities.length, archivePaths, families: families.map(({ id }) => id), baseline, proposals, usage, usageScope: "chat-completions" }, null, 2)}\n`);
  console.log(`[module-evolve] report: reports/${runID}.json`);
  return 0;
}

async function scenario(file: string, observationRadius?: number): Promise<NamedScenario> {
  const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
  const loaded = await loadScenario(`${root}/${file}.v1.json`);
  return { name: loaded.metadata.name, scenario: loaded.scenario, ...(observationRadius === undefined ? {} : { observationRadius }) };
}
async function sources(root: string) {
  const files = modulePatchManifest().editableFiles;
  const entries = await Promise.all(files.map(async (file): Promise<readonly [string, string] | undefined> => {
    try { return [file, await readFile(file, "utf8")] as const; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== undefined));
}
function systemPrompt() { return "You evolve a modular turn-based agent. Return one JSON module revision only. Invent a capability identity yourself based solely on traces and source. Do not repeat or lightly reword an archived rejected proposal: take a materially different hypothesis, mechanism or integration point. Replace complete allowed TypeScript files, preserve public contracts, use no node APIs, network, subprocesses, or unrelated files. Seek a general improvement across a family, never coordinates or a single seed. Do not call tools or use Markdown."; }
function schema(): object { return { type: "object", additionalProperties: false, required: ["id", "module", "bottleneck", "rationale", "expectedMetric", "files"], properties: { id: { type: "string" }, module: { type: "string" }, bottleneck: { type: "string" }, rationale: { type: "string" }, expectedMetric: { type: "string" }, files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } } } }; }
function positive(name: string, fallback: number): number { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`); return value; }

const invokedAsScript = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (invokedAsScript) process.exitCode = await main();
