import type { CapabilityModel } from "./capability-proposer.js";
import { z } from "zod";
import { capabilityProposalSchema } from "./capability-contract.js";

type Provider = "lmstudio";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env before running the capability generator.`);
  return value;
}

export function configuredModel(): CapabilityModel {
  const provider = required("LLM_PROVIDER") as Provider;
  const model = required("LLM_MODEL");

  switch (provider) {
    case "lmstudio":
      return lmStudioModel(process.env.LLM_BASE_URL ?? "http://localhost:1234/v1", model, process.env.LMSTUDIO_API_KEY);
    default:
      throw new Error(`Unsupported LLM_PROVIDER '${provider}'. Use 'lmstudio'.`);
  }
}

export async function verifyLmStudioConnection(baseURL: string, apiKey = process.env.LMSTUDIO_API_KEY): Promise<void> {
  const endpoint = `${baseURL.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(endpoint, {
      headers: authorizationHeaders(apiKey),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach LM Studio at ${endpoint}. Start its local server and load the configured model. (${detail})`);
  }
}

function lmStudioModel(baseURL: string, model: string, apiKey?: string): CapabilityModel {
  return {
    async generate(system, prompt, outputSchema = capabilityProposalSchema): Promise<unknown> {
      let response: Response;
      try {
        response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorizationHeaders(apiKey) },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "capability_proposal",
              strict: true,
                schema: z.toJSONSchema(outputSchema),
            },
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`LM Studio capability request failed for '${model}': ${detail}`);
      }
      if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}: ${await response.text()}`);
        const body = await response.json() as {
          choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
        };
        return parseLmStudioResponse(body);
    },
  };
}

function authorizationHeaders(apiKey?: string): HeadersInit {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

export function parseLmStudioResponse(body: {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
}): unknown {
  const message = body.choices?.[0]?.message;
  // Some reasoning models, including local Qwen variants, place their final
  // structured answer in reasoning_content and leave content empty.
  const content = message?.content?.trim() || message?.reasoning_content?.trim();
  if (!content) throw new Error(`LM Studio returned no usable text: ${JSON.stringify(body)}`);
  return JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
}
