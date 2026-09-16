export interface StructuredUsage {
  input: number;
  output: number;
  reasoning: number;
  requests: number;
}

export interface StructuredResponse {
  value: unknown;
  rawText: string;
  raw: unknown;
  mode: "json_schema" | "json_object";
  usage: StructuredUsage;
}

/** Preserves a model's raw response when structured decoding fails. */
export class StructuredJsonError extends Error {
  constructor(message: string, readonly rawText?: string, readonly raw?: unknown, readonly mode?: StructuredResponse["mode"]) {
    super(message);
    this.name = "StructuredJsonError";
  }
}

/** OpenAI-compatible chat-completions call with native structured-output first. */
export async function generateStructuredJson(input: { model: string; system: string; prompt: string; schemaName: string; schema: object }): Promise<StructuredResponse> {
  const endpoint = `${baseUrl()}/chat/completions`;
  const common = {
    model: input.model,
    messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }],
    temperature: 0.2,
  };
  const schema = { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.schema } };
  let requests = 1;
  let response = await request(endpoint, { ...common, response_format: schema });
  let mode: StructuredResponse["mode"] = "json_schema";
  if (!response.ok) {
    response = await request(endpoint, { ...common, response_format: { type: "json_object" } });
    requests += 1;
    mode = "json_object";
  }
  const raw = await response.json() as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } };
  };
  if (!response.ok) throw new Error(`OpenAI-compatible structured request failed (${response.status}): ${JSON.stringify(raw)}`);
  const message = raw.choices?.[0]?.message;
  const rawText = typeof message?.content === "string" && message.content.trim()
    ? message.content
    : typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  if (!rawText) throw new StructuredJsonError(`OpenAI-compatible endpoint returned no JSON content: ${JSON.stringify(raw)}`, rawText, raw, mode);
  let value: unknown;
  try { value = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, "").trim()); }
  catch (error) { throw new StructuredJsonError(`OpenAI-compatible endpoint returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`, rawText, raw, mode); }
  return {
    value, rawText, raw, mode,
    usage: {
      input: number(raw.usage?.prompt_tokens), output: number(raw.usage?.completion_tokens), reasoning: number(raw.usage?.completion_tokens_details?.reasoning_tokens), requests,
    },
  };
}

async function request(url: string, body: object): Promise<Response> {
  const token = process.env.OPENAI_API_KEY;
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

function baseUrl(): string {
  const configured = process.env.OPENAI_BASE_URL;
  if (!configured) throw new Error("Missing OPENAI_BASE_URL. Add it to .env before running structured generation.");
  const withoutTrailingSlash = configured.replace(/\/$/, "");
  return withoutTrailingSlash.endsWith("/v1") ? withoutTrailingSlash : `${withoutTrailingSlash}/v1`;
}

function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
