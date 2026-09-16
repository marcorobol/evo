import type { Direction, Position, Tile } from "../domain.js";
import { positionKey } from "../domain.js";
import type { AgentCapability } from "./contracts.js";

const directions: ReadonlyArray<{ direction: Direction; dx: number; dy: number }> = [
  { direction: "up", dx: 0, dy: -1 },
  { direction: "right", dx: 1, dy: 0 },
  { direction: "down", dx: 0, dy: 1 },
  { direction: "left", dx: -1, dy: 0 },
];

/** Environment-specific traversal policy is injected, never hard-coded by A*. */
export interface NavigationWorld {
  tiles: ReadonlyMap<string, Tile>;
  canEnter(tile: Tile): boolean;
}

/** Legacy implementation detail; not advertised as a predeclared capability. */
export const navigationModule: AgentCapability = {
  id: "navigation",
  version: 1,
  purpose: "Compute a shortest known route using A* over an adapter-provided traversability model.",
};

export function findPath(world: NavigationWorld, from: Position, target: Position): Direction[] | undefined {
  const origin = positionKey(from);
  const destination = positionKey(target);
  if (origin === destination) return [];
  const open = [{ position: from, cost: 0, estimate: distance(from, target) }];
  const cost = new Map([[origin, 0]]);
  const previous = new Map<string, { parent: string; direction: Direction }>();

  while (open.length) {
    open.sort((a, b) => a.cost + a.estimate - (b.cost + b.estimate));
    const current = open.shift();
    if (!current) break;
    const currentKey = positionKey(current.position);
    if (currentKey === destination) return reconstruct(previous, origin, destination);
    for (const step of directions) {
      const next = { x: current.position.x + step.dx, y: current.position.y + step.dy };
      const key = positionKey(next);
      const tile = world.tiles.get(key);
      if (!tile || !world.canEnter(tile)) continue;
      const nextCost = current.cost + 1;
      if (nextCost >= (cost.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      cost.set(key, nextCost);
      previous.set(key, { parent: currentKey, direction: step.direction });
      open.push({ position: next, cost: nextCost, estimate: distance(next, target) });
    }
  }
  return undefined;
}

function reconstruct(previous: Map<string, { parent: string; direction: Direction }>, origin: string, destination: string): Direction[] | undefined {
  const result: Direction[] = [];
  for (let cursor = destination; cursor !== origin;) {
    const step = previous.get(cursor);
    if (!step) return undefined;
    result.unshift(step.direction);
    cursor = step.parent;
  }
  return result;
}

function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
