import type { BeliefState, PrimitiveAction } from "../domain.js";

/** A capability artifact discovered and named by an evolving coding agent. */
export interface AgentCapability {
  readonly id: string;
  readonly version: number;
  readonly purpose: string;
}

export interface ModuleDecision {
  action: PrimitiveAction;
  confidence: number;
  rationale: string;
  module: string;
}

export interface AgentMemory {
  record(state: BeliefState, decision: ModuleDecision): void;
  recordOutcome(accepted: boolean): void;
  visits(x: number, y: number): number;
  snapshot(): ReadonlyArray<{ x: number; y: number; action: PrimitiveAction; module: string; accepted?: boolean }>;
}

export interface EvolvableAgent {
  readonly capabilities: ReadonlyArray<AgentCapability>;
  reset(): void;
  nextAction(state: BeliefState): ModuleDecision;
  recordOutcome(accepted: boolean): void;
  memory(): AgentMemory;
  capabilityStats(): ReadonlyArray<{ id: string; invocations: number; decisions: number }>;
}

/** Read-only serializable input supplied to generated policy code. */
export interface PolicyContext {
  observation: {
    width?: number;
    height?: number;
    me?: { id: string; x: number; y: number; score: number };
    tiles: ReadonlyArray<{ x: number; y: number; type: string }>;
    parcels: ReadonlyArray<{ id: string; x: number; y: number; reward: number; carriedBy?: string }>;
    keys: ReadonlyArray<{ x: number; y: number }>;
    doors: ReadonlyArray<{ x: number; y: number }>;
    batteries: ReadonlyArray<{ x: number; y: number }>;
    energy?: number;
  };
  baseline: ModuleDecision;
  memory: ReadonlyArray<{ x: number; y: number; action: PrimitiveAction; module: string; accepted?: boolean }>;
}

/** A generated extension may override one decision, or defer to the baseline. */
export type PolicyExtension = (context: Readonly<PolicyContext>) => ModuleDecision | undefined;

export interface BenchmarkEpisode {
  name: string;
  achieved: boolean;
  score: number;
  steps: number;
  acceptedActions: number;
  blockedActions: number;
  blockedReasons: string[];
  waits: number;
  decisions: ModuleDecision[];
  capabilityActivations?: ReadonlyArray<{ id: string; invocations: number; decisions: number }>;
}

export interface Bottleneck {
  id: string;
  severity: "info" | "warning" | "critical";
  evidence: string;
}
