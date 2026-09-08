import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ActionResult, BeliefState, PrimitiveAction } from "./domain.js";

export class TraceStore {
  constructor(private readonly path: string) {}

  async record(action: PrimitiveAction, result: ActionResult, before: BeliefState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(
      this.path,
      `${JSON.stringify({
        at: new Date().toISOString(),
        action,
        result,
        belief: {
          me: before.me,
          knownTiles: before.tiles.size,
          knownParcels: [...before.parcels.values()],
        },
      })}\n`,
    );
  }
}
