import type { BeliefState } from "./domain.js";
import { codeCapabilitySchema, type CodeCapability } from "./capability-contract.js";
import type { CapabilityProposal } from "./capability-contract.js";
import type { CapabilityModel } from "./capability-proposer.js";

export class CodeCapabilityProposer {
  constructor(private readonly model: CapabilityModel) {}

  async propose(goal: string, beliefs: BeliefState): Promise<CodeCapability> {
    const system = [
      "You propose reusable procedural capabilities for a grid-based delivery agent.",
      "Return exactly one JSON object and no Markdown with name, goal, applicability, preconditions, source, and rationale.",
      "preconditions must contain requiresKey, requiresDoor, requiresBattery booleans and minimumParcels integer.",
      "source must be one pure JavaScript function expression with signature (context) => PrimitiveAction[].",
      "The only permitted actions are move(up|right|down|left), pickup, putdown, and wait(reason).",
      "Return action objects, never action strings: e.g. (context) => [{ kind: 'pickup' }, { kind: 'move', direction: 'right' }].",
      "Use only context.me, context.map, context.parcels, context.keys, context.doors, context.batteries, and context.energy.",
      "Do not use imports, process, globalThis, eval, Function, fetch, loops, async code, or external state.",
      "A key must be picked up before moving onto a listed door position. Return a concrete, ordered action array for this context.",
    ].join(" ");
    return codeCapabilitySchema.parse(
      normalizeCandidate(await this.model.generate(system, JSON.stringify({ goal, beliefs: printableBeliefs(beliefs) }), codeCapabilitySchema)),
    );
  }

  async generalize(seed: CapabilityProposal, beliefs: BeliefState): Promise<CodeCapability> {
    const system = [
      "You generalize an already validated grid-delivery plan into a tiny reusable JavaScript capability.",
      "Return exactly one JSON object with name, goal, applicability, preconditions, source, and rationale.",
      "source must be one pure JavaScript function expression (context) => PrimitiveAction[].",
      "Preserve the seed plan's successful action structure. Generalize only coordinates or directions using context.",
      "Example direction generalization: const door = context.doors[0]; const direction = door.x > context.me.x ? 'right' : 'left';",
      "Return action objects, never strings. Do not use imports, process, globalThis, eval, Function, fetch, loops, async code, or external state.",
    ].join(" ");
    return codeCapabilitySchema.parse(
      normalizeCandidate(await this.model.generate(system, JSON.stringify({ seed, beliefs: printableBeliefs(beliefs) }), codeCapabilitySchema)),
    );
  }
}

function normalizeCandidate(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || !Array.isArray((candidate as { preconditions?: unknown }).preconditions)) return candidate;
  const record = candidate as Record<string, unknown>;
  const terms = JSON.stringify(record.preconditions).toLowerCase();
  return {
    ...record,
    preconditions: {
      requiresKey: terms.includes("key"),
      requiresDoor: terms.includes("door"),
      requiresBattery: terms.includes("battery"),
      minimumParcels: terms.includes("parcel") ? 1 : 0,
    },
  };
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
