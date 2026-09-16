import type { BeliefState, PrimitiveAction } from "../domain.js";
import type { AgentMemory, AgentCapability, ModuleDecision } from "./contracts.js";

/** Legacy implementation detail; not advertised as a predeclared capability. */
export const memoryModule: AgentCapability = {
  id: "memory",
  version: 1,
  purpose: "Keep an episode-local, inspectable trace of visited positions and decisions.",
};

export class HeatmapMemory implements AgentMemory {
  private readonly heatmap = new Map<string, number>();
  private readonly trace: Array<{ x: number; y: number; action: PrimitiveAction; module: string; accepted?: boolean }> = [];

  record(state: BeliefState, decision: ModuleDecision): void {
    const me = state.me;
    if (!me) return;
    const key = `${me.x},${me.y}`;
    this.heatmap.set(key, (this.heatmap.get(key) ?? 0) + 1);
    this.trace.push({ x: me.x, y: me.y, action: decision.action, module: decision.module });
  }

  recordOutcome(accepted: boolean): void {
    const last = this.trace.at(-1);
    if (last) last.accepted = accepted;
  }

  visits(x: number, y: number): number { return this.heatmap.get(`${x},${y}`) ?? 0; }
  snapshot() { return [...this.trace]; }
}
