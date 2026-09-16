import { mkdir, readFile, writeFile } from "node:fs/promises";
import { capabilityArtifactSchema, compileCapabilityArtifact, type CapabilityArtifact } from "./capability-artifact.js";
import type { DecisionCapability } from "./capability-registry.js";

const activePath = "agent-workspace/discovered-capabilities/active.json";

export async function loadDiscoveredCapabilities(): Promise<DecisionCapability[]> {
  try {
    const raw = JSON.parse(await readFile(activePath, "utf8")) as { capabilities?: unknown };
    if (!Array.isArray(raw.capabilities)) throw new Error("Capability registry has no capabilities array.");
    return raw.capabilities.map((item) => compileCapabilityArtifact(capabilityArtifactSchema.parse(item)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Host-controlled promotion of a benchmarked artifact. */
export async function promoteCapability(artifact: CapabilityArtifact): Promise<void> {
  await mkdir("agent-workspace/discovered-capabilities", { recursive: true });
  let existing: CapabilityArtifact[] = [];
  try { const raw = JSON.parse(await readFile(activePath, "utf8")) as { capabilities?: unknown }; existing = Array.isArray(raw.capabilities) ? raw.capabilities.map((item) => capabilityArtifactSchema.parse(item)) : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(activePath, `${JSON.stringify({ version: 1, capabilities: [artifact, ...existing.filter((item) => item.id !== artifact.id)] }, null, 2)}\n`);
}
