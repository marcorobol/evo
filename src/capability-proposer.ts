import type { BeliefState } from "./domain.js";
import { capabilityProposalSchema, type CapabilityProposal } from "./capability-contract.js";
import type { CapabilityValidation } from "./capability-validator.js";
import type { z } from "zod";

export { capabilityProposalSchema, type CapabilityProposal } from "./capability-contract.js";

export interface CapabilityModel {
  generate(system: string, prompt: string, outputSchema?: z.ZodType): Promise<unknown>;
}

export class CapabilityProposer {
  constructor(private readonly model: CapabilityModel) {}

  async propose(goal: string, beliefs: BeliefState): Promise<CapabilityProposal> {
    const system = [
      "You propose candidate capabilities for a grid-based delivery agent.",
      "Return exactly one JSON object and no Markdown.",
      "The object must have name, goal, applicability, preconditions, plan, and rationale.",
      "preconditions must contain requiresKey, requiresDoor, requiresBattery booleans and minimumParcels integer.",
      "Each plan action must be one of: move(up|right|down|left), pickup, putdown, wait(reason).",
      "A key must be picked up before moving onto a listed door position.",
      "Pickup collects every available object on the current position; putdown delivers a carried parcel only on a tile whose type is '2' or '3'.",
      "Derive the exact ordered plan from the provided coordinates. Do not assume the agent starts elsewhere.",
      "Do not invent actions, call tools, write source code, or claim that the plan was executed.",
    ].join(" ");
    return capabilityProposalSchema.parse(
      await this.model.generate(system, JSON.stringify({ goal, beliefs: printableBeliefs(beliefs) })),
    );
  }

  async repair(goal: string, beliefs: BeliefState, failed: CapabilityProposal, validation: CapabilityValidation): Promise<CapabilityProposal> {
    const feedback = validation.turns
      .filter((turn) => !turn.accepted)
      .flatMap((turn) => turn.events.map((event) => event.detail))
      .join(" ");
    return this.propose(
      `${goal}\nA previous candidate '${failed.name}' was rejected. Validator feedback: ${feedback}\nGenerate a corrected plan; do not repeat a failed action.`,
      beliefs,
    );
  }
}

function printableBeliefs(beliefs: BeliefState): object {
  return {
    me: beliefs.me,
    map: { width: beliefs.width, height: beliefs.height, tiles: [...beliefs.tiles.values()] },
    parcels: [...beliefs.parcels.values()],
    keys: beliefs.keys ?? [],
    doors: beliefs.doors ?? [],
    batteries: beliefs.batteries ?? [],
    energy: beliefs.energy,
  };
}
