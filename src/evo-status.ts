import { readdir, readFile, stat } from "node:fs/promises";
import { capabilityArtifactSchema } from "./agent-workspace/capability-artifact.js";
import { readHolder, isAlive } from "./evo-lock.js";

export async function printStatus(): Promise<void> {
  const blank = process.env.EVOLUTION_BLANK_SLATE === "1";
  console.log("Evo status\n");
  console.log(`Regime: ${blank ? "blank-slate (EVOLUTION_BLANK_SLATE=1)" : "standard"}`);

  const holder = await readHolder();
  if (!holder) {
    console.log("Lock: free");
  } else if (isAlive(holder.pid)) {
    console.log(`Lock: held by 'evo ${holder.command}' (pid ${holder.pid}, started ${holder.startedAt})`);
  } else {
    console.log(`Lock: stale — 'evo ${holder.command}' (pid ${holder.pid}) is no longer running. Run: rm .evo/lock`);
  }

  const storeRaw = await readFile("agent-workspace/discovered-capabilities/active.json", "utf8").catch(() => null);
  if (storeRaw === null) {
    console.log("Promoted capabilities: none (store absent — run 'bun run src/migrate-promoted-policies.ts' or start an evolution cycle)");
  } else {
    try {
      const store = JSON.parse(storeRaw) as { capabilities?: unknown[] };
      const capabilities = Array.isArray(store.capabilities) ? store.capabilities : [];
      if (!capabilities.length) {
        console.log("Promoted capabilities: none");
      } else {
        console.log(`Promoted capabilities: ${capabilities.length}`);
        for (const raw of capabilities) {
          const result = capabilityArtifactSchema.safeParse(raw);
          if (result.success) {
            const { id, purpose, activation } = result.data;
            console.log(`  [${String(activation.priority).padStart(3)}] ${id.padEnd(40)} ${purpose.slice(0, 60)}${purpose.length > 60 ? "…" : ""}`);
          } else {
            console.log(`  [???] (invalid entry)`);
          }
        }
      }
    } catch {
      console.log("Promoted capabilities: store unreadable — check agent-workspace/discovered-capabilities/active.json");
    }
  }

  const archiveEntries = await readdir("agent-workspace/capability-archive").catch(() => [] as string[]);
  console.log(`Archive: ${archiveEntries.filter((f) => f.endsWith(".json")).length} archived proposals`);

  const seedPresent = await stat("agent-workspace/promoted").then(() => true).catch(() => false);
  console.log(`Migration seed (agent-workspace/promoted/): ${seedPresent ? "present — 'bun run src/migrate-promoted-policies.ts' can rebuild the store" : "absent"}`);

  await printLatestReport("workspace-benchmark-", "workspace-benchmark", (r) => {
    const episodes = (r as { episodes?: Array<{ achieved: boolean; score: number }> }).episodes ?? [];
    const successes = episodes.filter((e) => e.achieved).length;
    const score = episodes.reduce((t, e) => t + e.score, 0);
    return `${successes}/${episodes.length} achieved, score ${score}`;
  });

  await printLatestReport("family-benchmark-", "family-benchmark", (r) => {
    const families = (r as { families?: unknown[] }).families ?? [];
    return `${families.length} famil${families.length === 1 ? "y" : "ies"}`;
  });
}

async function printLatestReport(prefix: string, label: string, summarize: (r: unknown) => string): Promise<void> {
  try {
    const files = (await readdir("reports")).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().reverse();
    if (!files.length) { console.log(`Latest ${label}: no reports yet — run 'evo benchmark all'`); return; }
    const id = files[0]!.slice(0, -5);
    const report = JSON.parse(await readFile(`reports/${files[0]!}`, "utf8")) as unknown;
    console.log(`Latest ${label}: ${id} — ${summarize(report)}`);
  } catch {
    console.log(`Latest ${label}: unreadable`);
  }
}
