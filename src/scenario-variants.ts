import type { TurnBasedScenario } from "./turn-based-environment.js";

/** Deterministic family of energy-constrained delivery tasks for evolution. */
export function batteryReturnVariant(seed: number): TurnBasedScenario {
  const random = mulberry32(seed);
  const batteryDistance = 1 + Math.floor(random() * 3);
  const parcelDistance = 1 + Math.floor(random() * 3);
  const mirrored = random() >= 0.5;
  const width = batteryDistance + parcelDistance;
  const toWorldX = (offset: number) => mirrored ? width - offset : offset;
  // Without recharging the complete route costs two extra batteryDistance
  // moves; after recharge the available energy is exactly sufficient.
  const initialEnergy = 2 * parcelDistance + batteryDistance + 2;
  return {
    agent: { id: "agent", name: "evolution-agent", x: toWorldX(0), y: 0, score: 0 },
    tiles: Array.from({ length: width + 1 }, (_, offset) => ({ x: toWorldX(offset), y: 0, type: offset === 0 ? "2" : "3" })),
    batteries: [{ x: toWorldX(batteryDistance), y: 0 }],
    parcels: [{ id: "parcel-1", x: toWorldX(width), y: 0, reward: 10 }],
    initialEnergy,
    energyCost: 1,
  };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}
