import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { capabilityArtifactSchema } from "./agent-workspace/capability-artifact.js";
import { promoteCapability } from "./agent-workspace/capability-store.js";

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
interface EvolutionResult { generation: number; achieved: boolean; steps: number; score: number; code?: string; reused?: string; error?: string; }
interface Report {
  runID: string;
  maximumSteps?: number;
  maximumCodeAttempts?: number;
  episodes?: Episode[];
  results?: EvolutionResult[];
  artifact?: unknown;
  evaluation?: { accepted?: boolean; reason?: string };
  reason?: string;
  status?: string;
  proposals?: Array<{ accepted?: boolean; reason?: string }>;
  outcomes?: Array<{ accepted?: boolean; reason?: string }>;
  families?: unknown[];
  usage?: Usage;
  usageScope?: string;
}

const [command = "help", runID, ...options] = process.argv.slice(2);
const commandOptions = runID?.startsWith("--") ? [runID, ...options] : options;
switch (command) {
  case "list": await list(); break;
  case "show": if (!runID) usage(1); else show(await load(runID)); break;
  case "benchmark": await benchmark(runID ?? "all"); break;
  case "artifact": await artifact(commandOptions); break;
  case "promote": if (!runID) usage(1); else await promote(runID); break;
  case "evolve": await evolve(commandOptions); break;
  case "module": await modulePatch(commandOptions); break;
  case "challenge": await challenge(commandOptions); break;
  default: usage(command === "help" ? 0 : 1);
}

async function list(): Promise<void> {
  const reports = await Promise.all((await readdir("reports", { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => load(entry.name.slice(0, -5)).catch(() => undefined)));
  const sessions = reports.filter((report): report is Report => report !== undefined).sort((a, b) => b.runID.localeCompare(a.runID));
  if (!sessions.length) return console.log("No experiment reports found.");
  console.log("RUN                              TYPE        STATUS                 IN      OUT   REASON");
  for (const report of sessions) {
    console.log(`${report.runID.padEnd(32)} ${reportKind(report).padEnd(11)} ${reportStatus(report).padEnd(21)} ${formatUsage(report.usage)}`);
  }
}

function show(report: Report): void {
  if (!report.episodes && !report.results) {
    console.log(`${report.runID}: ${reportKind(report)}; ${reportStatus(report)}.`);
    console.log(report.usage
      ? `Tokens: input ${report.usage.input}, output ${report.usage.output}, reasoning ${report.usage.reasoning}; requests ${report.usage.requests ?? "n/a"}.`
      : "Token usage: not reported.");
    return;
  }
  const stats = summarize(report);
  console.log(`${report.runID}: ${stats.successes}/${stats.episodes} successful, score ${stats.score}, validated code ${stats.code}.`);
  console.log("SCENARIO                    OK  STEPS  SCORE  JSON  CODE       REUSE");
  for (const episode of rows(report)) {
    const json = episode.learnedCapability ? "ok" : episode.capabilityError ? "rejected" : "-";
    const code = episode.code?.path ? "validated" : episode.code?.error ? "rejected" : "-";
    const reuse = (episode as Episode & { reused?: string }).reused ?? "-";
    console.log(`${(episode.scenario ?? episode.name ?? "unnamed").padEnd(27)} ${String(episode.achieved).padEnd(3)} ${String(episode.steps).padStart(6)} ${String(episode.score).padStart(6)}  ${json.padEnd(8)} ${code.padEnd(10)} ${reuse}`);
  }
  console.log(report.usage
    ? `Tokens (${report.usageScope ?? "scope unknown"}): input ${report.usage.input}, output ${report.usage.output}, reasoning ${report.usage.reasoning}, cache read ${report.usage.cacheRead ?? "n/a"}; requests ${report.usage.requests ?? "n/a"}; cost ${report.usage.cost ?? "n/a"}.`
    : "Token usage: n/a for legacy reports.");
}

async function benchmark(target: string): Promise<void> {
  if (target === "workspace") return setExitCode(await launch({}, "benchmark:workspace"));
  if (target === "families") return setExitCode(await launch({}, "benchmark:families"));
  if (target === "all") {
    const workspace = await launch({}, "benchmark:workspace");
    if (workspace !== 0) return setExitCode(workspace);
    return setExitCode(await launch({}, "benchmark:families"));
  }
  throw new Error("evo benchmark accepts 'workspace', 'families', or 'all'.");
}

async function artifact(options: string[]): Promise<void> {
  const model = option(options, "--model");
  const code = await launch({ ...(model ? { CAPABILITY_ARTIFACT_MODEL: model } : {}) }, "evolve:artifact");
  if (code !== 0) process.exitCode = code;
}

/** Promote only a capability whose immutable report passed evaluation. */
async function promote(runID: string): Promise<void> {
  const report = await load(runID);
  if (!report.artifact) throw new Error(`Report '${runID}' contains no capability artifact.`);
  if (report.evaluation?.accepted !== true) throw new Error(`Report '${runID}' is not promotable: ${report.evaluation?.reason ?? report.reason ?? "evaluation did not accept it"}`);
  const artifact = capabilityArtifactSchema.parse(report.artifact);
  await promoteCapability(artifact);
  console.log(`[evo] promoted '${artifact.id}' from ${runID}. It is now loaded by benchmarks and subsequent artifact evaluations.`);
}

/**
 * Repeated controlled evolution. A generated proposal remains archived even
 * when it fails; only a strict benchmark improvement is activated.
 */
async function evolve(options: string[]): Promise<void> {
  const iterations = positiveInteger(option(options, "--iterations") ?? "1", "--iterations");
  const model = option(options, "--model");
  const evolutionID = `artifact-evolution-${Date.now()}`;
  const results: Array<{ iteration: number; artifactRunID: string; promoted: boolean; reason?: string; exitCode: number }> = [];
  await mkdir("reports", { recursive: true });
  console.log(`[evo] starting ${iterations} artifact evolution iteration${iterations === 1 ? "" : "s"}; every candidate is evaluated before promotion.`);
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const artifactRunID = `${evolutionID}-artifact-${iteration}`;
    console.log(`\n[evo] iteration ${iteration}/${iterations}: generating ${artifactRunID}`);
    const exitCode = await launch({ CAPABILITY_ARTIFACT_RUN_ID: artifactRunID, ...(model ? { CAPABILITY_ARTIFACT_MODEL: model } : {}) }, "evolve:artifact");
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
          const workspaceExit = await launch({}, "benchmark:workspace");
          const benchmarkExit = workspaceExit === 0 ? await launch({}, "benchmark:families") : workspaceExit;
          if (benchmarkExit !== 0) throw new Error(`Post-promotion benchmark failed with exit code ${benchmarkExit}.`);
        } else console.log(`[evo] candidate retained as evidence, not promoted: ${reason ?? "not accepted"}`);
      } catch (error) { reason = error instanceof Error ? error.message : String(error); console.error(`[evo] iteration ${iteration} could not be promoted: ${reason}`); }
    } else reason = `artifact generation exited with code ${exitCode}`;
    results.push({ iteration, artifactRunID, promoted, ...(reason ? { reason } : {}), exitCode });
    await writeFile(`reports/${evolutionID}.json`, `${JSON.stringify({ runID: evolutionID, iterations: results, model: model ?? "default", status: iteration === iterations ? "complete" : "running" }, null, 2)}\n`);
  }
  const promoted = results.filter((result) => result.promoted).length;
  console.log(`\n[evo] complete: ${promoted}/${iterations} capabilities promoted. Summary: reports/${evolutionID}.json`);
}

async function modulePatch(options: string[]): Promise<void> {
  const attempts = option(options, "--attempts");
  const models = option(options, "--models");
  const fromScratch = options.includes("--from-scratch");
  setExitCode(await launch({
    ...(attempts ? { MODULE_PATCH_ATTEMPTS: attempts } : {}),
    ...(models ? { MODULE_PATCH_MODELS: models } : {}),
    ...(fromScratch ? { EVOLUTION_FROM_SCRATCH: "1" } : {}),
  }, "evolve:module-workspace"));
}

async function challenge(options: string[]): Promise<void> {
  const attempts = option(options, "--attempts");
  const models = option(options, "--models");
  setExitCode(await launch({
    ...(attempts ? { CHALLENGE_ATTEMPTS: attempts } : {}),
    ...(models ? { CHALLENGE_MODELS: models } : {}),
  }, "discover:challenge:opencode"));
}

async function launch(environment: Record<string, string>, script: string): Promise<number> {
  const child = spawn("npm", ["run", script], {
    cwd: process.cwd(), stdio: "inherit",
    env: { ...process.env, ...environment },
  });
  return new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

function setExitCode(code: number): void { if (code !== 0) process.exitCode = code; }

async function load(id: string): Promise<Report> {
  const report = JSON.parse(await readFile(`reports/${id}.json`, "utf8")) as Report;
  if (report.runID !== id) throw new Error(`Report '${id}' has an inconsistent run ID.`);
  return report;
}

function summarize(report: Report) {
  return {
    episodes: rows(report).length,
    successes: rows(report).filter((episode) => episode.achieved).length,
    score: rows(report).reduce((total, episode) => total + episode.score, 0),
    code: rows(report).filter((episode) => episode.code?.path).length,
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
  if (report.runID.startsWith("workspace-evolve-")) return "workspace";
  if (report.proposals) return report.runID.startsWith("module-") ? "module" : "workspace";
  if (report.families) return "families";
  if (report.runID.startsWith("workspace-benchmark-")) return "benchmark";
  if (report.episodes) return "discovery";
  if (report.results) return "variants";
  return "report";
}

function reportStatus(report: Report): string {
  if (report.runID.startsWith("artifact-evolution-")) {
    const iterations = (report as Report & { iterations?: Array<{ promoted?: boolean }> }).iterations ?? [];
    return `${iterations.filter((item) => item.promoted).length}/${iterations.length} promoted`;
  }
  if (report.status === "no-change") return "no change";
  if (report.artifact) return report.evaluation?.accepted ? "promotable" : "rejected";
  if (report.evaluation) return report.evaluation.accepted ? "promotable" : "rejected";
  if (report.outcomes) return `${report.outcomes.filter((item) => item.accepted).length}/${report.outcomes.length} accepted`;
  if (report.proposals) return `${report.proposals.filter((item) => item.accepted).length}/${report.proposals.length} promotable`;
  if (report.episodes || report.results) {
    const stats = summarize(report);
    return `${stats.successes}/${stats.episodes} success; ${stats.score} score`;
  }
  if (report.families) return `${report.families.length} family report`;
  return "completed";
}

function rows(report: Report): Episode[] {
  if (report.episodes) return report.episodes;
  return (report.results ?? []).map((result) => ({
    scenario: `generation-${result.generation + 1}`,
    achieved: result.achieved,
    steps: result.steps,
    score: result.score,
    ...(result.code ? { code: { attempts: 0, path: result.code } } : {}),
    ...(result.reused ? { reused: result.reused } : {}),
    ...(result.error ? { explorationError: result.error } : {}),
  }));
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

Usage:
  evo benchmark [workspace|families|all]       Run current deterministic benchmarks.
  evo artifact [--model ID]                    Generate and evaluate a decision capability artifact.
  evo promote <artifact-run-id>                Activate an already-promotable capability artifact.
  evo evolve [--iterations N] [--model ID]     Generate, evaluate, promote, and regress-test N artifacts.
  evo module [--attempts N] [--models IDs] [--from-scratch]
                                               Propose and evaluate a full TypeScript module patch.
  evo challenge [--attempts N] [--models IDs]  Discover measurable unsolved scenarios.
  evo list                                     List current and legacy experiment reports.
  evo show <run-id>                            Show report summary and token usage.

Modern options:
  artifact --model ID        Override CAPABILITY_ARTIFACT_MODEL.
  evolve --iterations N      Number of independent artifact proposals (default: 1).
  evolve --model ID          Use this model for every proposal in the cycle.
  module --attempts N        Override MODULE_PATCH_ATTEMPTS.
  module --models ID,ID      Override MODULE_PATCH_MODELS.
  module --from-scratch      Ignore currently promoted capability artifacts.
  challenge --attempts N     Override CHALLENGE_ATTEMPTS.
  challenge --models ID,ID   Override CHALLENGE_MODELS.

Reports:
  artifact-evolve-* reports direct decision-capability proposals.
  artifact-evolution-* reports controlled multi-iteration artifact cycles.
  module-evolve-* reports complete TypeScript patch proposals.
  challenge-discovery-* reports generated, measurable scenarios.
  Legacy report files remain readable but cannot be resumed by this CLI.
  IN, OUT, and REASON in 'evo list' are input, output, and reasoning tokens.
`);
  process.exit(exitCode);
}
