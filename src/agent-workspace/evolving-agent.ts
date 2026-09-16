import type { BeliefState, Position } from "../domain.js";
import type { AgentCapability, EvolvableAgent, ModuleDecision, PolicyContext, PolicyExtension } from "./contracts.js";
import { HeatmapMemory } from "./memory.js";
import { findPath } from "./navigation.js";
import { selectParcel } from "./task-selection.js";

/**
 * The substrate deliberately exposes no named cognitive modules. It supplies
 * observation, primitive actions and episode memory; learned capabilities are
 * layered artifacts selected only by their own discovered identifiers.
 */
export interface EvolvingAgentOptions {
  /** Tested candidate code. It can override a decision, never the environment. */
  extension?: PolicyExtension;
  extensionModule?: string;
  /** Ordered discovered capabilities; the first applicable layer wins. */
  extensions?: ReadonlyArray<PolicyExtension>;
  extensionModules?: ReadonlyArray<string>;
}

export function createEvolvingAgent(options: EvolvingAgentOptions = {}): EvolvableAgent {
  let memory = new HeatmapMemory();
  const extensions = options.extensions ?? (options.extension ? [options.extension] : []);
  const extensionModules = options.extensionModules ?? (options.extensionModule ? [options.extensionModule] : []);
  return {
    capabilities: extensionModules.map((id): AgentCapability => ({ id, version: 1, purpose: "Discovered executable capability under evaluation or promotion." })),
    reset() { memory = new HeatmapMemory(); },
    memory() { return memory; },
    recordOutcome(accepted) { memory.recordOutcome(accepted); },
    nextAction(state) {
      const baseline = decide(state);
      const context = policyContext(state, baseline, memory.snapshot());
      const candidate = extensions.map((extension) => extension(context)).find((result) => result !== undefined);
      const decision = candidate ?? baseline;
      memory.record(state, decision);
      return decision;
    },
  };
}

function policyContext(state: BeliefState, baseline: ModuleDecision, memory: ReturnType<HeatmapMemory["snapshot"]>): PolicyContext {
  return {
    observation: {
      ...(state.width === undefined ? {} : { width: state.width }),
      ...(state.height === undefined ? {} : { height: state.height }),
      ...(state.me ? { me: { id: state.me.id, x: state.me.x, y: state.me.y, score: state.me.score } } : {}),
      tiles: [...state.tiles.values()].map(({ x, y, type }) => ({ x, y, type })),
      parcels: [...state.parcels.values()].map((parcel) => ({ ...parcel })),
      keys: [...(state.keys ?? [])].map((position) => ({ ...position })),
      doors: [...(state.doors ?? [])].map((position) => ({ ...position })),
      batteries: [...(state.batteries ?? [])].map((position) => ({ ...position })),
      ...(state.energy === undefined ? {} : { energy: state.energy }),
    },
    baseline,
    memory,
  };
}

function decide(state: BeliefState): ModuleDecision {
  const me = state.me;
  if (!me) return decision({ kind: "wait", reason: "Awaiting an agent observation." }, 0, "substrate", "No agent position is known.");
  const carried = [...state.parcels.values()].filter((parcel) => parcel.carriedBy === me.id);
  const destination = closest(me, [...state.tiles.values()].filter((tile) => tile.type === "2"));
  if (carried.length) {
    if (!destination) return decision({ kind: "wait", reason: "No delivery target is known." }, 0.1, "substrate", "Carrying work but no destination is visible.");
    if (samePosition(me, destination)) return decision({ kind: "putdown" }, 1, "substrate", "A carried parcel is on the delivery target.");
    return routeDecision(state, me, destination, "Returning a carried parcel to the selected delivery target.");
  }
  const parcel = selectParcel(state, me);
  if (!parcel) return decision({ kind: "wait", reason: "No visible task." }, 0.2, "substrate", "No visible parcel can be selected.");
  if (samePosition(me, parcel)) return decision({ kind: "pickup" }, 1, "substrate", "Selected parcel is co-located with the agent.");
  return routeDecision(state, me, parcel, `Routing to parcel ${parcel.id} with the highest current utility.`);
}

function routeDecision(state: BeliefState, from: Position, target: Position, rationale: string): ModuleDecision {
  const path = findPath({ tiles: state.tiles, canEnter: (tile) => tile.type !== "0" }, from, target);
  const direction = path?.[0];
  return direction
    ? decision({ kind: "move", direction }, 0.8, "substrate", rationale)
    : decision({ kind: "wait", reason: "Known target is unreachable." }, 0.1, "substrate", "No route exists on the current known graph.");
}

function decision(action: ModuleDecision["action"], confidence: number, module: string, rationale: string): ModuleDecision {
  return { action, confidence, module, rationale };
}

function samePosition(a: Position, b: Position): boolean { return a.x === b.x && a.y === b.y; }
function closest<T extends Position>(from: Position, values: T[]): T | undefined {
  return values.sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - Math.abs(b.x - from.x) - Math.abs(b.y - from.y))[0];
}
