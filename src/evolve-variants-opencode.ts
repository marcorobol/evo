import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GenericCodeSynthesizer, validateGenericCodeCapability, writeGenericCodeCapability, type GenericCodeCapability } from "./generic-code-capability.js";
import { GenericExplorer, type ExplorationResult } from "./generic-explorer.js";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { batteryReturnVariant } from "./scenario-variants.js";
import { TurnBasedAdapter, decodeTurnBasedAction, type TurnBasedObservation } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

interface Generation { generation: number; trainSeed: number; achieved: boolean; steps: number; score: number; holdoutSeeds: number[]; holdoutPassed: number; code?: string; reused?: string; error?: string; }
interface PromotedCapability { capability: GenericCodeCapability; path: string; }
if (existsSync(".env")) process.loadEnvFile(".env");
const generations = positive("EVOLVE_GENERATIONS", 10);
const seed = positive("EVOLVE_SEED", 1);
const maximumSteps = positive("EVOLVE_MAX_STEPS", 20);
const attempts = positive("EVOLVE_CODE_ATTEMPTS", 3);
const runID = process.env.EVOLVE_RUN_ID ?? `evolve-battery-return-${Date.now()}`;
const reportPath = `reports/${runID}.json`;
const results: Generation[] = [];
const promoted: PromotedCapability[] = [];
let runner: Awaited<ReturnType<typeof createOpenCodeCapabilityRunner>> | undefined;
let explorer: GenericExplorer | undefined;
let synthesizer: GenericCodeSynthesizer | undefined;

async function checkpoint(): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    runID, scenario: "battery-return", generations, seed, maximumSteps, attempts, results,
    promotedCapabilities: promoted.map(({ capability, path }) => ({ name: capability.name, goal: capability.goal, applicability: capability.applicability, path })),
    usage: runner?.usage() ?? { requests: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    usageScope: "complete",
  }, null, 2)}\n`);
}

console.log(`[evolve] '${runID}': ${generations} battery-return generations, seed=${seed}`);
promoted.push(...await loadPriorPromotions());
if (promoted.length) console.log(`[evolve] loaded ${promoted.length} previously validated capability/capabilities for reuse`);
try {
  for (let generation = 0; generation < generations; generation += 1) {
    const trainSeed = seed + generation * 10;
    const scenario = batteryReturnVariant(trainSeed);
    console.log(`\n[evolve] generation ${generation + 1}/${generations}; train seed=${trainSeed}`);
    const reused = reuse(scenario);
    if (reused) {
      console.log(`[evolve] reused validated capability '${reused.capability.name}' without an LLM request`);
      results.push({ generation, trainSeed, achieved: true, steps: reused.successfulActions, score: reused.scoreDelta, holdoutSeeds: [], holdoutPassed: 0, reused: reused.name });
      await checkpoint();
      continue;
    }
    let trace: ExplorationResult<TurnBasedObservation>;
    try {
      const llm = await ensureLLM();
      trace = await llm.explorer.explore(
        new TurnBasedAdapter(new TurnBasedEnvironment(scenario)),
        decodeTurnBasedAction,
        maximumSteps,
        promoted.map(({ capability }) => `${capability.name}: ${compact(capability.applicability)}`),
      );
    }
    catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      results.push({ generation, trainSeed, achieved: false, steps: 0, score: 0, holdoutSeeds: [], holdoutPassed: 0, error });
      await checkpoint();
      continue;
    }
    const holdoutSeeds = [trainSeed + 1, trainSeed + 2, trainSeed + 3];
    const candidate = trace.outcome.achieved ? await synthesizeAndTest((await ensureLLM()).synthesizer, trace, scenario, holdoutSeeds) : undefined;
    if (candidate?.capability && candidate.path) promoted.push({ capability: candidate.capability, path: candidate.path });
    results.push({ generation, trainSeed, achieved: trace.outcome.achieved, steps: trace.steps.length, score: trace.outcome.score, holdoutSeeds, holdoutPassed: candidate?.holdoutPassed ?? 0, ...(candidate?.path ? { code: candidate.path } : {}), ...(candidate?.error ? { error: candidate.error } : {}) });
    await checkpoint();
  }
} finally { runner?.close(); }
console.log(`\n[evolve] complete. Report: ${reportPath}`);

async function synthesizeAndTest(synthesizer: GenericCodeSynthesizer, trace: ExplorationResult<TurnBasedObservation>, train: ReturnType<typeof batteryReturnVariant>, holdoutSeeds: number[]) {
  let candidate: GenericCodeCapability | undefined;
  let error: string | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      candidate = candidate
        ? await synthesizer.repair("Solve a reusable energy-constrained delivery task.", trace, candidate, { train: validate(candidate, train), holdoutSeeds })
        : await synthesizer.synthesize("Solve a reusable energy-constrained delivery task.", trace);
      const trainValidation = validate(candidate, train);
      const holdouts = holdoutSeeds.map((variantSeed) => validate(candidate!, batteryReturnVariant(variantSeed)));
      const holdoutPassed = holdouts.filter((validation) => validation.accepted).length;
      console.log(`[evolve] code ${attempt + 1}/${attempts}: train=${trainValidation.accepted}; hold-out=${holdoutPassed}/${holdouts.length}`);
      if (trainValidation.accepted && holdoutPassed === holdouts.length) {
        const path = await writeGenericCodeCapability(candidate, `capabilities/generated/${runID}`);
        return { path, holdoutPassed, capability: candidate };
      }
      error = `train=${trainValidation.accepted}; hold-out=${holdoutPassed}/${holdouts.length}`;
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  }
  return { holdoutPassed: 0, error };
}

function reuse(scenario: ReturnType<typeof batteryReturnVariant>) {
  for (const { capability } of promoted) {
    const validation = validate(capability, scenario);
    if (validation.accepted) return { ...validation, name: capability.name, capability };
  }
  return undefined;
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

async function ensureLLM(): Promise<{ explorer: GenericExplorer; synthesizer: GenericCodeSynthesizer }> {
  if (!runner) {
    runner = await createOpenCodeCapabilityRunner();
    explorer = new GenericExplorer(runner.model);
    synthesizer = new GenericCodeSynthesizer(runner.model);
  }
  return { explorer: explorer!, synthesizer: synthesizer! };
}

/**
 * A generated file exists only after deterministic validation. Loading the
 * prior code files gives later sessions a real, executable long-term memory;
 * the model itself receives only a bounded applicability summary.
 */
async function loadPriorPromotions(): Promise<PromotedCapability[]> {
  const root = "capabilities/generated";
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { recursive: true });
  const paths = entries
    .filter((entry) => typeof entry === "string" && /^evolve-battery-return-[^/]+\/.+\.capability\.js$/.test(entry))
    .map((entry) => `${root}/${entry}`);
  const loaded: PromotedCapability[] = [];
  for (const path of paths) {
    try {
      const text = await readFile(path, "utf8");
      const name = text.match(/^\/\/ Generated capability: ([a-z][a-z0-9-]{2,63})$/m)?.[1];
      const source = text.match(/export default ([\s\S]*);\s*$/)?.[1];
      if (!name || !source) continue;
      loaded.push({
        path,
        capability: {
          name,
          goal: "Previously validated energy-constrained delivery behavior.",
          applicability: "A one-dimensional delivery task with a recharge item, a parcel, and a delivery tile.",
          source: source.trim(),
          rationale: "Loaded from a prior deterministic validation.",
        },
      });
    } catch {
      // A malformed historical artifact is simply not part of executable memory.
    }
  }
  return loaded;
}

function validate(capability: GenericCodeCapability, scenario: ReturnType<typeof batteryReturnVariant>) {
  return validateGenericCodeCapability(new TurnBasedAdapter(new TurnBasedEnvironment(scenario)), capability, decodeTurnBasedAction);
}
function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
