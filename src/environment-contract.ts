/** A self-describing boundary between the evolving core and any environment.
 * TurnBasedAdapter is the reference implementation; the live Deliveroo
 * experiment adapter was removed with the legacy flows. */
export interface EnvironmentManifest {
  id: string;
  version: number;
  observationDescription: string;
  actions: Array<{ name: string; inputDescription?: string }>;
  successDescription: string;
}

export interface EnvironmentStep<Observation> {
  accepted: boolean;
  events: Array<{ type: string; detail: string }>;
  observation: Observation;
}

export interface ExperimentEnvironment<Action, Observation> {
  readonly manifest: EnvironmentManifest;
  observe(): Observation;
  fork(): ExperimentEnvironment<Action, Observation>;
  step(action: Action): EnvironmentStep<Observation>;
  outcome(): { score: number; achieved: boolean };
}
