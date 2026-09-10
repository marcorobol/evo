import { readdir, readFile } from "node:fs/promises";
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
interface Report { runID: string; maximumSteps: number; episodes: Episode[]; usage?: unknown; }

const [command = "help", runID] = process.argv.slice(2);
switch (command) {
  case "list": await list(); break;
  case "show": if (!runID) usage(1); else show(await load(runID)); break;
  case "resume": if (!runID) usage(1); else await resume(runID); break;
  default: usage(command === "help" ? 0 : 1);
}

async function list(): Promise<void> {
  const reports = await Promise.all((await readdir("reports", { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^discovery-.+\.json$/.test(entry.name))
    .map((entry) => load(entry.name.slice(0, -5)).catch(() => undefined)));
  const sessions = reports.filter((report): report is Report => report !== undefined).sort((a, b) => b.runID.localeCompare(a.runID));
  if (!sessions.length) return console.log("No discovery sessions found.");
  console.log("RUN                              EPISODES  SUCCESS  SCORE  CODE  TOKENS");
  for (const report of sessions) {
    const stats = summarize(report);
    console.log(`${report.runID.padEnd(32)} ${String(stats.episodes).padStart(8)}  ${String(stats.successes).padStart(7)}  ${String(stats.score).padStart(5)}  ${String(stats.code).padStart(4)}  n/a`);
  }
}

function show(report: Report): void {
  const stats = summarize(report);
  console.log(`${report.runID}: ${stats.successes}/${stats.episodes} successful, score ${stats.score}, validated code ${stats.code}.`);
  console.log("SCENARIO                    OK  STEPS  SCORE  JSON  CODE");
  for (const episode of report.episodes) {
    const json = episode.learnedCapability ? "ok" : episode.capabilityError ? "rejected" : "-";
    const code = episode.code?.path ? "validated" : episode.code?.error ? "rejected" : "-";
    console.log(`${episode.scenario.padEnd(27)} ${String(episode.achieved).padEnd(3)} ${String(episode.steps).padStart(6)} ${String(episode.score).padStart(6)}  ${json.padEnd(8)} ${code}`);
  }
  console.log("Token usage: n/a for legacy reports (enable telemetry in subsequent runs).");
}

async function resume(id: string): Promise<void> {
  await load(id);
  const child = spawn("npm", ["run", "discover:game:opencode"], {
    cwd: process.cwd(), stdio: "inherit",
    env: { ...process.env, DISCOVERY_RUN_ID: id, DISCOVERY_RESUME: "1" },
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
    episodes: report.episodes.length,
    successes: report.episodes.filter((episode) => episode.achieved).length,
    score: report.episodes.reduce((total, episode) => total + episode.score, 0),
    code: report.episodes.filter((episode) => episode.code?.path).length,
  };
}

function usage(exitCode: number): never {
  console.log("Usage: evo list | evo show <run-id> | evo resume <run-id>");
  process.exit(exitCode);
}
