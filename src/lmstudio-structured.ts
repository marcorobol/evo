export interface StructuredUsage {
  input: number;
  output: number;
  reasoning: number;
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

/** OpenAI-compatible LM Studio call with native structured-output first. */
export async function generateStructuredJson(input: { model: string; system: string; prompt: string; schemaName: string; schema: object }): Promise<StructuredResponse> {
  const endpoint = `${baseUrl()}/chat/completions`;
  const common = {
    model: input.model,
    messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }],
    temperature: 0.2,
  };
  const schema = { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.schema } };
  let response = await request(endpoint, { ...common, response_format: schema });
  let mode: StructuredResponse["mode"] = "json_schema";
  if (!response.ok) {
    response = await request(endpoint, { ...common, response_format: { type: "json_object" } });
    mode = "json_object";
  }
  const raw = await response.json() as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } };
  };
  if (!response.ok) throw new Error(`LM Studio structured request failed (${response.status}): ${JSON.stringify(raw)}`);
  const message = raw.choices?.[0]?.message;
  const rawText = typeof message?.content === "string" && message.content.trim()
    ? message.content
    : typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  if (!rawText) throw new StructuredJsonError(`LM Studio returned no JSON content: ${JSON.stringify(raw)}`, rawText, raw, mode);
  let value: unknown;
  try { value = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, "").trim()); }
  catch (error) { throw new StructuredJsonError(`LM Studio returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`, rawText, raw, mode); }
  return {
    value, rawText, raw, mode,
    usage: {
      input: number(raw.usage?.prompt_tokens), output: number(raw.usage?.completion_tokens), reasoning: number(raw.usage?.completion_tokens_details?.reasoning_tokens),
    },
  };
}

async function request(url: string, body: object): Promise<Response> {
  const token = process.env.LMSTUDIO_API_KEY;
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}
function baseUrl(): string {
  const configured = process.env.LLM_BASE_URL ?? "http://127.0.0.1:1234/v1";
  return configured.replace(/\/$/, "");
}
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
