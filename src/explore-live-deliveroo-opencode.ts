import { existsSync } from "node:fs";
import { BeliefStore } from "./belief-store.js";
import { DeliverooGateway } from "./deliveroo-gateway.js";
import { DeliverooLiveAdapter } from "./deliveroo-live-adapter.js";
import { GenericExplorer } from "./generic-explorer.js";
import { createOpenCodeCapabilityRunner } from "./opencode-capability-model.js";
import { decodeTurnBasedAction } from "./turn-based-adapter.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const maximumSteps = positiveInteger("LIVE_MAX_STEPS", 12);
const readinessTimeoutMs = positiveInteger("DELIVEROO_READY_TIMEOUT_MS", 15_000);
const beliefs = new BeliefStore();
const gateway = new DeliverooGateway(
  process.env.DELIVEROO_URL ?? "http://localhost:8080",
  process.env.DELIVEROO_TOKEN,
  process.env.DELIVEROO_NAME ?? "evolving-agent",
  (percept) => beliefs.apply(percept),
);

console.log(`[live] connecting to ${process.env.DELIVEROO_URL ?? "http://localhost:8080"} as ${process.env.DELIVEROO_NAME ?? "evolving-agent"}`);
await waitForInitialObservation(beliefs, readinessTimeoutMs);
console.log("[live] initial observation received; beginning one-action-at-a-time discovery");

const runner = await createOpenCodeCapabilityRunner();
try {
  const environment = new DeliverooLiveAdapter(beliefs, gateway);
  const trace = await new GenericExplorer(runner.model).explore(environment, decodeTurnBasedAction, maximumSteps);
  console.log(JSON.stringify({ backend: "opencode-sdk", environment: environment.manifest, trace }, null, 2));
  process.exitCode = trace.outcome.achieved ? 0 : 2;
} finally {
  runner.close();
}

async function waitForInitialObservation(store: BeliefStore, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = store.snapshot();
    if (state.me && state.tiles.size > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No initial Deliveroo.js observation after ${timeoutMs}ms. Check DELIVEROO_URL and that the game is running.`);
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}
