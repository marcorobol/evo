import { nextBaselineAction } from "./baseline-policy.js";
import type { ActionResult, BeliefState, Direction, PrimitiveAction } from "./domain.js";
import { positionKey } from "./domain.js";

const directions: Direction[] = ["up", "right", "down", "left"];

/**
 * Fast, model-free bootstrap behaviour for a live world. It learns which
 * moves have been tried at each observed position; a model can later reflect
 * on the recorded evidence without sitting in the real-time action loop.
 */
export class OnlineExplorer {
  private readonly triedMoves = new Map<string, Set<Direction>>();
  private cursor = 0;

  next(state: BeliefState): { action: PrimitiveAction; mode: "explore" | "exploit" | "wait" } {
    const me = state.me;
    if (!me) return { action: { kind: "wait", reason: "Awaiting the initial agent percept." }, mode: "wait" };

    const hasParcelEvidence = [...state.parcels.values()].length > 0;
    if (hasParcelEvidence) {
      const action = nextBaselineAction(state);
      return { action, mode: action.kind === "wait" ? "wait" : "exploit" };
    }

    const key = positionKey(me);
    const tried = this.triedMoves.get(key) ?? new Set<Direction>();
    this.triedMoves.set(key, tried);
    const direction = directions.find((candidate) => !tried.has(candidate)) ?? directions[this.cursor++ % directions.length]!;
    return { action: { kind: "move", direction }, mode: "explore" };
  }

  observe(before: BeliefState, action: PrimitiveAction, result: ActionResult): void {
    if (action.kind !== "move" || !before.me) return;
    const key = positionKey(before.me);
    const tried = this.triedMoves.get(key) ?? new Set<Direction>();
    tried.add(action.direction);
    this.triedMoves.set(key, tried);
    if (!result.ok) console.log(`[evolve] learned: move ${action.direction} from ${key} was rejected`);
  }
}
