import { BeliefStore } from "./belief-store.js";
import { nextBaselineAction } from "./baseline-policy.js";
import { DeliverooGateway } from "./deliveroo-gateway.js";
import { TraceStore } from "./trace-store.js";

const beliefStore = new BeliefStore();
const traceStore = new TraceStore(`traces/${new Date().toISOString().replaceAll(":", "-")}.jsonl`);

const gateway = new DeliverooGateway(
  process.env.DELIVEROO_URL ?? "http://localhost:8080",
  process.env.DELIVEROO_TOKEN,
  process.env.DELIVEROO_NAME ?? "evolving-agent",
  (percept) => beliefStore.apply(percept),
);

let executing = false;
let lastIdleReportAt = 0;
setInterval(async () => {
  if (executing) return;
  executing = true;
  try {
    const before = beliefStore.snapshot();
    const action = nextBaselineAction(before);
    const result = await gateway.execute(action);
    await traceStore.record(action, result, before);
    if (action.kind !== "wait") {
      console.log(`[play] ${JSON.stringify(action)} -> ${result.ok ? "ok" : "rejected"}`);
    } else if (Date.now() - lastIdleReportAt >= 5_000) {
      lastIdleReportAt = Date.now();
      console.log(`[play] waiting: no visible parcels (position=${before.me?.x ?? "?"},${before.me?.y ?? "?"}; known parcels=${before.parcels.size})`);
    }
  } finally {
    executing = false;
  }
}, 250);
