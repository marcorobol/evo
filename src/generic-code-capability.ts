import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createContext, Script } from "node:vm";
import { z } from "zod";
import type { CapabilityModel } from "./capability-proposer.js";
import type { ExperimentEnvironment } from "./environment-contract.js";
import type { ExplorationResult } from "./generic-explorer.js";
import { validateGenericCapability, type GenericValidation } from "./generic-capability.js";

const forbidden = /\b(?:import|require|process|globalThis|Function|eval|constructor|__proto__|while|for|class|async|await|fetch)\b/;
const genericActionsSchema = z.array(z.record(z.string(), z.unknown())).min(1).max(80);

export const genericCodeCapabilitySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  goal: z.string().min(1).max(500),
  applicability: z.string().min(1).max(1_000),
  source: z.string().min(20).max(6_000),
  rationale: z.string().min(1).max(1_000),
});

export type GenericCodeCapability = z.infer<typeof genericCodeCapabilitySchema>;

function parseGenericCodeCapability(value: unknown): GenericCodeCapability {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    // Rationale is diagnostic only; preserve the first bounded portion rather
    // than losing an otherwise valid executable candidate to model verbosity.
    if (typeof candidate.rationale === "string" && candidate.rationale.length > 1_000) {
      return genericCodeCapabilitySchema.parse({ ...candidate, rationale: candidate.rationale.slice(0, 1_000) });
    }
  }
  return genericCodeCapabilitySchema.parse(value);
}

/** The generated function has one generic input: { observation }. */
export function executeGenericCodeCapability<Observation>(capability: GenericCodeCapability, observation: Observation): Record<string, unknown>[] {
  if (forbidden.test(capability.source)) throw new Error("Generated code contains a forbidden construct.");
  const sandbox = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  sandbox.context = deepFreeze({ observation });
  const output = new Script(`"use strict"; (${capability.source})(context)`, { filename: `${capability.name}.capability.js` })
    .runInContext(sandbox, { timeout: 50 });
  return genericActionsSchema.parse(output);
}

export function validateGenericCodeCapability<Action, Observation>(
  environment: ExperimentEnvironment<Action, Observation>,
  capability: GenericCodeCapability,
  decodeAction: (action: Record<string, unknown>) => Action | undefined,
): GenericValidation {
  const actions = executeGenericCodeCapability(capability, environment.observe());
  return validateGenericCapability(environment, { ...capability, actions }, decodeAction);
}

export class GenericCodeSynthesizer {
  constructor(private readonly model: CapabilityModel) {}

  async synthesize<Observation>(goal: string, trace: ExplorationResult<Observation>): Promise<GenericCodeCapability> {
    if (!trace.outcome.achieved) throw new Error("Code can only be synthesized from a successful trace.");
    return parseGenericCodeCapability(await this.model.generate(
      [
        "Synthesize a tiny reusable program from a successful exploration trace in an unknown environment.",
        "Return JSON only with name, goal, applicability, source, and rationale.",
        "name, goal, applicability, source, and rationale must each be plain JSON strings, never objects or arrays. Keep rationale under 300 characters.",
        "source must be one pure JavaScript function expression: (context) => actionArray.",
        "The only input is context.observation. Return only action objects already seen in the successful trace.",
        "Use no imports, require, process, globalThis, eval, Function, loops, async code, fetch, or external state.",
        "Generalize only evidence supported by the trace; do not invent hidden environment semantics.",
      ].join(" "),
      JSON.stringify({ goal, manifest: trace.manifest, successfulTrace: trace }),
      genericCodeCapabilitySchema,
    ));
  }

  async repair<Observation>(
    goal: string,
    trace: ExplorationResult<Observation>,
    rejected: GenericCodeCapability,
    feedback: unknown,
  ): Promise<GenericCodeCapability> {
    return parseGenericCodeCapability(await this.model.generate(
      [
        "Repair a rejected reusable program for an unknown environment.",
        "Return JSON only with name, goal, applicability, source, and rationale.",
        "name, goal, applicability, source, and rationale must each be plain JSON strings, never objects or arrays. Keep rationale under 300 characters.",
        "source must be one pure JavaScript function expression: (context) => actionArray.",
        "The only input is context.observation. Use no imports, require, process, globalThis, eval, Function, loops, async code, fetch, or external state.",
        "Use validation feedback and the successful trace as evidence. Do not add undiscovered semantics.",
      ].join(" "),
      JSON.stringify({ goal, manifest: trace.manifest, successfulTrace: trace, rejected, feedback }),
      genericCodeCapabilitySchema,
    ));
  }
}

/** Persist only source that has already passed the deterministic validator. */
export async function writeGenericCodeCapability(
  capability: GenericCodeCapability,
  directory = "capabilities/generated",
): Promise<string> {
  const path = `${directory}/${capability.name}.capability.js`;
  await mkdir(dirname(path), { recursive: true });
  const comment = capability.rationale.replaceAll("*/", "* /").replaceAll("\n", " ");
  await writeFile(path, `// Generated capability: ${capability.name}\n// ${comment}\nexport default ${capability.source};\n`);
  return path;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
