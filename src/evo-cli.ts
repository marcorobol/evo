import { readdir, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";

interface Episode {
  scenario: string;
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
  artifact?: { id?: string };
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
  case "new": await startNew(runID); break;
  case "show": if (!runID) usage(1); else show(await load(runID)); break;
  case "resume": if (!runID) usage(1); else await resume(runID); break;
  case "benchmark": await benchmark(runID ?? "all"); break;
  case "artifact": await artifact(commandOptions); break;
  case "module": await modulePatch(commandOptions); break;
  case "challenge": await challenge(commandOptions); break;
  case "evolve": {
    const scenario = runID && !runID.startsWith("--") ? runID : "battery-return";
    const evolveOptions = runID?.startsWith("--") ? [runID, ...options] : options;
    if (scenario !== "battery-return") throw new Error("Only 'battery-return' is available for procedural evolution currently.");
    await evolve(evolveOptions);
    break;
  }
  case "delete": if (!runID) usage(1); else await removeSession(runID, options.includes("--yes")); break;
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
    console.log(`${episode.scenario.padEnd(27)} ${String(episode.achieved).padEnd(3)} ${String(episode.steps).padStart(6)} ${String(episode.score).padStart(6)}  ${json.padEnd(8)} ${code.padEnd(10)} ${reuse}`);
  }
  console.log(report.usage
    ? `Tokens (${report.usageScope ?? "scope unknown"}): input ${report.usage.input}, output ${report.usage.output}, reasoning ${report.usage.reasoning}, cache read ${report.usage.cacheRead ?? "n/a"}; requests ${report.usage.requests ?? "n/a"}; cost ${report.usage.cost ?? "n/a"}.`
    : "Token usage: n/a for legacy reports.");
}

async function resume(id: string): Promise<void> {
  const report = await load(id);
  if (!report.episodes) throw new Error("Evolution runs are immutable in this first version; start a new generation with 'evo evolve battery-return'.");
  console.warn("[deprecated] evo resume belongs to the legacy discovery curriculum. Use modern benchmarks and evo artifact/module/challenge for new work.");
  await launch({
    DISCOVERY_RUN_ID: id,
    DISCOVERY_RESUME: "1",
    DISCOVERY_MAX_STEPS: String(report.maximumSteps),
    ...(report.maximumCodeAttempts === undefined ? {} : { DISCOVERY_CODE_ATTEMPTS: String(report.maximumCodeAttempts) }),
  });
}

async function startNew(id: string | undefined): Promise<void> {
  console.warn("[deprecated] evo new runs the legacy seven-scenario discovery curriculum. Use 'evo benchmark all' followed by 'evo artifact' for the current workflow.");
  await launch({ ...(id ? { DISCOVERY_RUN_ID: id } : {}) });
}

async function evolve(options: string[]): Promise<void> {
  console.warn("[deprecated] evo evolve runs the legacy battery-return curriculum. Use 'evo artifact' or 'evo module' for the current workflow.");
  const generations = option(options, "--generations");
  const seed = option(options, "--seed");
  await launch({
    ...(generations ? { EVOLVE_GENERATIONS: generations } : {}),
    ...(seed ? { EVOLVE_SEED: seed } : {}),
  }, "evolve:variants:opencode");
}

async function benchmark(target: string): Promise<void> {
  if (target === "workspace") return launch({}, "benchmark:workspace");
  if (target === "families") return launch({}, "benchmark:families");
  if (target === "all") {
    await launch({}, "benchmark:workspace");
    if (process.exitCode && process.exitCode !== 0) return;
    return launch({}, "benchmark:families");
  }
  throw new Error("evo benchmark accepts 'workspace', 'families', or 'all'.");
}

async function artifact(options: string[]): Promise<void> {
  const model = option(options, "--model");
  await launch({ ...(model ? { CAPABILITY_ARTIFACT_MODEL: model } : {}) }, "evolve:artifact");
}

async function modulePatch(options: string[]): Promise<void> {
  const attempts = option(options, "--attempts");
  const models = option(options, "--models");
  const fromScratch = options.includes("--from-scratch");
  await launch({
    ...(attempts ? { MODULE_PATCH_ATTEMPTS: attempts } : {}),
    ...(models ? { MODULE_PATCH_MODELS: models } : {}),
    ...(fromScratch ? { EVOLUTION_FROM_SCRATCH: "1" } : {}),
  }, "evolve:module-workspace");
}

async function challenge(options: string[]): Promise<void> {
  const attempts = option(options, "--attempts");
  const models = option(options, "--models");
  await launch({
    ...(attempts ? { CHALLENGE_ATTEMPTS: attempts } : {}),
    ...(models ? { CHALLENGE_MODELS: models } : {}),
  }, "discover:challenge:opencode");
}

async function removeSession(id: string, confirmed: boolean): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("A run ID may contain only letters, numbers, and hyphens.");
  const targets = [`reports/${id}.json`, `capabilities/${id}.json`, `capabilities/generated/${id}`];
  const existing: string[] = [];
  for (const target of targets) {
    try { await stat(target); existing.push(target); }
    catch (caught) { if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught; }
  }
  if (!existing.length) return console.log(`No artifacts found for '${id}'.`);
  if (!confirmed) {
    console.log(`Would delete artifacts for '${id}':\n${existing.map((target) => `  ${target}`).join("\n")}\nRun: evo delete ${id} --yes`);
    return;
  }
  for (const target of existing) await rm(target, { recursive: true, force: true });
  console.log(`Deleted ${existing.length} artifact(s) for '${id}'.`);
}

async function launch(environment: Record<string, string>, script = "discover:game:opencode"): Promise<void> {
  const child = spawn("npm", ["run", script], {
    cwd: process.cwd(), stdio: "inherit",
    env: { ...process.env, ...environment },
  });
  process.exitCode = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

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

function usage(exitCode: number): never {
  console.log(`Evo — controlled capability-evolution experiments

Usage:
  evo benchmark [workspace|families|all]       Run current deterministic benchmarks.
  evo artifact [--model ID]                    Generate and evaluate a decision capability artifact.
  evo module [--attempts N] [--models IDs] [--from-scratch]
                                               Propose and evaluate a full TypeScript module patch.
  evo challenge [--attempts N] [--models IDs]  Discover measurable unsolved scenarios.
  evo list                                     List current and legacy experiment reports.
  evo show <run-id>                            Show report summary and token usage.
  evo delete <run-id> [--yes]                  Preview or remove a legacy session's artifacts.

Deprecated commands:
  evo new [run-id]                         Legacy seven-scenario discovery curriculum.
  evo evolve [battery-return] [options]    Legacy battery-return variant curriculum.
  evo resume <discovery-run-id>            Resume legacy discovery only.

Legacy evolve options:
  --generations N    Number of training variants (default: 10).
  --seed N           Deterministic initial seed (default: 1).

Modern options:
  artifact --model ID        Override CAPABILITY_ARTIFACT_MODEL.
  module --attempts N        Override MODULE_PATCH_ATTEMPTS.
  module --models ID,ID      Override MODULE_PATCH_MODELS.
  module --from-scratch      Ignore currently promoted policy layers.
  challenge --attempts N     Override CHALLENGE_ATTEMPTS.
  challenge --models ID,ID   Override CHALLENGE_MODELS.

Environment parameters:
  DISCOVERY_MAX_STEPS          Actions per benchmark scenario (default: 20).
  DISCOVERY_CODE_ATTEMPTS      Code synthesis/repair attempts (default: 3).
  EVOLVE_MAX_STEPS             Actions per evolutionary training variant (default: 20).
  EVOLVE_CODE_ATTEMPTS         Code synthesis/repair attempts per generation (default: 3).
  OPENCODE_PLANNER_TIMEOUT_MS  Per-model-request timeout (default: 180000).
  OPENCODE_DEBUG_PROMPTS=1     Print complete model prompts and responses for debugging.

Reports:
  artifact-evolve-* reports direct decision-capability proposals.
  module-evolve-* reports complete TypeScript patch proposals.
  challenge-discovery-* reports generated, measurable scenarios.
  discovery-* and evolve-battery-return-* are legacy curricula.
  IN, OUT, and REASON in 'evo list' are input, output, and reasoning tokens.
`);
  process.exit(exitCode);
}
