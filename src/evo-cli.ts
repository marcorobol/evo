import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { capabilityArtifactSchema, compileCapabilityArtifact } from "./agent-workspace/capability-artifact.js";
import { promoteCapability } from "./agent-workspace/capability-store.js";
import { main as runWorkspaceBenchmarks } from "./run-workspace-benchmarks.js";
import { main as runScenarioFamilies } from "./run-scenario-families.js";
import { main as generateArtifact } from "./generate-capability-artifact.js";
import { main as evolveModule } from "./evolve-module-workspace.js";
import { main as discoverChallenge } from "./discover-challenge-opencode.js";
import { main as evaluateModulePatchMain } from "./evaluate-module-patch.js";

if (existsSync(".env")) process.loadEnvFile(".env");

interface Episode {
  scenario?: string;
  name?: string;
  achieved: boolean;
  steps: number;
  score: number;
  learnedCapability?: string;
  capabilityError?: string;
  explorationError?: string;
  code?: { attempts: number; path?: string; reference?: { accepted: boolean }; mirror?: { accepted: boolean }; error?: string };
}
interface Usage { requests?: number; input: number; output: number; reasoning: number; cacheRead?: number; cacheWrite?: number; cost?: number; }
interface Report {
  runID: string;
  artifact?: unknown;
  evaluation?: { accepted?: boolean; reason?: string };
  reason?: string;
  status?: string;
  proposals?: Array<{ accepted?: boolean; reason?: string }>;
  outcomes?: Array<{ accepted?: boolean; reason?: string }>;
  families?: unknown[];
  episodes?: Episode[];
  usage?: Usage;
  usageScope?: string;
}

const [command = "help", runID, ...options] = process.argv.slice(2);
const commandOptions = runID?.startsWith("--") ? [runID, ...options] : options;
const benchmarkTarget = runID && !runID.startsWith("--") ? runID : commandOptions.find((argument) => !argument.startsWith("--")) ?? "all";

try {
  switch (command) {
    case "list": await list(); break;
    case "show": if (!runID || runID.startsWith("--")) usage(1); else show(await load(runID)); break;
    case "benchmark": await benchmark(benchmarkTarget, commandOptions); break;
    case "artifact": await artifact(commandOptions); break;
    case "promote": if (!runID || runID.startsWith("--")) usage(1); else await promote(runID); break;
    case "evolve": await evolve(commandOptions); break;
    case "module": await modulePatch(commandOptions); break;
    case "evaluate": if (!runID || runID.startsWith("--")) usage(1); else await evaluate(runID); break;
    case "challenge": await challenge(commandOptions); break;
    default: usage(command === "help" ? 0 : 1);
  }
} catch (error) {
  console.error(`[evo] command failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function enableBlankSlate(options: string[]): void {
  if (options.includes("--blank-slate")) process.env.EVOLUTION_BLANK_SLATE = "1";
}

async function list(): Promise<void> {
  let entries: string[] = [];
  try { entries = (await readdir("reports", { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name.slice(0, -5)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const reports = await Promise.all(entries.map((id) => load(id).catch(() => undefined)));
  const sessions = reports.filter((report): report is Report => report !== undefined).sort((a, b) => b.runID.localeCompare(a.runID));
  if (!sessions.length) return console.log("No experiment reports found.");
  console.log("RUN                              TYPE        STATUS                 IN      OUT   REASON");
  for (const report of sessions) {
    console.log(`${report.runID.padEnd(32)} ${reportKind(report).padEnd(11)} ${reportStatus(report).padEnd(21)} ${formatUsage(report.usage)}`);
  }
}

function show(report: Report): void {
  if (!report.episodes) {
    console.log(`${report.runID}: ${reportKind(report)}; ${reportStatus(report)}.`);
    console.log(report.usage
      ? `Tokens (${report.usageScope ?? "chat-completions"}): input ${report.usage.input}, output ${report.usage.output}, reasoning ${report.usage.reasoning}; requests ${report.usage.requests ?? "n/a"}.`
      : "Token usage: not reported.");
    return;
  }
  const stats = summarize(report);
  console.log(`${report.runID}: ${stats.successes}/${stats.episodes} successful, score ${stats.score}.`);
  console.log("SCENARIO                    OK  STEPS  SCORE");
  for (const episode of report.episodes) {
    console.log(`${(episode.scenario ?? episode.name ?? "unnamed").padEnd(27)} ${String(episode.achieved).padEnd(3)} ${String(episode.steps).padStart(6)} ${String(episode.score).padStart(6)}`);
  }
  if (report.usage) console.log(`Tokens (${report.usageScope ?? "chat-completions"}): input ${report.usage.input}, output ${report.usage.output}, reasoning ${report.usage.reasoning}, cache read ${report.usage.cacheRead ?? "n/a"}; requests ${report.usage.requests ?? "n/a"}; cost ${report.usage.cost ?? "n/a"}.`);
}

async function benchmark(target: string, options: string[]): Promise<void> {
  enableBlankSlate(options);
  if (target === "workspace") return setExitCode(await runWorkspaceBenchmarks());
  if (target === "families") return setExitCode(await runScenarioFamilies());
  if (target === "all") {
    const workspace = await runWorkspaceBenchmarks();
    if (workspace !== 0) return setExitCode(workspace);
    return setExitCode(await runScenarioFamilies());
  }
  throw new Error("evo benchmark accepts 'workspace', 'families', or 'all'.");
}

async function artifact(options: string[]): Promise<void> {
  enableBlankSlate(options);
  const model = option(options, "--model");
  setExitCode(await generateArtifact({ ...(model ? { model } : {}) }));
}

async function promote(runID: string): Promise<void> {
  const report = await load(runID);
  if (!report.artifact) throw new Error(`Report '${runID}' contains no capability artifact.`);
  if (report.evaluation?.accepted !== true) throw new Error(`Report '${runID}' is not promotable: ${report.evaluation?.reason ?? report.reason ?? "evaluation did not accept it"}`);
  const artifact = capabilityArtifactSchema.parse(report.artifact);
  try { compileCapabilityArtifact(artifact); }
  catch (error) { throw new Error(`Report '${runID}' holds an artifact that does not compile: ${error instanceof Error ? error.message : String(error)}`); }
  await promoteCapability(artifact);
  console.log(`[evo] promoted '${artifact.id}' from ${runID}. It is now loaded by benchmarks and subsequent artifact evaluations.`);
}

async function evolve(options: string[]): Promise<void> {
  enableBlankSlate(options);
  const iterations = positiveInteger(option(options, "--iterations") ?? "1", "--iterations");
  const model = option(options, "--model");
  const evolutionID = `artifact-evolution-${Date.now()}`;
  const results: Array<{ iteration: number; artifactRunID: string; promoted: boolean; reason?: string; exitCode: number }> = [];
  let aborted = false;
  await mkdir("reports", { recursive: true });
  console.log(`[evo] starting ${iterations} artifact evolution iteration${iterations === 1 ? "" : "s"}; every candidate is evaluated before promotion.`);
  try {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const artifactRunID = `${evolutionID}-artifact-${iteration}`;
      console.log(`\n[evo] iteration ${iteration}/${iterations}: generating ${artifactRunID}`);
      const exitCode = await generateArtifact({ runID: artifactRunID, cycleID: evolutionID, ...(model ? { model } : {}) });
      let promoted = false;
      let reason: string | undefined;
      if (exitCode === 0) {
        try {
          const report = await load(artifactRunID);
          reason = report.evaluation?.reason ?? report.reason;
          if (report.evaluation?.accepted) {
            await promote(artifactRunID);
            promoted = true;
            console.log("[evo] running regression benchmarks after promotion.");
            const workspaceExit = await runWorkspaceBenchmarks();
            const benchmarkExit = workspaceExit === 0 ? await runScenarioFamilies() : workspaceExit;
            if (benchmarkExit !== 0) throw new Error(`Post-promotion benchmark failed with exit code ${benchmarkExit}.`);
          } else console.log(`[evo] candidate retained as evidence, not promoted: ${reason ?? "not accepted"}`);
        } catch (error) { reason = error instanceof Error ? error.message : String(error); console.error(`[evo] iteration ${iteration} could not be promoted: ${reason}`); }
      } else reason = `artifact generation failed (exit ${exitCode})`;
      results.push({ iteration, artifactRunID, promoted, ...(reason ? { reason } : {}), exitCode });
    }
  } catch (error) {
    aborted = true;
    const reason = error instanceof Error ? error.message : String(error);
    results.push({ iteration: results.length + 1, artifactRunID: `${evolutionID}-artifact-${results.length + 1}`, promoted: false, reason, exitCode: 1 });
    console.error(`[evo] cycle aborted: ${reason}`);
  } finally {
    await writeFile(`reports/${evolutionID}.json`, `${JSON.stringify({ runID: evolutionID, iterations: results, model: model ?? "default", status: aborted ? "aborted" : "complete" }, null, 2)}\n`);
  }
  const promoted = results.filter((result) => result.promoted).length;
  console.log(`\n[evo] ${aborted ? "aborted" : "complete"}: ${promoted}/${iterations} capabilities promoted. Summary: reports/${evolutionID}.json`);
}

async function modulePatch(options: string[]): Promise<void> {
  enableBlankSlate(options);
  const attemptsRaw = option(options, "--attempts");
  const modelsRaw = option(options, "--models");
  const fromScratch = options.includes("--from-scratch");
  setExitCode(await evolveModule({
    ...(attemptsRaw ? { attempts: positiveInteger(attemptsRaw, "--attempts") } : {}),
    ...(modelsRaw ? { models: modelsRaw.split(",").map((m) => m.trim()).filter(Boolean) } : {}),
    ...(fromScratch ? { fromScratch: true } : {}),
  }));
}

async function evaluate(proposalPath: string): Promise<void> {
  setExitCode(await evaluateModulePatchMain({ proposalPath }));
}

async function challenge(options: string[]): Promise<void> {
  enableBlankSlate(options);
  const attemptsRaw = option(options, "--attempts");
  const modelsRaw = option(options, "--models");
  setExitCode(await discoverChallenge({
    ...(attemptsRaw ? { attempts: positiveInteger(attemptsRaw, "--attempts") } : {}),
    ...(modelsRaw ? { models: modelsRaw.split(",").map((m) => m.trim()).filter(Boolean) } : {}),
  }));
}

function setExitCode(code: number): void { if (code !== 0) process.exitCode = code; }

async function load(id: string): Promise<Report> {
  const report = JSON.parse(await readFile(`reports/${id}.json`, "utf8")) as Report;
  if (report.runID !== id) throw new Error(`Report '${id}' has an inconsistent run ID.`);
  return report;
}

function summarize(report: Report) {
  const episodes = report.episodes ?? [];
  return {
    episodes: episodes.length,
    successes: episodes.filter((episode) => episode.achieved).length,
    score: episodes.reduce((total, episode) => total + episode.score, 0),
  };
}

function formatUsage(usage: Usage | undefined): string {
  if (!usage) return `${"n/a".padStart(8)} ${"n/a".padStart(8)} ${"n/a".padStart(8)}`;
  return `${String(usage.input).padStart(8)} ${String(usage.output).padStart(8)} ${String(usage.reasoning).padStart(8)}`;
}

function reportKind(report: Report): string {
  if (report.runID.startsWith("artifact-evolution-")) return "evolution";
  if (report.artifact) return "artifact";
  if (report.outcomes) return "challenge";
  if (report.proposals && report.runID.startsWith("module-")) return "module";
  if (report.runID.startsWith("module-patch-")) return "evaluate";
  if (report.families) return "families";
  if (report.runID.startsWith("workspace-benchmark-")) return "benchmark";
  if (report.episodes) return "benchmark";
  return "report";
}

function reportStatus(report: Report): string {
  if (report.runID.startsWith("artifact-evolution-")) {
    const iterations = (report as Report & { iterations?: Array<{ promoted?: boolean }> }).iterations ?? [];
    return `${iterations.filter((item) => item.promoted).length}/${iterations.length} promoted`;
  }
  if (report.status === "generation-failed") return "generation failed";
  if (report.artifact) return report.evaluation?.accepted ? "promotable" : "rejected";
  if (report.outcomes) return `${report.outcomes.filter((item) => item.accepted).length}/${report.outcomes.length} accepted`;
  if (report.proposals) return `${report.proposals.filter((item) => item.accepted).length}/${report.proposals.length} promotable`;
  if (report.episodes) {
    const stats = summarize(report);
    return `${stats.successes}/${stats.episodes} success; ${stats.score} score`;
  }
  if (report.families) return `${(report.families as unknown[]).length} family report`;
  // module-patch evaluate reports use top-level accepted
  if ("accepted" in report) return (report as { accepted?: boolean }).accepted ? "promotable" : "rejected";
  return "completed";
}

function option(options: string[], name: string): string | undefined {
  const index = options.indexOf(name);
  if (index < 0) return undefined;
  const value = options[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function usage(exitCode: number): never {
  console.log(`Evo — controlled capability-evolution experiments
Run from the repository root.

Usage:
  evo benchmark [workspace|families|all]       Run current deterministic benchmarks.
  evo artifact [--model ID]                    Generate and evaluate a decision capability artifact.
  evo promote <artifact-run-id>                Activate an already-promotable capability artifact.
  evo evolve [--iterations N] [--model ID]     Generate, evaluate, promote, and regress-test N artifacts.
  evo module [--attempts N] [--models IDs] [--from-scratch]
                                               Propose and evaluate a full TypeScript module patch.
  evo evaluate <proposal.json>                 Evaluate an existing module-patch proposal file.
  evo challenge [--attempts N] [--models IDs]  Discover measurable unsolved scenarios.
  evo status                                   Show promoted state, archive, benchmarks, lock.
  evo list                                     List experiment reports.
  evo show <run-id>                            Show report summary and token usage.

Options:
  artifact --model ID        Override CAPABILITY_ARTIFACT_MODEL.
  evolve --iterations N      Number of independent artifact proposals (default: 1).
  evolve --model ID          Use this model for every proposal in the cycle.
  module --attempts N        Override MODULE_PATCH_ATTEMPTS.
  module --models ID,ID      Override MODULE_PATCH_MODELS.
  module --from-scratch      Ignore currently promoted capability artifacts.
  challenge --attempts N     Override CHALLENGE_ATTEMPTS.
  challenge --models ID,ID   Override CHALLENGE_MODELS.

Regime:
  --blank-slate              Accepted by benchmark/artifact/evolve/module/challenge.
                             The substrate defers every decision; the model prompt
                             carries no game hints. All score comes from evolved
                             capabilities. Do not mix regimes on one promoted store.

Concurrency:
  artifact, evolve, module, challenge, promote, and evaluate hold .evo/lock;
  a second one fails immediately and names the holder.
  benchmark, list, show, and status never lock.

Reports:
  artifact-evolve-*      direct capability proposals.
  artifact-evolution-*   multi-iteration artifact cycles.
  module-evolve-*        TypeScript module patch proposals.
  module-patch-*         manual module-patch evaluations.
  challenge-discovery-*  generated measurable scenarios.
  IN, OUT, REASON in 'evo list' are input, output, and reasoning tokens.

Precedence: command-line flags > environment variables > .env > built-in defaults.
`);
  process.exit(exitCode);
}
