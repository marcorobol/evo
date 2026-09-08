export type Direction = "up" | "right" | "down" | "left";

export interface Position {
  x: number;
  y: number;
}

export interface Tile extends Position {
  type: string;
}

export interface Parcel extends Position {
  id: string;
  reward: number;
  carriedBy?: string;
}

export interface Agent extends Position {
  id: string;
  name: string;
  score: number;
}

export interface BeliefState {
  width?: number;
  height?: number;
  tiles: Map<string, Tile>;
  me?: Agent;
  parcels: Map<string, Parcel>;
  keys?: Position[];
  doors?: Position[];
  batteries?: Position[];
  energy?: number;
  observedAt: number;
}

export type Percept =
  | { type: "map"; width: number; height: number; tiles: Tile[] }
  | { type: "tile"; tile: Tile }
  | { type: "you"; agent: Agent }
  | { type: "sensing"; parcels: Parcel[] };

export type PrimitiveAction =
  | { kind: "move"; direction: Direction }
  | { kind: "pickup" }
  | { kind: "putdown" }
  | { kind: "wait"; reason: string };

export interface ActionResult {
  ok: boolean;
  detail: unknown;
}

export const positionKey = ({ x, y }: Position): string => `${x},${y}`;
