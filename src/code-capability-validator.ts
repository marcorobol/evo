import type { CodeCapability, CapabilityProposal } from "./capability-contract.js";
import { executeCodeCapability } from "./code-capability.js";
import { validateCapability, type CapabilityValidation } from "./capability-validator.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

export interface CodeCapabilityValidation {
  generatedPlan: CapabilityProposal["plan"];
  validation: CapabilityValidation;
}

export function validateCodeCapability(environment: TurnBasedEnvironment, capability: CodeCapability): CodeCapabilityValidation {
  const generatedPlan = executeCodeCapability(capability, environment.observation());
  return {
    generatedPlan,
    validation: validateCapability(environment, { ...capability, plan: generatedPlan }),
  };
}
