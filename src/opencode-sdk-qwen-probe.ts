const model = { providerID: "lmstudio", modelID: "qwen/qwen3.8-27b" };

console.log("[opencode-sdk-qwen-probe] loading stable SDK package");
const { createOpencode } = await import("@opencode-ai/sdk");
console.log("[opencode-sdk-qwen-probe] starting local OpenCode server");
const opencode = await createOpencode({ timeout: 30_000 });

try {
  console.log("[opencode-sdk-qwen-probe] creating isolated session");
  const session = await opencode.client.session.create({
    body: { title: "LM Studio connectivity probe" },
  });

  if (!session.data) throw new Error("OpenCode did not create a session");

  console.log(`[opencode-sdk-qwen-probe] prompting ${model.providerID}/${model.modelID}`);
  const response = await opencode.client.session.prompt({
    path: { id: session.data.id },
    body: {
      model,
      tools: {},
      system: "Reply with exactly OPENCODE_LMSTUDIO_OK. Do not call tools.",
      parts: [{ type: "text", text: "Connectivity check." }],
    },
  });

  const text = response.data?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  console.log(JSON.stringify({ model, response: text }, null, 2));
} finally {
  console.log("[opencode-sdk-qwen-probe] closing local OpenCode server");
  opencode.server.close();
}
