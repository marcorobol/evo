import { readFile } from "node:fs/promises";
import { z } from "zod";

export const requirementSchema = z.object({
  id: z.string(),
  capability: z.string().min(1),
  status: z.enum(["validated", "ready", "blocked-by-benchmark", "research-design-needed"]),
  intent: z.string(),
  benchmark: z.string(),
  metric: z.string(),
});
export const requirementBacklogSchema = z.object({ version: z.literal(1), purpose: z.string(), requirements: z.array(requirementSchema) });
export type Requirement = z.infer<typeof requirementSchema>;

export async function loadRequirementBacklog(path = "agent-workspace/requirements.v1.json"): Promise<z.infer<typeof requirementBacklogSchema>> {
  return requirementBacklogSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
