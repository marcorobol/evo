const model = { providerID: process.env.OPENCODE_PROVIDER ?? "unitn-litellm", modelID: process.env.OPENAI_MODEL ?? "qwen3.8-27b" };

console.log("[opencode-sdk-probe] loading stable SDK package");
const { createOpencode } = await import("@opencode-ai/sdk");
console.log("[opencode-sdk-probe] starting local OpenCode server");
const opencode = await createOpencode({ timeout: 30_000 });

try {
  console.log("[opencode-sdk-probe] creating isolated session");
  const session = await opencode.client.session.create({
    body: { title: "OpenAI-compatible connectivity probe" },
  });

  if (!session.data) throw new Error("OpenCode did not create a session");

  console.log(`[opencode-sdk-probe] prompting ${model.providerID}/${model.modelID}`);
  const response = await opencode.client.session.prompt({
    path: { id: session.data.id },
    body: {
      model,
      tools: {},
      system: "Reply with exactly OPENCODE_PROVIDER_OK. Do not call tools.",
      parts: [{ type: "text", text: "Connectivity check." }],
    },
  });

  const text = response.data?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  console.log(JSON.stringify({ model, response: text }, null, 2));
} finally {
  console.log("[opencode-sdk-probe] closing local OpenCode server");
  opencode.server.close();
}
