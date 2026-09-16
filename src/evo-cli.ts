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
interface Usage { requests: number; input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; cost: number; }
interface EvolutionResult { generation: number; achieved: boolean; steps: number; score: number; code?: string; reused?: string; error?: string; }
interface Report { runID: string; maximumSteps: number; maximumCodeAttempts?: number; episodes?: Episode[]; results?: EvolutionResult[]; usage?: Usage; usageScope?: string; }

const [command = "help", runID, ...options] = process.argv.slice(2);
switch (command) {
  case "list": await list(); break;
  case "new": await startNew(runID); break;
  case "show": if (!runID) usage(1); else show(await load(runID)); break;
  case "resume": if (!runID) usage(1); else await resume(runID); break;
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
    .filter((entry) => entry.isFile() && /^(?:discovery|evolve)-.+\.json$/.test(entry.name))
    .map((entry) => load(entry.name.slice(0, -5)).catch(() => undefined)));
  const sessions = reports.filter((report): report is Report => report !== undefined).sort((a, b) => b.runID.localeCompare(a.runID));
  if (!sessions.length) return console.log("No discovery sessions found.");
  console.log("RUN                              EPISODES  SUCCESS  SCORE  CODE       IN      OUT   REASON");
  for (const report of sessions) {
    const stats = summarize(report);
    console.log(`${report.runID.padEnd(32)} ${String(stats.episodes).padStart(8)}  ${String(stats.successes).padStart(7)}  ${String(stats.score).padStart(5)}  ${String(stats.code).padStart(4)}  ${formatUsage(report.usage)}`);
  }
}

function show(report: Report): void {
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
    ? `Tokens (${report.usageScope ?? "scope unknown"}): input ${report.usage.input}, output ${report.usage.output}, reasoning ${report.usage.reasoning}, cache read ${report.usage.cacheRead}; requests ${report.usage.requests}; cost ${report.usage.cost}.`
    : "Token usage: n/a for legacy reports.");
}

async function resume(id: string): Promise<void> {
  const report = await load(id);
  if (!report.episodes) throw new Error("Evolution runs are immutable in this first version; start a new generation with 'evo evolve battery-return'.");
  await launch({
    DISCOVERY_RUN_ID: id,
    DISCOVERY_RESUME: "1",
    DISCOVERY_MAX_STEPS: String(report.maximumSteps),
    ...(report.maximumCodeAttempts === undefined ? {} : { DISCOVERY_CODE_ATTEMPTS: String(report.maximumCodeAttempts) }),
  });
}

async function startNew(id: string | undefined): Promise<void> {
  await launch({ ...(id ? { DISCOVERY_RUN_ID: id } : {}) });
}

async function evolve(options: string[]): Promise<void> {
  const generations = option(options, "--generations");
  const seed = option(options, "--seed");
  await launch({
    ...(generations ? { EVOLVE_GENERATIONS: generations } : {}),
    ...(seed ? { EVOLVE_SEED: seed } : {}),
  }, "evolve:variants:opencode");
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
  evo new [run-id]                         Run the fixed seven-scenario benchmark.
  evo evolve [battery-return] [options]    Train on procedurally varied battery-return tasks.
  evo list                                 List discovery and evolution sessions.
  evo show <run-id>                        Show per-episode or per-generation outcomes.
  evo resume <discovery-run-id>            Continue an interrupted discovery session.
  evo delete <run-id> [--yes]              Preview or remove a session's artifacts.

Evolve options:
  --generations N    Number of training variants (default: 10).
  --seed N           Deterministic initial seed (default: 1).

Environment parameters:
  DISCOVERY_MAX_STEPS          Actions per benchmark scenario (default: 20).
  DISCOVERY_CODE_ATTEMPTS      Code synthesis/repair attempts (default: 3).
  EVOLVE_MAX_STEPS             Actions per evolutionary training variant (default: 20).
  EVOLVE_CODE_ATTEMPTS         Code synthesis/repair attempts per generation (default: 3).
  OPENCODE_PLANNER_TIMEOUT_MS  Per-model-request timeout (default: 180000).
  OPENCODE_DEBUG_PROMPTS=1     Print complete model prompts and responses for debugging.

Reports:
  discovery-* sessions benchmark the seven fixed scenarios.
  evolve-battery-return-* sessions train/test procedural variants.
  IN, OUT, and REASON in 'evo list' are input, output, and reasoning tokens.
`);
  process.exit(exitCode);
}
