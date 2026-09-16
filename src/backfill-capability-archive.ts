import { readdir, readFile } from "node:fs/promises";
import { archiveCapability } from "./agent-workspace/capability-archive.js";

const files = (await readdir("reports")).filter((file) => /^module-evolve-.*\.json$/.test(file)).sort();
let archived = 0;
for (const file of files) {
  const report = JSON.parse(await readFile(`reports/${file}`, "utf8")) as { runID?: unknown; proposals?: unknown };
  if (typeof report.runID !== "string" || !Array.isArray(report.proposals)) continue;
  for (const [index, value] of report.proposals.entries()) {
    if (typeof value !== "object" || value === null) continue;
    const proposal = value as { attempt?: unknown; model?: unknown; accepted?: unknown; reason?: unknown; proposal?: unknown; raw?: unknown };
    if (typeof proposal.model !== "string" || typeof proposal.accepted !== "boolean" || typeof proposal.reason !== "string") continue;
    try {
      await archiveCapability({ runID: report.runID, attempt: typeof proposal.attempt === "number" ? proposal.attempt : index + 1, model: proposal.model, createdAt: "backfilled", accepted: proposal.accepted, reason: proposal.reason, ...(proposal.proposal === undefined ? {} : { proposal: proposal.proposal }), ...(typeof proposal.raw === "string" ? { raw: proposal.raw } : {}) });
      archived += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
console.log(`[capability-archive] backfilled ${archived} proposal(s)`);
