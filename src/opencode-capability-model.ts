import type { CapabilityModel } from "./capability-proposer.js";

export interface OpenCodeCapabilityRunner {
  readonly model: CapabilityModel;
  usage(): TokenUsage;
  close(): void;
}

export interface OpenCodeRunnerOptions {
  /**
   * Isolated requests prevent an OpenCode conversation from silently growing
   * into every subsequent action prompt. Persistent sessions remain useful
   * for interactive debugging, but are not the default experiment setting.
   */
  sessionMode?: "isolated" | "persistent";
}

export interface TokenUsage {
  requests: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/**
 * Adapter from the stable OpenCode SDK to the planner contract used by the
 * controlled experiment loop. The environment is still executed only by the
 * deterministic validator; OpenCode receives a textual, read-only context.
 */
export async function createOpenCodeCapabilityRunner(options: OpenCodeRunnerOptions = {}): Promise<OpenCodeCapabilityRunner> {
  const providerID = process.env.OPENCODE_PROVIDER ?? "unitn-litellm";
  const configured = process.env.OPENAI_MODEL ?? "qwen3.8-27b";
  const modelID = configured.startsWith(`${providerID}/`) ? configured.slice(providerID.length + 1) : configured;
  const plannerTimeoutMs = positiveInteger("OPENCODE_PLANNER_TIMEOUT_MS", 180_000);
  const heartbeatMs = positiveInteger("OPENCODE_HEARTBEAT_MS", 5_000);
  const debugPrompts = process.env.OPENCODE_DEBUG_PROMPTS === "1";
  const sessionMode = options.sessionMode ?? "isolated";
  if (!modelID) throw new Error("OPENAI_MODEL must name a model configured by the OpenAI-compatible provider.");

  console.log("[opencode-experiment] loading OpenCode SDK");
  const { createOpencode } = await import("@opencode-ai/sdk");
  console.log("[opencode-experiment] starting local OpenCode server");
  // Let the operating system choose a free loopback port. This makes separate
  // experimental runs independent and avoids collisions on OpenCode's 4096 default.
  const opencode = await createOpencode({ port: 0, timeout: 30_000 });
  // Force workspace services to finish their first initialization before a
  // session prompt is accepted. The server otherwise may report a transient
  // generic error on the first request immediately after startup.
  await opencode.client.project.list();
  console.log("[opencode-experiment] server ready; environment exploration can begin");
  let persistentSessionID: string | undefined;
  const usage: TokenUsage = { requests: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  return {
    model: {
      async generate(system, prompt): Promise<unknown> {
        let sessionID = persistentSessionID;
        if (!sessionID) {
          const session = await opencode.client.session.create({ body: { title: "Controlled capability experiment" } });
          if (!session.data) throw new Error("OpenCode did not create an experiment session.");
          sessionID = session.data.id;
          if (sessionMode === "persistent") persistentSessionID = sessionID;
        }

        const phase = phaseFor(system);
        console.log(`[opencode-experiment] requesting ${phase} from ${providerID}/${modelID} (heartbeat every ${heartbeatMs / 1_000}s; timeout ${plannerTimeoutMs / 1_000}s)`);
        if (debugPrompts) {
          printDebug(phase, "REQUEST", `SYSTEM\n${system}\n\nPAYLOAD\n${prettyJson(prompt)}`);
        }
        const started = Date.now();
        const heartbeat = setInterval(() => {
          console.log(`[opencode-experiment] ${phase} still running (${Math.round((Date.now() - started) / 1_000)}s)`);
        }, heartbeatMs);
        const request = opencode.client.session.prompt({
          path: { id: sessionID },
          body: {
            model: { providerID, modelID },
            tools: {},
            system: `${system}\nReturn JSON only. This is a read-only planning task: do not call tools.`,
            parts: [{ type: "text", text: prompt }],
          },
        });
        let response: Awaited<typeof request>;
        try {
          const outcome = await Promise.race([
            request.then((value) => ({ kind: "response" as const, value })),
            elapsed(plannerTimeoutMs).then(() => ({ kind: "timeout" as const })),
          ]);
          if (outcome.kind === "timeout") {
            console.log(`[opencode-experiment] aborting timed-out ${phase}; creating a fresh session for the next request`);
            await opencode.client.session.abort({ path: { id: sessionID } });
            if (sessionMode === "persistent") persistentSessionID = undefined;
            void request.catch(() => undefined);
            throw new Error(`${phase} exceeded ${plannerTimeoutMs / 1_000}s`);
          }
          response = outcome.value;
        } finally {
          clearInterval(heartbeat);
        }
        console.log(`[opencode-experiment] received ${phase} response after ${Math.round((Date.now() - started) / 1_000)}s (${sessionMode} context)`);
        accumulateUsage(usage, response);
        const text = response.data?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        // Some reasoning models put
        // their structured answer in the reasoning channel and leave text
        // empty. Use it only as a fallback, never merge it with a real answer.
        const reasoning = response.data?.parts
          .filter((part) => part.type === "reasoning")
          .map((part) => part.text)
          .join("\n")
          .trim();
        const output = text || reasoning;
        if (!output) {
          const parts = response.data?.parts.map((part) => part.type) ?? [];
          const error = response.error ? JSON.stringify(response.error) : "no request error";
          throw new Error(`OpenCode returned no text for the capability proposal (parts: ${parts.join(", ")}; ${error}).`);
        }
        if (!text) console.log("[opencode-experiment] using reasoning-channel fallback for structured output");
        if (debugPrompts) printDebug(phase, "RESPONSE", prettyJson(output));
        return parseJsonObject(output);
      },
    },
    usage() { return { ...usage }; },
    close() {
      opencode.server.close();
    },
  };
}

function accumulateUsage(total: TokenUsage, response: unknown): void {
  const parts = (response as { data?: { parts?: unknown[] } }).data?.parts ?? [];
  const finished = parts.find((part) => (part as { type?: unknown }).type === "step-finish") as {
    cost?: unknown;
    tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } };
  } | undefined;
  if (!finished) return;
  total.requests += 1;
  total.input += finite(finished.tokens?.input);
  total.output += finite(finished.tokens?.output);
  total.reasoning += finite(finished.tokens?.reasoning);
  total.cacheRead += finite(finished.tokens?.cache?.read);
  total.cacheWrite += finite(finished.tokens?.cache?.write);
  total.cost += finite(finished.cost);
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function phaseFor(system: string): string {
  if (system.includes("Synthesize")) return "code synthesis";
  if (system.includes("Repair")) return "code repair";
  if (system.includes("Generalize")) return "JSON generalization";
  return "next-action planning";
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function elapsed(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printDebug(phase: string, kind: "REQUEST" | "RESPONSE", content: string): void {
  const title = `[opencode-debug] ${phase.toUpperCase()} ${kind}`;
  const rule = "─".repeat(Math.max(12, title.length));
  console.log(`\n${rule}\n${title}\n${rule}\n${content}\n${rule}`);
}

function prettyJson(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
}

function parseJsonObject(text: string): unknown {
  const unwrapped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(unwrapped);
  } catch {
    const start = unwrapped.indexOf("{");
    const end = unwrapped.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`OpenCode returned invalid JSON: ${text}`);
    return JSON.parse(unwrapped.slice(start, end + 1));
  }
}
