import { mkdir, writeFile } from "node:fs/promises";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { candidateProposalSchema, type CandidateProposal } from "./agent-workspace/candidate-policy.js";
import { evaluateCandidate, runNamedScenario, type NamedScenario } from "./agent-workspace/candidate-evaluator.js";
import { createEvolvingAgent } from "./agent-workspace/evolving-agent.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";
import { PartialObservationEnvironment } from "./partial-observation-environment.js";
import { loadActivePolicies } from "./agent-workspace/promoted-policy.js";
import { builtInScenarioFamilies } from "./agent-workspace/scenario-families.js";
import { archiveCapability } from "./agent-workspace/capability-archive.js";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV !== "test") {
  try { process.loadEnvFile(".env"); } catch { /* an .env file is optional */ }
}

const attempts = positive("WORKSPACE_CODE_ATTEMPTS", 2);
const runID = process.env.WORKSPACE_EVOLVE_RUN_ID ?? `workspace-evolve-${Date.now()}`;
const root = fileURLToPath(new URL("../scenarios/", import.meta.url));
const families = builtInScenarioFamilies();
const training = [...await Promise.all([scenario("key-door-delivery"), scenario("battery-return"), scenario("partial-observation-frontier", 1), scenario("partial-observation-backtrack", 1)]), ...families.flatMap((family) => family.training)];
const holdout = [...await Promise.all([scenario("simple-delivery"), scenario("two-parcels"), scenario("detour-delivery"), scenario("partial-observation-frontier-mirror", 1), scenario("partial-observation-backtrack-mirror", 1)]), ...families.flatMap((family) => family.holdout)];
const active = await loadActivePolicies();
const activeExtensions = active.map((policy) => policy.extension);
const activeModules = active.map((policy) => `promoted:${policy.proposal.id}`);
if (active.length) console.log(`[workspace-evolve] using ${active.length} promoted policy layer(s) as executable long-term memory: ${active.map((policy) => policy.proposal.id).join(", ")}`);
const baseline = [...training, ...holdout].map((item) => runNamedScenario(item, createEvolvingAgent({ extensions: activeExtensions, extensionModules: activeModules })));
const observations = [...training, ...holdout].map((item) => ({ name: item.name, observation: printableObservation(item.observationRadius === undefined ? new TurnBasedEnvironment(item.scenario).observation() : new PartialObservationEnvironment(item.scenario, item.observationRadius).observation()) }));
const failures = baseline.filter((episode) => !episode.achieved)
  .sort((a, b) => (b.blockedActions + b.waits * 2) - (a.blockedActions + a.waits * 2));
const priority = failures[0];
if (!priority) {
  await mkdir("reports", { recursive: true });
  const report = { runID, families: families.map(({ id, description }) => ({ id, description })), training: training.map(({ name }) => name), holdout: holdout.map(({ name }) => name), activePolicies: active.map((policy) => policy.proposal.id), baseline, status: "no-change", reason: "Every benchmark already succeeded.", usage: { requests: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, usageScope: "complete" };
  await writeFile(`reports/${runID}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[workspace-evolve] no change: every benchmark succeeded. Report: reports/${runID}.json`);
  process.exit(0);
}

console.log(`[workspace-evolve] ${runID}: diagnosing ${baseline.length} benchmark episodes`);
console.log(`[workspace-evolve] selected lowest-performing episode '${priority.name}' (score=${priority.score}; blocked=${priority.blockedActions}; waits=${priority.waits})`);
const runner = await createOpenCodeCapabilityRunner({ sessionMode: "isolated" });
const proposals: Array<{ attempt: number; proposal?: CandidateProposal; evaluation?: unknown; error?: string }> = [];
const archivePaths: string[] = [];
let feedback: string | undefined;
try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[workspace-evolve] requesting candidate ${attempt}/${attempts}`);
    try {
      const raw = await runner.model.generate(systemPrompt(), userPrompt(priority, baseline, observations, feedback));
      const proposal = candidateProposalSchema.parse(raw);
      const evaluation = evaluateCandidate(proposal, training, holdout, { baseExtensions: activeExtensions, baseModules: activeModules });
      proposals.push({ attempt, proposal, evaluation });
      archivePaths.push(await archiveCapability({ runID, attempt, model: "opencode", createdAt: new Date().toISOString(), accepted: evaluation.accepted, reason: evaluation.reason, proposal }));
      console.log(`[workspace-evolve] ${proposal.id}: ${evaluation.accepted ? "PROMOTABLE" : "rejected"}; ${evaluation.reason}`);
      if (evaluation.accepted) break;
      feedback = [
        evaluation.reason,
        "Concrete candidate outcomes:",
        ...evaluation.training.map((episode) => `${episode.name}: score=${episode.score}; blocked=${episode.blockedReasons.join(" | ") || "none"}; actions=${episode.decisions.map((decision) => JSON.stringify(decision.action)).join(" → ")}`),
        "Repair by using only fields present in initialObservations and by returning undefined outside the selected requirement.",
      ].join("\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      proposals.push({ attempt, error: message });
      archivePaths.push(await archiveCapability({ runID, attempt, model: "opencode", createdAt: new Date().toISOString(), accepted: false, reason: message }));
      feedback = `The previous proposal was rejected before evaluation: ${message}. Repair the source exactly to the stated contract.`;
      console.log(`[workspace-evolve] candidate ${attempt} rejected before evaluation: ${message}`);
    }
  }
} finally {
  runner.close();
}
await mkdir("reports", { recursive: true });
const report = { runID, archivePaths, families: families.map(({ id, description }) => ({ id, description })), training: training.map(({ name }) => name), holdout: holdout.map(({ name }) => name), activePolicies: active.map((policy) => policy.proposal.id), baseline, selectedEpisode: priority.name, proposals, usage: runner.usage(), usageScope: "complete" };
await writeFile(`reports/${runID}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[workspace-evolve] report: reports/${runID}.json`);

async function scenario(file: string, observationRadius?: number): Promise<NamedScenario> {
  const loaded = await loadScenario(`${root}/${file}.v1.json`);
  return { name: loaded.metadata.name, scenario: loaded.scenario, ...(observationRadius === undefined ? {} : { observationRadius }) };
}

function systemPrompt(): string {
  return [
    "You are the coding component of a self-evolving agent. Inspect the evidence and choose autonomously whether and how to improve behavior.",
    "Return exactly one JSON object, no Markdown and no explanation outside JSON.",
    "Required fields: id, bottleneck, module, rationale, expectedMetric, source.",
    "module is exactly one of navigation, exploration, task-selection, coordination, memory; choose it yourself from evidence, not from a host recommendation.",
    "source is exactly one JavaScript function expression: (context) => { ... }.",
    "The source must read state through context.observation (for example: const o = context.observation; const me = o.me;). Never read context.me, context.keys, context.doors, or context.parcels.",
    "The function may return undefined to defer to baseline, or {action, confidence, rationale}.",
    "action is exactly {kind:'move', direction:'up'|'right'|'down'|'left'}, {kind:'pickup'}, {kind:'putdown'}, or {kind:'wait', reason:string}.",
    "Exact observation shapes: width?/height? positive map bounds; me={id,x,y,score}; tiles=[{x,y,type}]; parcels=[{id,x,y,reward,carriedBy?}]; keys=[{x,y}]; doors=[{x,y}]; batteries=[{x,y}]; energy is optional number.",
    "context.memory is an array of {x,y,action,module,accepted?}; it is not an object and the agent never exposes an inventory. accepted=false means the action from that exact position was rejected and should not be retried blindly. A collected key is evidenced by its absence plus an earlier accepted pickup in memory.",
    "Environment transition semantics: pickup on a co-located battery removes it and restores energy to initial capacity; pickup on a co-located key unlocks a door; pickup on a co-located parcel carries it. wait never changes energy, inventory, map, or task state. Every accepted move, pickup, and putdown costs energy when energy exists.",
    "For partial-observation benchmarks, tiles and objects accumulate only after becoming locally visible; width and height bound the world. Holdout maps may be mirrored.",
    "Do not use imports, exports, require, process, globalThis, eval, Function, network, filesystem, timers, or code fences.",
    "The host supplies no requirement, diagnosis, or solution. Infer the failure mechanism from observations, actions, and results. Do not assume a fixed map size or coordinates.",
    "A candidate must defer in unrelated situations to protect holdout behavior.",
  ].join(" ");
}

function userPrompt(selected: NonNullable<typeof priority>, episodes: typeof baseline, initialObservations: typeof observations, previousError: string | undefined): string {
  const failedNames = new Set(episodes.filter((episode) => !episode.achieved).map((episode) => episode.name));
  return JSON.stringify({
    selectionPolicy: "Host selected the lowest-performing benchmark only. It did not classify the problem or prescribe a module or solution.",
    selectedEpisode: { name: selected.name, score: selected.score, blockedActions: selected.blockedActions, waits: selected.waits },
    initialObservations: initialObservations.filter((item) => failedNames.has(item.name)),
    benchmark: episodes.map((episode) => ({
      name: episode.name, achieved: episode.achieved, score: episode.score, steps: episode.steps, blockedReasons: episode.blockedReasons,
      ...(episode.achieved ? {} : { decisions: episode.decisions.map((decision) => ({ action: decision.action, module: decision.module, rationale: decision.rationale })) }),
    })),
    ...(previousError ? { previousAttemptFeedback: previousError } : {}),
  });
}

function printableObservation(state: ReturnType<TurnBasedEnvironment["observation"]>): object {
  return {
    me: state.me,
    tiles: [...state.tiles.values()],
    parcels: [...state.parcels.values()],
    keys: state.keys ?? [],
    doors: state.doors ?? [],
    batteries: state.batteries ?? [],
    ...(state.energy === undefined ? {} : { energy: state.energy }),
  };
}

function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
