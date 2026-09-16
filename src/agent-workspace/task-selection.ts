import type { BeliefState, Parcel, Position } from "../domain.js";
import type { AgentCapability } from "./contracts.js";

/** Legacy implementation detail; not advertised as a predeclared capability. */
export const taskSelectionModule: AgentCapability = {
  id: "task-selection",
  version: 1,
  purpose: "Rank visible work items. The initial policy uses reward divided by Manhattan distance.",
};

export function selectParcel(state: BeliefState, from: Position): Parcel | undefined {
  return [...state.parcels.values()]
    .filter((parcel) => !parcel.carriedBy)
    .sort((a, b) => utility(b, from) - utility(a, from))[0];
}

function utility(parcel: Parcel, from: Position): number {
  return parcel.reward / (1 + Math.abs(parcel.x - from.x) + Math.abs(parcel.y - from.y));
}
