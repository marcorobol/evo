import { readFile } from "node:fs/promises";
import { capabilityArtifactSchema } from "./agent-workspace/capability-artifact.js";
import { loadDiscoveredCapabilities, promoteCapability } from "./agent-workspace/capability-store.js";

try { process.loadEnvFile(".env"); } catch { /* optional */ }
const legacyPath = "agent-workspace/promoted/active.json";
const manifest = JSON.parse(await readFile(legacyPath, "utf8")) as {
  policies: Array<{ id: string; rationale: string; source: string }>;
};
if (!Array.isArray(manifest.policies)) throw new Error(`${legacyPath} has no policies array.`);
// Legacy composition was newest-first, first-decision-wins. CapabilityRegistry
// sorts by descending priority, so earlier (newer) legacy layers must receive
// strictly higher priorities to preserve the promoted behavior order.
const spacing = Number(process.env.MIGRATION_PRIORITY_SPACING ?? 10);
const existing = new Set((await loadDiscoveredCapabilities()).map((capability) => capability.descriptor.id));
for (const [index, policy] of manifest.policies.entries()) {
  if (existing.has(policy.id)) { console.log(`[migrate] '${policy.id}' already migrated; skipped.`); continue; }
  const artifact = capabilityArtifactSchema.parse({
    id: policy.id,
    purpose: policy.rationale,
    activation: { hook: "decision" as const, priority: (manifest.policies.length - index) * spacing },
    source: policy.source,
  });
  await promoteCapability(artifact);
  console.log(`[migrate] promoted '${artifact.id}' at priority ${artifact.activation.priority}.`);
}
