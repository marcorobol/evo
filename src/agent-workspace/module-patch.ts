import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { fitness, improves, type Fitness } from "./fitness.js";
import { runNamedScenario, type NamedScenario } from "./candidate-evaluator.js";
import type { BenchmarkEpisode } from "./contracts.js";
import type { PolicyExtension } from "./contracts.js";

const targetFiles = ["src/agent-workspace/navigation.ts", "src/agent-workspace/task-selection.ts", "src/agent-workspace/memory.ts", "src/agent-workspace/coordination.ts", "src/agent-workspace/exploration.ts", "src/agent-workspace/evolving-agent.ts"] as const;

export const modulePatchProposalSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,80}$/),
  /** A capability name invented by the proposing agent, retained for legacy JSON compatibility. */
  module: z.string().min(3).max(120),
  bottleneck: z.string().min(1).max(1_500),
  rationale: z.string().min(1).max(2_000),
  expectedMetric: z.string().min(1).max(1_000),
  files: z.array(z.object({ path: z.string(), content: z.string().min(20).max(40_000) })).min(1).max(2),
});
export type ModulePatchProposal = z.infer<typeof modulePatchProposalSchema>;

export interface ModulePatchEvaluation {
  proposal: ModulePatchProposal;
  baseline: BenchmarkEpisode[];
  training: BenchmarkEpisode[];
  holdout: BenchmarkEpisode[];
  objectives: { baseline: { training: Fitness; holdout: Fitness }; candidate: { training: Fitness; holdout: Fitness } };
  accepted: boolean;
  reason: string;
}
export interface ModulePatchEvaluationOptions {
  baseExtensions?: ReadonlyArray<PolicyExtension>;
  baseModules?: ReadonlyArray<string>;
}

/** Returns the explicit, small surface an evolving model is permitted to edit. */
export function modulePatchManifest() { return { editableFiles: targetFiles, contract: "Invent a capability name; edit only files needed to connect that capability to the neutral substrate." }; }

/**
 * Execute a full TypeScript module revision only in a disposable clone of src.
 * The real workspace and promoted artifacts are never written by this function.
 */
export async function evaluateModulePatch(proposal: ModulePatchProposal, training: NamedScenario[], holdout: NamedScenario[], options: ModulePatchEvaluationOptions = {}): Promise<ModulePatchEvaluation> {
  validatePatch(proposal);
  await mkdir(".module-sandbox", { recursive: true });
  const sandbox = await mkdtemp(".module-sandbox/revision-");
  try {
    const baselineRoot = join(sandbox, "baseline");
    const candidateRoot = join(sandbox, "candidate");
    await cp("src", baselineRoot, { recursive: true });
    await cp("src", candidateRoot, { recursive: true });
    for (const file of proposal.files) await writeFile(join(candidateRoot, relative("src", file.path)), file.content);

    const baselineAgent = await import(pathToFileURL(join(resolve(baselineRoot), "agent-workspace/evolving-agent.ts")).href);
    const candidateAgent = await import(pathToFileURL(join(resolve(candidateRoot), "agent-workspace/evolving-agent.ts")).href);
    const agentOptions = { extensions: options.baseExtensions, extensionModules: options.baseModules };
    const baseline = [...training, ...holdout].map((item) => runNamedScenario(item, baselineAgent.createEvolvingAgent(agentOptions)));
    const trainingResult = training.map((item) => runNamedScenario(item, candidateAgent.createEvolvingAgent(agentOptions)));
    const holdoutResult = holdout.map((item) => runNamedScenario(item, candidateAgent.createEvolvingAgent(agentOptions)));
    const baseTraining = baseline.slice(0, training.length);
    const baseHoldout = baseline.slice(training.length);
    const objectives = { baseline: { training: fitness(baseTraining), holdout: fitness(baseHoldout) }, candidate: { training: fitness(trainingResult), holdout: fitness(holdoutResult) } };
    const trainingRegression = trainingResult.some((episode, index) => episode.score < (baseTraining[index]?.score ?? 0) || ((baseTraining[index]?.achieved ?? false) && !episode.achieved));
    const holdoutRegression = holdoutResult.some((episode, index) => (baseHoldout[index]?.achieved ?? false) && !episode.achieved);
    const accepted = improves(objectives.candidate.training, objectives.baseline.training) && !trainingRegression && !holdoutRegression;
    const reason = accepted ? "Module revision improved population training fitness without a regression." : trainingRegression ? "Module revision regressed training." : holdoutRegression ? "Module revision lost a holdout success." : "Module revision did not improve population training fitness.";
    return { proposal, baseline, training: trainingResult, holdout: holdoutResult, objectives, accepted, reason };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

function validatePatch(proposal: ModulePatchProposal): void {
  const allowed = new Set<string>(targetFiles);
  const paths = new Set<string>();
  for (const file of proposal.files) {
    if (!allowed.has(file.path)) throw new Error(`'${file.path}' is outside the declared evolvable workspace surface.`);
    if (paths.has(file.path)) throw new Error(`Module patch contains '${file.path}' more than once.`);
    paths.add(file.path);
    if (/\b(?:node:|child_process|worker_threads|process\.|fetch\(|XMLHttpRequest|WebSocket|Deno\.|Bun\.|import\s*\()/.test(file.content)) throw new Error(`Module patch '${file.path}' uses a forbidden runtime capability.`);
    for (const match of file.content.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      if (!specifier.startsWith(".") || specifier.startsWith("../..")) throw new Error(`Module patch '${file.path}' imports outside its sandbox.`);
    }
  }
}
