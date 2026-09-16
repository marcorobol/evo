import { readFile } from "node:fs/promises";
import { candidateProposalSchema } from "./agent-workspace/candidate-policy.js";
import { promote } from "./agent-workspace/promoted-policy.js";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("Usage: bun run src/promote-workspace-candidate.ts <workspace-evolve-report.json>");
const report = JSON.parse(await readFile(reportPath, "utf8")) as { proposals?: Array<{ proposal?: unknown; evaluation?: { accepted?: unknown } }> };
const eligible = report.proposals?.find((item) => item.evaluation?.accepted === true && item.proposal !== undefined);
if (!eligible) throw new Error("This report contains no promotable candidate.");
const proposal = candidateProposalSchema.parse(eligible.proposal);
const history = await promote(proposal);
console.log(`[workspace-promote] activated ${proposal.id}; immutable history: ${history}`);
