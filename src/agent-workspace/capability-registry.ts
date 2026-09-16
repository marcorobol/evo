import type { AgentCapability, ModuleDecision, PolicyContext, PolicyExtension } from "./contracts.js";

/** The only executable integration point exposed by the neutral substrate. */
export interface DecisionCapability {
  descriptor: AgentCapability;
  priority: number;
  decide(context: Readonly<PolicyContext>): ModuleDecision | undefined;
}

export interface CapabilityActivation {
  id: string;
  invocations: number;
  decisions: number;
}

/** Ordered, measurable registry: capabilities cannot become dead files. */
export class CapabilityRegistry {
  private readonly entries: DecisionCapability[];
  private readonly activation = new Map<string, CapabilityActivation>();

  constructor(capabilities: readonly DecisionCapability[]) {
    this.entries = [...capabilities].sort((a, b) => b.priority - a.priority || a.descriptor.id.localeCompare(b.descriptor.id));
    for (const entry of this.entries) this.activation.set(entry.descriptor.id, { id: entry.descriptor.id, invocations: 0, decisions: 0 });
  }

  descriptors(): AgentCapability[] { return this.entries.map((entry) => entry.descriptor); }
  reset(): void { for (const item of this.activation.values()) { item.invocations = 0; item.decisions = 0; } }
  stats(): CapabilityActivation[] { return [...this.activation.values()].map((item) => ({ ...item })); }

  decide(context: Readonly<PolicyContext>): ModuleDecision | undefined {
    for (const entry of this.entries) {
      const stat = this.activation.get(entry.descriptor.id);
      if (stat) stat.invocations += 1;
      const decision = entry.decide(context);
      if (decision) { if (stat) stat.decisions += 1; return decision; }
    }
    return undefined;
  }
}

/** Compatibility adapter for the original pure policy-extension boundary. */
export function policyCapability(id: string, extension: PolicyExtension, priority = 0): DecisionCapability {
  return { descriptor: { id, version: 1, purpose: "Discovered decision capability." }, priority, decide: extension };
}
