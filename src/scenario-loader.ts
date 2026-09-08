import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { TurnBasedScenario } from "./turn-based-environment.js";

const positionSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

export const scenarioSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    score: z.number().finite().default(0),
  }),
  tiles: z.array(positionSchema.extend({ type: z.enum(["0", "1", "2", "3", "4", "5"]) })).min(1),
  parcels: z.array(positionSchema.extend({ id: z.string().min(1), reward: z.number().finite().positive() })).default([]),
  batteries: z.array(positionSchema).default([]),
  keys: z.array(positionSchema).default([]),
  doors: z.array(positionSchema).default([]),
  initialEnergy: z.number().positive().optional(),
  energyCost: z.number().positive().optional(),
});

export type ScenarioDocument = z.infer<typeof scenarioSchema>;

export async function loadScenario(path: string): Promise<{ metadata: Pick<ScenarioDocument, "version" | "name" | "description">; scenario: TurnBasedScenario }> {
  return parseScenario(await readFile(path, "utf8"));
}

export function parseScenario(input: string): { metadata: Pick<ScenarioDocument, "version" | "name" | "description">; scenario: TurnBasedScenario } {
  const document = scenarioSchema.parse(JSON.parse(input));
  const scenario: TurnBasedScenario = {
    agent: document.agent,
    tiles: document.tiles,
    parcels: document.parcels,
    batteries: document.batteries,
    keys: document.keys,
    doors: document.doors,
    ...(document.initialEnergy === undefined ? {} : { initialEnergy: document.initialEnergy }),
    ...(document.energyCost === undefined ? {} : { energyCost: document.energyCost }),
  };
  return {
    metadata: { version: document.version, name: document.name, description: document.description },
    scenario,
  };
}
