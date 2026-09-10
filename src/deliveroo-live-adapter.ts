import type { BeliefStore } from "./belief-store.js";
import type { ActionResult, PrimitiveAction } from "./domain.js";
import type { DeliverooGateway } from "./deliveroo-gateway.js";
import type { EnvironmentManifest, EnvironmentStep, ExperimentEnvironment } from "./environment-contract.js";

export interface DeliverooLiveObservation {
  me: unknown;
  tiles: unknown[];
  parcels: unknown[];
  knownWorld: { width?: number; height?: number };
}

/** The evolving core sees only a manifest, an observation, and action outcomes. */
export class DeliverooLiveAdapter implements ExperimentEnvironment<PrimitiveAction, DeliverooLiveObservation> {
  readonly manifest: EnvironmentManifest = {
    id: "deliveroojs-live",
    version: 1,
    observationDescription: "Partial JSON observation from a real-time grid world: self, known tiles, and currently sensed movable objects.",
    actions: [
      { name: "move", inputDescription: "{kind:'move', direction:'up'|'right'|'down'|'left'}" },
      { name: "pickup", inputDescription: "{kind:'pickup'}" },
      { name: "putdown", inputDescription: "{kind:'putdown'}" },
      { name: "wait", inputDescription: "{kind:'wait', reason:string}" },
    ],
    successDescription: "A positive change in the observed agent score is an externally measured success signal.",
  };

  private readonly initialScore: number;

  constructor(
    private readonly beliefs: BeliefStore,
    private readonly gateway: Pick<DeliverooGateway, "execute">,
    private readonly settleMs = Number(process.env.DELIVEROO_STEP_SETTLE_MS ?? 150),
  ) {
    this.initialScore = beliefs.snapshot().me?.score ?? 0;
  }

  observe(): DeliverooLiveObservation {
    const state = this.beliefs.snapshot();
    return {
      me: state.me ?? null,
      tiles: [...state.tiles.values()],
      parcels: [...state.parcels.values()],
      knownWorld: {
        ...(state.width === undefined ? {} : { width: state.width }),
        ...(state.height === undefined ? {} : { height: state.height }),
      },
    };
  }

  /** Live worlds cannot be cloned; deterministic environments are for validation. */
  fork(): ExperimentEnvironment<PrimitiveAction, DeliverooLiveObservation> {
    throw new Error("A live Deliveroo.js environment cannot be forked. Validate candidate code in a deterministic environment.");
  }

  async step(action: PrimitiveAction): Promise<EnvironmentStep<DeliverooLiveObservation>> {
    const result = await this.gateway.execute(action);
    if (this.settleMs > 0) await delay(this.settleMs);
    return { accepted: result.ok, events: [toEvent(action, result)], observation: this.observe() };
  }

  outcome(): { score: number; achieved: boolean } {
    const score = this.beliefs.snapshot().me?.score ?? this.initialScore;
    return { score, achieved: score > this.initialScore };
  }
}

function toEvent(action: PrimitiveAction, result: ActionResult): { type: string; detail: string } {
  return { type: result.ok ? "action-accepted" : "action-rejected", detail: `${action.kind}: ${stringify(result.detail)}` };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
