import type { Agent, BeliefState, Parcel, Percept, Tile } from "./domain.js";
import { positionKey } from "./domain.js";

export class BeliefStore {
  readonly state: BeliefState = {
    tiles: new Map(),
    parcels: new Map(),
    observedAt: 0,
  };

  apply(percept: Percept): void {
    this.state.observedAt = Date.now();

    switch (percept.type) {
      case "map":
        this.state.width = percept.width;
        this.state.height = percept.height;
        this.state.tiles = new Map(percept.tiles.map((tile) => [positionKey(tile), tile]));
        return;
      case "tile":
        this.state.tiles.set(positionKey(percept.tile), percept.tile);
        return;
      case "you":
        this.state.me = percept.agent;
        return;
      case "sensing":
        this.mergeParcels(percept.parcels);
        return;
    }
  }

  private mergeParcels(parcels: Parcel[]): void {
    for (const parcel of parcels) {
      this.state.parcels.set(parcel.id, parcel);
    }
  }

  snapshot(): BeliefState {
    return {
      ...this.state,
      tiles: new Map(this.state.tiles),
      parcels: new Map(this.state.parcels),
      ...(this.state.me ? { me: { ...this.state.me } } : {}),
    };
  }

  getTile(position: { x: number; y: number }): Tile | undefined {
    return this.state.tiles.get(positionKey(position));
  }

  get me(): Agent | undefined {
    return this.state.me;
  }
}
