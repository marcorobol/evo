import { existsSync } from "node:fs";
import { BeliefStore } from "./belief-store.js";
import { DeliverooGateway } from "./deliveroo-gateway.js";
import { OnlineExplorer } from "./online-explorer.js";
import { TraceStore } from "./trace-store.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const beliefs = new BeliefStore();
const traceStore = new TraceStore(`traces/evolving-${new Date().toISOString().replaceAll(":", "-")}.jsonl`);
const explorer = new OnlineExplorer();
const gateway = new DeliverooGateway(
  process.env.DELIVEROO_URL ?? "http://localhost:8080",
  process.env.DELIVEROO_TOKEN,
  process.env.DELIVEROO_NAME ?? "evolving-agent",
  (percept) => beliefs.apply(percept),
);

console.log("[evolve] connected; bootstrapping exploration until a parcel becomes visible");
let executing = false;
let lastScore = 0;
setInterval(async () => {
  if (executing) return;
  executing = true;
  try {
    const before = beliefs.snapshot();
    const decision = explorer.next(before);
    const result = await gateway.execute(decision.action);
    explorer.observe(before, decision.action, result);
    await traceStore.record(decision.action, result, before);
    const score = beliefs.snapshot().me?.score ?? 0;
    if (decision.mode === "explore" || decision.action.kind !== "wait") {
      console.log(`[evolve] ${decision.mode}: ${JSON.stringify(decision.action)} -> ${result.ok ? "ok" : "rejected"}`);
    }
    if (score > lastScore) {
      console.log(`[evolve] reward observed: score ${lastScore} -> ${score}. Captured evidence is ready for the next capability-synthesis phase.`);
      lastScore = score;
    }
  } finally {
    executing = false;
  }
}, Number(process.env.LIVE_ACTION_INTERVAL_MS ?? 350));
