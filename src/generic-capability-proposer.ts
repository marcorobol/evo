import { genericCapabilitySchema, type GenericCapability } from "./generic-capability.js";
import type { CapabilityModel } from "./capability-proposer.js";
import type { EnvironmentManifest } from "./environment-contract.js";

/** The model sees only an environment manifest and its current JSON observation. */
export class GenericCapabilityProposer {
  constructor(private readonly model: CapabilityModel) {}

  async propose(goal: string, manifest: EnvironmentManifest, observation: unknown): Promise<GenericCapability> {
    const system = [
      "You discover a capability for an unknown environment.",
      "Return exactly one JSON object with name, goal, applicability, actions, and rationale.",
      "Use only actions declared in the supplied manifest, with exactly their documented JSON inputs.",
      "Do not assume domain concepts beyond the manifest and observation. Do not write code or call tools.",
    ].join(" ");
    return genericCapabilitySchema.parse(
      await this.model.generate(system, JSON.stringify({ goal, manifest, observation }), genericCapabilitySchema),
    );
  }
}
