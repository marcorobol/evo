// Read-only installation probe: no model prompt or external tool.
// The stable SDK starts a local OpenCode server and connects a typed client to it.
const timeoutMs = 20_000;

function stage(name: string) {
  console.log(`[opencode-sdk-probe] ${name}`);
}

async function within<T>(name: string, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs / 1_000}s`)), timeoutMs);
    }),
  ]);
}

stage("loading stable SDK package");
const { createOpencode } = await within("SDK package import", import("@opencode-ai/sdk"));
stage("starting local OpenCode server");
const opencode = await within("local server startup", createOpencode({ timeout: timeoutMs }));
try {
  stage("checking server API");
  const [config, projects, providers] = await Promise.all([
    opencode.client.config.get(),
    opencode.client.project.list(),
    opencode.client.config.providers(),
  ]);
  console.log(JSON.stringify({
    sdk: "opencode",
    server: opencode.server.url,
    projects: projects.data?.length ?? 0,
    configuredModel: config.data?.model,
    providers: providers.data?.providers?.map((provider) => provider.id) ?? [],
    defaultModel: providers.data?.default,
  }, null, 2));
} finally {
  stage("closing local OpenCode server");
  opencode.server.close();
}
