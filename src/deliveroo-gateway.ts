import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import type { ActionResult, Agent, Parcel, Percept, PrimitiveAction, Tile } from "./domain.js";

type Socket = {
  on(event: string, callback: (...args: unknown[]) => void): void;
  emitMove(direction: "up" | "right" | "down" | "left"): Promise<unknown>;
  emitPickup(): Promise<unknown>;
  emitPutdown(): Promise<unknown>;
};

export class DeliverooGateway {
  private readonly socket: Socket;

  constructor(
    host: string,
    token: string | undefined,
    name: string | undefined,
    private readonly onPercept: (percept: Percept) => void,
  ) {
    this.socket = DjsConnect(host, token, name) as Socket;
    this.socket.on("map", (width, height, tiles) => {
      this.onPercept({ type: "map", width: Number(width), height: Number(height), tiles: tiles as Tile[] });
    });
    this.socket.on("tile", (tile) => this.onPercept({ type: "tile", tile: tile as Tile }));
    this.socket.on("you", (agent) => this.onPercept({ type: "you", agent: agent as Agent }));
    this.socket.on("sensing", (sensing) => {
      const value = sensing as { parcels?: Parcel[] };
      this.onPercept({ type: "sensing", parcels: value.parcels ?? [] });
    });
  }

  async execute(action: PrimitiveAction): Promise<ActionResult> {
    try {
      switch (action.kind) {
        case "move": {
          const detail = await this.socket.emitMove(action.direction);
          return { ok: detail !== false, detail };
        }
        case "pickup":
          return { ok: true, detail: await this.socket.emitPickup() };
        case "putdown":
          return { ok: true, detail: await this.socket.emitPutdown() };
        case "wait":
          return { ok: true, detail: action.reason };
      }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
