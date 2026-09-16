import type { CapabilityModel } from "./capability-proposer.js";
import { z } from "zod";
import { capabilityProposalSchema } from "./capability-contract.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env before running the capability generator.`);
  return value;
}

export function configuredModel(): CapabilityModel {
  return openAICompatibleModel(configuredBaseURL(), required("OPENAI_MODEL"), process.env.OPENAI_API_KEY);
}

export async function verifyModelConnection(baseURL = configuredBaseURL(), apiKey = process.env.OPENAI_API_KEY): Promise<void> {
  const endpoint = `${baseURL.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(endpoint, {
      headers: authorizationHeaders(apiKey),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach the configured OpenAI-compatible endpoint at ${endpoint}. Check OPENAI_BASE_URL and OPENAI_API_KEY. (${detail})`);
  }
}

function openAICompatibleModel(baseURL: string, model: string, apiKey?: string): CapabilityModel {
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
        throw new Error(`OpenAI-compatible capability request failed for '${model}': ${detail}`);
      }
      if (!response.ok) throw new Error(`OpenAI-compatible endpoint returned HTTP ${response.status}: ${await response.text()}`);
        const body = await response.json() as {
          choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
        };
        return parseOpenAICompatibleResponse(body);
    },
  };
}

function authorizationHeaders(apiKey?: string): HeadersInit {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

export function parseOpenAICompatibleResponse(body: {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
}): unknown {
  const message = body.choices?.[0]?.message;
  // Some reasoning models, including local Qwen variants, place their final
  // structured answer in reasoning_content and leave content empty.
  const content = message?.content?.trim() || message?.reasoning_content?.trim();
  if (!content) throw new Error(`OpenAI-compatible endpoint returned no usable text: ${JSON.stringify(body)}`);
  return JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
}

function configuredBaseURL(): string {
  const configured = required("OPENAI_BASE_URL").replace(/\/$/, "");
  return configured.endsWith("/v1") ? configured : `${configured}/v1`;
}
