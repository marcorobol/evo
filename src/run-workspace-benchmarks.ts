import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createEvolvingAgent } from "./agent-workspace/evolving-agent.js";
import { diagnose } from "./agent-workspace/diagnostics.js";
import { runBenchmark } from "./agent-workspace/benchmark-runner.js";
import { runPartialObservationBenchmark } from "./agent-workspace/benchmark-runner.js";
import { loadDiscoveredCapabilities } from "./agent-workspace/capability-store.js";
import { loadScenario } from "./scenario-loader.js";

const directory = fileURLToPath(new URL("../scenarios/", import.meta.url));
const files = ["simple-delivery.v1.json", "key-door-delivery.v1.json", "two-parcels.v1.json", "battery-return.v1.json", "detour-delivery.v1.json", "partial-observation-frontier.v1.json", "partial-observation-backtrack.v1.json"];
const active = await loadDiscoveredCapabilities();
const agent = createEvolvingAgent({ capabilities: active });
if (active.length) console.log(`[benchmark] using ${active.length} promoted capabilit${active.length === 1 ? "y" : "ies"}: ${active.map((capability) => capability.descriptor.id).join(", ")}`);
const episodes = [];
for (const file of files) {
  const { metadata, scenario } = await loadScenario(`${directory}/${file}`);
  const episode = metadata.name.startsWith("partial-observation-")
    ? runPartialObservationBenchmark(metadata.name, scenario, agent, 1)
    : runBenchmark(metadata.name, scenario, agent);
  episodes.push({ ...episode, bottlenecks: diagnose(episode) });
  console.log(`[benchmark] ${metadata.name}: score=${episode.score}; steps=${episode.steps}; blocked=${episode.blockedActions}; waits=${episode.waits}`);
}
const report = { runID: `workspace-benchmark-${Date.now()}`, capabilities: agent.capabilities, activeCapabilities: active.map((capability) => capability.descriptor.id), episodes };
await mkdir("reports", { recursive: true });
await writeFile(`reports/${report.runID}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[benchmark] report: reports/${report.runID}.json`);
