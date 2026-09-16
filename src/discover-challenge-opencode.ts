import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { generateStructuredJson, StructuredJsonError, type StructuredUsage } from "./openai-compatible-structured.js";
import { loadDiscoveredCapabilities } from "./agent-workspace/capability-store.js";
import { createEvolvingAgent } from "./agent-workspace/evolving-agent.js";
import { runBenchmark } from "./agent-workspace/benchmark-runner.js";
import { parseScenario, scenarioSchema } from "./scenario-loader.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

try { process.loadEnvFile(".env"); } catch { /* optional */ }
const attempts = positive("CHALLENGE_ATTEMPTS", 2);
const models = (process.env.CHALLENGE_MODELS ?? "llama-3.3-70b,qwen3.8-27b")
  .split(",").map((model) => model.trim()).filter(Boolean);
if (!models.length) throw new Error("CHALLENGE_MODELS must contain at least one model ID.");
const runID = process.env.CHALLENGE_RUN_ID ?? `challenge-discovery-${Date.now()}`;
const proposalSchema = z.object({
  scenario: scenarioSchema,
});
const active = await loadDiscoveredCapabilities();
const outcomes: Array<{ attempt: number; model: string; name?: string; accepted: boolean; reason: string; baseline?: { score: number; achieved: boolean }; witness?: { score: number; acceptedActions: number }; raw?: { mode: string; text: string } }> = [];
const usage: StructuredUsage = { input: 0, output: 0, reasoning: 0, requests: 0 };
let feedback: string | undefined;

console.log(`[challenge-discovery] '${runID}': generating up to ${attempts} novel deterministic challenge(s)`);
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const model = models[(attempt - 1) % models.length]!;
    try {
      console.log(`[challenge-discovery] requesting candidate ${attempt}/${attempts} from OpenAI-compatible/${model} with JSON Schema`);
      const response = await generateStructuredJson({ model, system: system(), prompt: prompt(active.map((capability) => ({ id: capability.descriptor.id, purpose: capability.descriptor.purpose })), feedback), schemaName: "challenge_proposal", schema: challengeOutputSchema() });
      usage.input += response.usage.input;
      usage.output += response.usage.output;
      usage.reasoning += response.usage.reasoning;
      usage.requests += response.usage.requests;
      const wrapped = proposalSchema.safeParse(response.value);
      const proposal = wrapped.success ? wrapped.data : { scenario: scenarioSchema.parse(response.value) };
      const { metadata, scenario } = parseScenario(JSON.stringify(proposal.scenario));
      const witness = findWitness(scenario);
      if (witness.score <= 0) {
        const reason = "Witness did not reach a positive terminal score.";
        outcomes.push({ attempt, model, name: metadata.name, accepted: false, reason, witness, raw: { mode: response.mode, text: response.rawText } });
        feedback = reason;
        continue;
      }
      const baseline = runBenchmark(metadata.name, scenario, createEvolvingAgent({ capabilities: active }));
      if (baseline.achieved) {
        const reason = "Current promoted agent already solves this scenario; it is not a novel challenge.";
        outcomes.push({ attempt, model, name: metadata.name, accepted: false, reason, baseline, witness, raw: { mode: response.mode, text: response.rawText } });
        feedback = reason;
        continue;
      }
      const filename = `scenarios/generated/${safeName(metadata.name)}-${runID}.v1.json`;
      await mkdir("scenarios/generated", { recursive: true });
      await writeFile(filename, `${JSON.stringify(proposal.scenario, null, 2)}\n`, { flag: "wx" });
      outcomes.push({ attempt, model, name: metadata.name, accepted: true, reason: `Validated witness and unsolved baseline; scenario saved to ${filename}.`, baseline, witness, raw: { mode: response.mode, text: response.rawText } });
      console.log(`[challenge-discovery] accepted '${metadata.name}': ${filename}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const raw = error instanceof StructuredJsonError && error.rawText
        ? { mode: error.mode ?? "unknown", text: error.rawText }
        : undefined;
      outcomes.push({ attempt, model, accepted: false, reason, ...(raw ? { raw } : {}) });
      feedback = `Previous candidate was rejected: ${reason}. Return only an object conforming to the JSON Schema.`;
    }
  }
await mkdir("reports", { recursive: true });
const report = { runID, models, activeCapabilities: active.map((capability) => capability.descriptor.id), outcomes, usage, usageScope: "chat-completions" };
await writeFile(`reports/${runID}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[challenge-discovery] report: reports/${runID}.json`);

function system(): string {
  return [
    "You are a challenge-discovery component for a self-evolving turn-based agent.",
    "Return exactly one JSON object with a scenario field and no Markdown.",
    "scenario must satisfy the supplied JSON schema.",
    "Generate a compact scenario that exercises behavior not already solved by the supplied policy source. Do not name an algorithm, prescribe a modification, or explain the intended solution.",
    "Only use existing environment semantics: tile '0' is blocked; tiles '2'/'3' accept putdown; key pickup unlocks doors; battery pickup refills energy; move/pickup/putdown consume energy when configured.",
    "The scenario must have at most 16 tiles, two parcels, one key, one door, and one battery. Do not use imports, tools, code, or unsupported fields.",
  ].join(" ");
}

function prompt(capabilities: Array<{ id: string; purpose: string }>, previousFeedback: string | undefined): string {
  return JSON.stringify({
    scenarioSchema: { version: 1, fields: ["version", "name", "description", "agent", "tiles", "parcels", "batteries", "keys", "doors", "initialEnergy?", "energyCost?"] },
    promotedCapabilities: capabilities,
    ...(previousFeedback ? { previousValidationFeedback: previousFeedback } : {}),
  });
}

function challengeOutputSchema(): object {
  return {
  type: "object", additionalProperties: false, required: ["scenario"], properties: {
    scenario: {
      type: "object", additionalProperties: false,
      required: ["version", "name", "description", "agent", "tiles", "parcels", "batteries", "keys", "doors"],
      properties: {
        version: { const: 1 }, name: { type: "string", minLength: 1 }, description: { type: "string", minLength: 1 },
        agent: { type: "object", additionalProperties: false, required: ["id", "name", "x", "y", "score"], properties: { id: { type: "string" }, name: { type: "string" }, x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 }, score: { type: "number" } } },
        tiles: { type: "array", minItems: 1, maxItems: 16, items: { type: "object", additionalProperties: false, required: ["x", "y", "type"], properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 }, type: { enum: ["0", "1", "2", "3", "4", "5"] } } } },
        parcels: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false, required: ["id", "x", "y", "reward"], properties: { id: { type: "string" }, x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 }, reward: { type: "number", exclusiveMinimum: 0 } } } },
        batteries: { type: "array", maxItems: 1, items: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } } } },
        keys: { type: "array", maxItems: 1, items: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } } } },
        doors: { type: "array", maxItems: 1, items: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } } } },
        initialEnergy: { type: "number", exclusiveMinimum: 0 }, energyCost: { type: "number", exclusiveMinimum: 0 },
      },
    },
  },
  };
}

function findWitness(scenario: ReturnType<typeof parseScenario>["scenario"]) {
  const initial = new TurnBasedEnvironment(scenario);
  const queue: Array<{ environment: TurnBasedEnvironment; actions: import("./domain.js").PrimitiveAction[] }> = [{ environment: initial, actions: [] }];
  const seen = new Set([initial.fingerprint()]);
  const actions: import("./domain.js").PrimitiveAction[] = [
    { kind: "move", direction: "up" }, { kind: "move", direction: "right" }, { kind: "move", direction: "down" }, { kind: "move", direction: "left" },
    { kind: "pickup" }, { kind: "putdown" },
  ];
  for (let cursor = 0; cursor < queue.length && queue.length <= 20_000; cursor += 1) {
    const current = queue[cursor]!;
    const score = current.environment.observation().me?.score ?? 0;
    if (score > 0) return { score, acceptedActions: current.actions.length, actions: current.actions };
    if (current.actions.length >= 24) continue;
    for (const action of actions) {
      const next = current.environment.fork();
      if (!next.step(action).accepted) continue;
      const fingerprint = next.fingerprint();
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      queue.push({ environment: next, actions: [...current.actions, action] });
    }
  }
  return { score: 0, acceptedActions: 0, actions: [] };
}
function safeName(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!value) throw new Error("Scenario name cannot be converted to a safe filename.");
  return value;
}
function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
