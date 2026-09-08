import type { CapabilityModel } from "./capability-proposer.js";

export interface OpenCodeCapabilityRunner {
  readonly model: CapabilityModel;
  close(): void;
}

/**
 * Adapter from the stable OpenCode SDK to the planner contract used by the
 * controlled experiment loop. The environment is still executed only by the
 * deterministic validator; OpenCode receives a textual, read-only context.
 */
export async function createOpenCodeCapabilityRunner(): Promise<OpenCodeCapabilityRunner> {
  const providerID = process.env.OPENCODE_PROVIDER ?? "lmstudio";
  const configured = process.env.LLM_MODEL ?? "qwen/qwen3.8-27b";
  const modelID = configured.startsWith(`${providerID}/`) ? configured.slice(providerID.length + 1) : configured;
  if (!modelID) throw new Error("LLM_MODEL must name an LM Studio model.");

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
  let sessionID: string | undefined;
  return {
    model: {
      async generate(system, prompt): Promise<unknown> {
        if (!sessionID) {
          const session = await opencode.client.session.create({ body: { title: "Controlled capability experiment" } });
          if (!session.data) throw new Error("OpenCode did not create an experiment session.");
          sessionID = session.data.id;
        }

        console.log(`[opencode-experiment] requesting plan from ${providerID}/${modelID}`);
        const response = await opencode.client.session.prompt({
          path: { id: sessionID },
          body: {
            model: { providerID, modelID },
            tools: {},
            system: `${system}\nReturn JSON only. This is a read-only planning task: do not call tools.`,
            parts: [{ type: "text", text: prompt }],
          },
        });
        console.log("[opencode-experiment] received planner response");
        const text = response.data?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (!text) {
          const parts = response.data?.parts.map((part) => part.type) ?? [];
          const error = response.error ? JSON.stringify(response.error) : "no request error";
          throw new Error(`OpenCode returned no text for the capability proposal (parts: ${parts.join(", ")}; ${error}).`);
        }
        return parseJsonObject(text);
      },
    },
    close() {
      opencode.server.close();
    },
  };
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
