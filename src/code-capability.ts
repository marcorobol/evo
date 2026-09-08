import { createContext, Script } from "node:vm";
import { actionPlanSchema, type CodeCapability } from "./capability-contract.js";
import type { BeliefState } from "./domain.js";

const forbidden = /\b(?:import|require|process|globalThis|Function|eval|constructor|__proto__|while|for|class|async|await|fetch)\b/;

/**
 * Runs a small, pure JavaScript strategy supplied by a capability.
 * This is an experimental containment layer, not a security boundary for
 * adversarial code: only generated code from a trusted local model is allowed.
 */
export function executeCodeCapability(capability: CodeCapability, beliefs: BeliefState) {
  if (forbidden.test(capability.source)) {
    throw new Error("Code capability contains a forbidden construct.");
  }

  const context = deepFreeze({
    me: beliefs.me,
    map: { width: beliefs.width, height: beliefs.height, tiles: [...beliefs.tiles.values()] },
    parcels: [...beliefs.parcels.values()],
    keys: beliefs.keys ?? [],
    doors: beliefs.doors ?? [],
    batteries: beliefs.batteries ?? [],
    energy: beliefs.energy,
  });
  const sandbox = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  sandbox.context = context;
  const result = new Script(`"use strict"; (${capability.source})(context)`, { filename: `${capability.name}.capability.js` })
    .runInContext(sandbox, { timeout: 50 });
  return actionPlanSchema.parse(result);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
