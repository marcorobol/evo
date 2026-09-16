import type { BeliefState, Position, PrimitiveAction, Tile } from "./domain.js";
import { positionKey } from "./domain.js";
import { TurnBasedEnvironment, type TurnBasedScenario, type TurnResult } from "./turn-based-environment.js";

/**
 * A deterministic local-view wrapper. The world advances in the normal
 * simulator; observations retain only cells and objects previously seen
 * within the configured Manhattan radius. This gives exploration a real job.
 */
export class PartialObservationEnvironment {
  private readonly environment: TurnBasedEnvironment;
  private readonly knownTiles = new Map<string, Tile>();
  private readonly knownParcels = new Map<string, BeliefState["parcels"] extends Map<string, infer P> ? P : never>();
  private readonly knownKeys = new Map<string, Position>();
  private readonly knownDoors = new Map<string, Position>();
  private readonly knownBatteries = new Map<string, Position>();
  private readonly width: number;
  private readonly height: number;

  constructor(scenario: TurnBasedScenario, private readonly radius = 0) {
    this.environment = new TurnBasedEnvironment(scenario);
    this.width = Math.max(...scenario.tiles.map((tile) => tile.x)) + 1;
    this.height = Math.max(...scenario.tiles.map((tile) => tile.y)) + 1;
  }

  step(action: PrimitiveAction): TurnResult { return this.environment.step(action); }

  observation(): BeliefState {
    const full = this.environment.observation();
    const me = full.me;
    if (!me) return full;
    const visible = <T extends Position>(items: Iterable<T>) => [...items].filter((item) => Math.abs(item.x - me.x) + Math.abs(item.y - me.y) <= this.radius);
    for (const tile of visible(full.tiles.values())) this.knownTiles.set(positionKey(tile), { ...tile });
    for (const parcel of visible(full.parcels.values())) this.knownParcels.set(parcel.id, { ...parcel });
    for (const item of visible(full.keys ?? [])) this.knownKeys.set(positionKey(item), { ...item });
    for (const item of visible(full.doors ?? [])) this.knownDoors.set(positionKey(item), { ...item });
    for (const item of visible(full.batteries ?? [])) this.knownBatteries.set(positionKey(item), { ...item });
    return {
      width: this.width, height: this.height, me: { ...me }, observedAt: full.observedAt,
      tiles: new Map(this.knownTiles), parcels: new Map(this.knownParcels),
      keys: [...this.knownKeys.values()], doors: [...this.knownDoors.values()], batteries: [...this.knownBatteries.values()],
      ...(full.energy === undefined ? {} : { energy: full.energy }),
    };
  }
}
