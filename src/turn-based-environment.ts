import type { Agent, BeliefState, Direction, Parcel, Position, PrimitiveAction, Tile } from "./domain.js";
import { positionKey } from "./domain.js";

export interface ScenarioParcel extends Parcel {}

export interface TurnBasedScenario {
  tiles: Tile[];
  agent: Agent;
  parcels?: ScenarioParcel[];
  batteries?: Position[];
  keys?: Position[];
  doors?: Position[];
  initialEnergy?: number;
  energyCost?: number;
}

export interface TurnEvent {
  turn: number;
  type: "moved" | "picked-up" | "put-down" | "blocked" | "waited";
  detail: string;
}

export interface TurnResult {
  accepted: boolean;
  events: TurnEvent[];
  observation: BeliefState;
}

const delta: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * Deterministic, single-agent environment used by the experimental validator.
 * Time advances only through `step`; no timers, sockets, or rendering are involved.
 */
export class TurnBasedEnvironment {
  private readonly tiles: Map<string, Tile>;
  private readonly parcels: Map<string, Parcel>;
  private readonly batteries: Set<string>;
  private readonly keys: Set<string>;
  private readonly doors: Set<string>;
  private readonly initialEnergy: number | undefined;
  private readonly energyCost: number;
  private agent: Agent;
  private energy: number | undefined;
  private hasKey = false;
  private turn = 0;

  constructor(scenario: TurnBasedScenario) {
    this.tiles = new Map(scenario.tiles.map((tile) => [positionKey(tile), { ...tile }]));
    this.parcels = new Map((scenario.parcels ?? []).map((parcel) => [parcel.id, { ...parcel }]));
    this.batteries = new Set((scenario.batteries ?? []).map(positionKey));
    this.keys = new Set((scenario.keys ?? []).map(positionKey));
    this.doors = new Set((scenario.doors ?? []).map(positionKey));
    this.agent = { ...scenario.agent };
    this.initialEnergy = scenario.initialEnergy;
    this.energy = scenario.initialEnergy;
    this.energyCost = scenario.energyCost ?? 1;
  }

  step(action: PrimitiveAction): TurnResult {
    this.turn += 1;
    switch (action.kind) {
      case "move":
        return this.move(action.direction);
      case "pickup":
        return this.pickup();
      case "putdown":
        return this.putdown();
      case "wait":
        return this.result(true, "waited", action.reason);
    }
  }

  observation(): BeliefState {
    return {
      tiles: new Map(this.tiles),
      parcels: new Map(this.parcels),
      keys: [...this.keys].map(parsePositionKey),
      doors: [...this.doors].map(parsePositionKey),
      batteries: [...this.batteries].map(parsePositionKey),
      ...(this.energy === undefined ? {} : { energy: this.energy }),
      me: { ...this.agent },
      observedAt: this.turn,
    };
  }

  fork(): TurnBasedEnvironment {
    const copy = new TurnBasedEnvironment({
      tiles: [...this.tiles.values()],
      agent: { ...this.agent },
      parcels: [...this.parcels.values()],
      batteries: [...this.batteries].map(parsePositionKey),
      keys: [...this.keys].map(parsePositionKey),
      doors: [...this.doors].map(parsePositionKey),
      ...(this.initialEnergy === undefined ? {} : { initialEnergy: this.initialEnergy }),
      energyCost: this.energyCost,
    });
    copy.energy = this.energy;
    copy.hasKey = this.hasKey;
    copy.turn = this.turn;
    return copy;
  }

  /** Stable internal-state identity for deterministic search and validation. */
  fingerprint(): string {
    return JSON.stringify({
      agent: this.agent, energy: this.energy, hasKey: this.hasKey,
      parcels: [...this.parcels.values()].sort((a, b) => a.id.localeCompare(b.id)),
      batteries: [...this.batteries].sort(), keys: [...this.keys].sort(), doors: [...this.doors].sort(),
    });
  }

  private move(direction: Direction): TurnResult {
    const movement = delta[direction];
    const target = { x: this.agent.x + movement.x, y: this.agent.y + movement.y };
    const targetKey = positionKey(target);
    const tile = this.tiles.get(targetKey);
    if (!tile || tile.type === "0") return this.result(false, "blocked", "The destination is not walkable.");
    if (this.doors.has(targetKey) && !this.hasKey) return this.result(false, "blocked", "A key is required to cross this door.");
    if (!this.spendEnergy()) return this.result(false, "blocked", "The agent has no remaining energy.");

    this.agent = { ...this.agent, ...target };
    for (const [id, parcel] of this.parcels) {
      if (parcel.carriedBy === this.agent.id) this.parcels.set(id, { ...parcel, ...target });
    }
    return this.result(true, "moved", `Moved ${direction}.`);
  }

  private pickup(): TurnResult {
    const here = positionKey(this.agent);
    let picked = false;
    let batteryCollected = false;

    for (const [id, parcel] of this.parcels) {
      if (!parcel.carriedBy && positionKey(parcel) === here) {
        this.parcels.set(id, { ...parcel, carriedBy: this.agent.id });
        picked = true;
      }
    }
    if (this.batteries.delete(here)) {
      this.energy = this.initialEnergy;
      picked = true;
      batteryCollected = true;
    }
    if (this.keys.delete(here)) {
      this.hasKey = true;
      picked = true;
    }
    if (!picked) return this.result(false, "blocked", "There is nothing to pick up on this tile.");
    if (!batteryCollected && !this.spendEnergy()) return this.result(false, "blocked", "The pickup exhausted the agent's energy.");
    return this.result(true, "picked-up", "Picked up the available objects.");
  }

  private putdown(): TurnResult {
    const carrying = [...this.parcels.values()].filter((parcel) => parcel.carriedBy === this.agent.id);
    if (carrying.length === 0) return this.result(false, "blocked", "The agent is not carrying a parcel.");
    const tile = this.tiles.get(positionKey(this.agent));
    if (!tile) return this.result(false, "blocked", "The agent is outside the known map.");

    if (tile.type === "2" || tile.type === "3") {
      const multiplier = tile.type === "3" ? 2 : 1;
      const earned = carrying.reduce((sum, parcel) => sum + parcel.reward * multiplier, 0);
      for (const parcel of carrying) this.parcels.delete(parcel.id);
      this.agent = { ...this.agent, score: this.agent.score + earned };
    } else {
      for (const parcel of carrying) {
        const { carriedBy: _dropped, ...rest } = parcel;
        this.parcels.set(parcel.id, { ...rest, x: this.agent.x, y: this.agent.y });
      }
    }
    if (!this.spendEnergy()) return this.result(false, "blocked", "The putdown exhausted the agent's energy.");
    return this.result(true, "put-down", "Put down the carried parcels.");
  }

  private spendEnergy(): boolean {
    if (this.energy === undefined) return true;
    if (this.energy <= 0) return false;
    this.energy = Math.max(0, this.energy - this.energyCost);
    return true;
  }

  private result(accepted: boolean, type: TurnEvent["type"], detail: string): TurnResult {
    return { accepted, events: [{ turn: this.turn, type, detail }], observation: this.observation() };
  }
}

function parsePositionKey(key: string): Position {
  const [x, y] = key.split(",").map(Number);
  return { x: x ?? 0, y: y ?? 0 };
}
