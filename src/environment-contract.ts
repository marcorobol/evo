/** A self-describing boundary between the evolving core and any environment. */
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
