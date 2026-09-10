import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericCapabilityLibrary } from "./generic-capability-library.js";
import { validateGenericCapability, type GenericValidation } from "./generic-capability.js";
import {
  GenericCodeSynthesizer,
  validateGenericCodeCapability,
  writeGenericCodeCapability,
  type GenericCodeCapability,
} from "./generic-code-capability.js";
import { GenericExplorer, type ExplorationResult } from "./generic-explorer.js";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedAdapter, decodeTurnBasedAction, type TurnBasedObservation } from "./turn-based-adapter.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

interface DiscoveryEpisode {
  scenario: string;
  achieved: boolean;
  steps: number;
  score: number;
  explorationError?: string;
  learnedCapability?: string;
  capabilityError?: string;
  code?: {
    name?: string;
    attempts: number;
    reference?: GenericValidation;
    mirror?: GenericValidation;
    path?: string;
    error?: string;
  };
}

if (existsSync(".env")) process.loadEnvFile(".env");
const runID = process.env.DISCOVERY_RUN_ID ?? `discovery-${Date.now()}`;
const maximumSteps = Number.parseInt(process.env.DISCOVERY_MAX_STEPS ?? "20", 10);
const maximumCodeAttempts = Number.parseInt(process.env.DISCOVERY_CODE_ATTEMPTS ?? "3", 10);
const resume = process.env.DISCOVERY_RESUME === "1";
if (!Number.isSafeInteger(maximumSteps) || maximumSteps < 1) throw new Error("DISCOVERY_MAX_STEPS must be a positive integer.");
if (!Number.isSafeInteger(maximumCodeAttempts) || maximumCodeAttempts < 1) throw new Error("DISCOVERY_CODE_ATTEMPTS must be a positive integer.");

const scenariosDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));
// The order deliberately starts with simple feedback, then adds gates, symmetry,
// resource constraints, and multi-object behaviour. The agent sees only each
// environment's manifest and observations, not these hidden labels or rules.
const curriculum = [
  "simple-delivery.v1.json",
  "key-door-delivery.v1.json",
  "key-door-delivery-mirror.v1.json",
  "double-delivery.v1.json",
  "two-parcels.v1.json",
  "battery-return.v1.json",
  "detour-delivery.v1.json",
];
const library = new GenericCapabilityLibrary(`capabilities/${runID}.json`);
const reportPath = `reports/${runID}.json`;
const episodes: DiscoveryEpisode[] = resume ? await loadCheckpoint(reportPath, runID) : [];

async function checkpoint(): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    runID, maximumSteps, maximumCodeAttempts, episodes,
    libraryPath: `capabilities/${runID}.json`, codeDirectory: `capabilities/generated/${runID}`,
  }, null, 2)}\n`);
}

console.log(`[discovery] ${resume ? "resuming" : "starting fresh"} run '${runID}' with ${maximumSteps} actions per environment`);
const runner = await createOpenCodeCapabilityRunner();
try {
  const explorer = new GenericExplorer(runner.model);
  const codeSynthesizer = new GenericCodeSynthesizer(runner.model);
  for (const filename of curriculum) {
    const { metadata, scenario } = await loadScenario(`${scenariosDirectory}/${filename}`);
    if (episodes.some((episode) => episode.scenario === metadata.name)) {
      console.log(`\n[discovery] skipping completed environment '${metadata.name}'`);
      continue;
    }
    console.log(`\n[discovery] entering new environment '${metadata.name}'`);
    const environment = new TurnBasedAdapter(new TurnBasedEnvironment(scenario));
    let trace: ExplorationResult<TurnBasedObservation>;
    try {
      trace = await explorer.explore(environment, decodeTurnBasedAction, maximumSteps);
    } catch (caught) {
      const explorationError = caught instanceof Error ? caught.message : String(caught);
      console.log(`[discovery] exploration failed; continuing curriculum: ${explorationError}`);
      episodes.push({ scenario: metadata.name, achieved: false, steps: 0, score: environment.outcome().score, explorationError });
      await checkpoint();
      continue;
    }
    let learnedCapability: string | undefined;
    let capabilityError: string | undefined;
    let code: DiscoveryEpisode["code"];
    if (trace.outcome.achieved) {
      try {
        const capability = await explorer.generalizeSuccessfulTrace(metadata.description, trace);
        const validation = validateGenericCapability(new TurnBasedAdapter(new TurnBasedEnvironment(scenario)), capability, decodeTurnBasedAction);
        if (validation.accepted) {
          await library.add(capability, validation);
          learnedCapability = capability.name;
        }
      } catch (caught) {
        capabilityError = caught instanceof Error ? caught.message : String(caught);
        console.log(`[discovery] JSON capability rejected: ${capabilityError}`);
      }
      code = await synthesizeValidatedCode({
        filename, scenario, trace, goal: metadata.description, codeSynthesizer, maximumAttempts: maximumCodeAttempts,
      });
    }
    episodes.push({
      scenario: metadata.name, achieved: trace.outcome.achieved, steps: trace.steps.length, score: trace.outcome.score,
      ...(learnedCapability ? { learnedCapability } : {}), ...(capabilityError ? { capabilityError } : {}), ...(code ? { code } : {}),
    });
    await checkpoint();
  }
} finally {
  runner.close();
}

console.log(`\n[discovery] complete. Checkpoint: ${reportPath}`);

async function synthesizeValidatedCode(args: {
  filename: string;
  scenario: Awaited<ReturnType<typeof loadScenario>>["scenario"];
  trace: Parameters<GenericCodeSynthesizer["synthesize"]>[1];
  goal: string;
  codeSynthesizer: GenericCodeSynthesizer;
  maximumAttempts: number;
}): Promise<NonNullable<DiscoveryEpisode["code"]>> {
  const mirror = await loadMirror(args.filename);
  let candidate: GenericCodeCapability | undefined;
  let reference: GenericValidation | undefined;
  let mirrorValidation: GenericValidation | undefined;
  let error: string | undefined;
  let attempts = 0;

  for (; attempts < args.maximumAttempts; attempts += 1) {
    try {
      candidate = !candidate
        ? await args.codeSynthesizer.synthesize(args.goal, args.trace)
        : await args.codeSynthesizer.repair(args.goal, args.trace, candidate!, { reference, mirror: mirrorValidation });
      reference = validateGenericCodeCapability(
        new TurnBasedAdapter(new TurnBasedEnvironment(args.scenario)), candidate, decodeTurnBasedAction,
      );
      mirrorValidation = mirror
        ? validateGenericCodeCapability(new TurnBasedAdapter(new TurnBasedEnvironment(mirror)), candidate, decodeTurnBasedAction)
        : undefined;
      const accepted = reference.accepted && (mirrorValidation?.accepted ?? true);
      console.log(`[discovery] code candidate ${attempts + 1}/${args.maximumAttempts}: reference=${reference.accepted}${mirrorValidation ? `, mirror=${mirrorValidation.accepted}` : ""}`);
      if (accepted) {
        const path = await writeGenericCodeCapability(candidate, `capabilities/generated/${runID}`);
        return { name: candidate.name, attempts: attempts + 1, reference, ...(mirrorValidation ? { mirror: mirrorValidation } : {}), path };
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      console.log(`[discovery] code candidate ${attempts + 1}/${args.maximumAttempts} rejected before validation: ${error}`);
      // A malformed response is evidence too: retry from the successful trace.
      // Do not allow one formatting error to abort the curriculum.
    }
  }
  return {
    ...(candidate ? { name: candidate.name } : {}), attempts,
    ...(reference ? { reference } : {}), ...(mirrorValidation ? { mirror: mirrorValidation } : {}), ...(error ? { error } : {}),
  };
}

async function loadMirror(filename: string) {
  const counterpart = filename.includes("-mirror.")
    ? filename.replace("-mirror.", ".")
    : filename.replace(".v1.json", "-mirror.v1.json");
  const path = `${scenariosDirectory}/${counterpart}`;
  return existsSync(path) ? (await loadScenario(path)).scenario : undefined;
}

async function loadCheckpoint(path: string, expectedRunID: string): Promise<DiscoveryEpisode[]> {
  try {
    const report = JSON.parse(await readFile(path, "utf8")) as { runID?: unknown; episodes?: unknown };
    if (report.runID !== expectedRunID) throw new Error(`Checkpoint runID does not match '${expectedRunID}'.`);
    if (!Array.isArray(report.episodes)) throw new Error("Checkpoint has no episodes array.");
    return report.episodes as DiscoveryEpisode[];
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException;
    if (error.code === "ENOENT") throw new Error(`Cannot resume: checkpoint '${path}' does not exist.`);
    throw caught;
  }
}
