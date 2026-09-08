import { fileURLToPath } from "node:url";
import type { CapabilityProposal } from "./capability-contract.js";
import { validateCapability } from "./capability-validator.js";
import { loadScenario } from "./scenario-loader.js";
import { TurnBasedEnvironment } from "./turn-based-environment.js";

const scenarioPath = fileURLToPath(new URL("../scenarios/key-door-delivery.v1.json", import.meta.url));
const { metadata, scenario } = await loadScenario(scenarioPath);
const environment = new TurnBasedEnvironment(scenario);

const plan: CapabilityProposal = {
  name: "key-door-delivery",
  goal: "Acquire the key, cross the door, collect the parcel, and deliver it.",
  applicability: "The key, door, parcel, and delivery tile are all known.",
  plan: [
    { kind: "pickup" },
    { kind: "move", direction: "right" },
    { kind: "pickup" },
    { kind: "move", direction: "right" },
    { kind: "putdown" },
  ],
  rationale: "The key is on the initial tile and the parcel is behind the door.",
};

const validation = validateCapability(environment, plan);
console.log(JSON.stringify({ scenario: metadata, plan: plan.name, validation }, null, 2));
