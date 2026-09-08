import type { BeliefState, Direction, Parcel, Position, PrimitiveAction } from "./domain.js";
import { positionKey } from "./domain.js";

const directions: ReadonlyArray<{ direction: Direction; dx: number; dy: number }> = [
  { direction: "up", dx: 0, dy: -1 },
  { direction: "right", dx: 1, dy: 0 },
  { direction: "down", dx: 0, dy: 1 },
  { direction: "left", dx: -1, dy: 0 },
];

function isWalkable(type: string): boolean {
  return type !== "0";
}

function at(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function route(state: BeliefState, from: Position, to: Position): Direction[] | undefined {
  const queue: Position[] = [from];
  const previous = new Map<string, { parent: string; direction: Direction }>();
  const seen = new Set([positionKey(from)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (at(current, to)) {
      const result: Direction[] = [];
      let cursor = positionKey(to);
      while (cursor !== positionKey(from)) {
        const step = previous.get(cursor);
        if (!step) return undefined;
        result.unshift(step.direction);
        cursor = step.parent;
      }
      return result;
    }

    for (const step of directions) {
      const next = { x: current.x + step.dx, y: current.y + step.dy };
      const key = positionKey(next);
      const tile = state.tiles.get(key);
      if (!tile || !isWalkable(tile.type) || seen.has(key)) continue;
      seen.add(key);
      previous.set(key, { parent: positionKey(current), direction: step.direction });
      queue.push(next);
    }
  }
  return undefined;
}

function closest<T extends Position>(from: Position, candidates: Iterable<T>): T | undefined {
  return [...candidates]
    .map((candidate) => ({ candidate, distance: Math.abs(candidate.x - from.x) + Math.abs(candidate.y - from.y) }))
    .sort((a, b) => a.distance - b.distance)[0]?.candidate;
}

export function nextBaselineAction(state: BeliefState): PrimitiveAction {
  const me = state.me;
  if (!me) return { kind: "wait", reason: "Awaiting the initial agent percept." };

  const parcels = [...state.parcels.values()];
  const carried = parcels.filter((parcel) => parcel.carriedBy === me.id);
  const available = parcels.filter((parcel) => !parcel.carriedBy);
  const deliveryTiles = [...state.tiles.values()].filter((tile) => tile.type === "2");

  if (carried.length > 0) {
    const delivery = closest(me, deliveryTiles);
    if (!delivery) return { kind: "wait", reason: "No known delivery tile." };
    if (at(me, delivery)) return { kind: "putdown" };
    return moveTowards(state, me, delivery, "Delivery tile is unreachable.");
  }

  const parcel = closest(me, available);
  if (!parcel) return { kind: "wait", reason: "No visible parcel." };
  if (at(me, parcel)) return { kind: "pickup" };
  return moveTowards(state, me, parcel, `Parcel ${parcel.id} is unreachable.`);
}

function moveTowards(state: BeliefState, from: Position, target: Position, failureReason: string): PrimitiveAction {
  const firstStep = route(state, from, target)?.[0];
  return firstStep ? { kind: "move", direction: firstStep } : { kind: "wait", reason: failureReason };
}
