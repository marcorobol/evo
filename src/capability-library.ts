import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CapabilityProposal, CodeCapability } from "./capability-contract.js";
import type { CapabilityValidation } from "./capability-validator.js";
import type { BeliefState } from "./domain.js";

export type LibraryCapability =
  | { representation: "plan"; capability: CapabilityProposal }
  | { representation: "code"; capability: CodeCapability };

export type LibraryEntry = LibraryCapability & {
  id: string;
  createdAt: string;
  uses: number;
  validation: Pick<CapabilityValidation, "fitness" | "rewardDelta" | "successfulActions" | "failedActions">;
};

export class CapabilityLibrary {
  constructor(private readonly path = "capabilities/library.json") {}

  async list(): Promise<LibraryEntry[]> {
    try {
      const document = JSON.parse(await readFile(this.path, "utf8")) as { entries?: LibraryEntry[] };
      return document.entries ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async add(candidate: LibraryCapability, validation: CapabilityValidation): Promise<LibraryEntry> {
    if (!validation.accepted) throw new Error("Only validated capabilities can enter the library.");
    const entries = await this.list();
    const duplicate = entries.find((entry) => entry.representation === candidate.representation && entry.capability.name === candidate.capability.name);
    if (duplicate) return duplicate;
    const entry: LibraryEntry = {
      id: `${candidate.representation}-${candidate.capability.name}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      uses: 0,
      ...candidate,
      validation: pickValidation(validation),
    };
    entries.push(entry);
    await this.write(entries);
    return entry;
  }

  async bestFor(goal: string, beliefs?: BeliefState): Promise<LibraryEntry | undefined> {
    const goalWords = words(goal);
    const candidates = (await this.list()).filter((entry) => entry.validation.rewardDelta > 0 && (!beliefs || isApplicable(entry, beliefs)));
    const ranked = candidates
      .map((entry) => ({ entry, score: overlap(goalWords, words(`${entry.capability.goal} ${entry.capability.applicability}`)) + entry.validation.fitness / 1_000 }))
      .sort((left, right) => right.score - left.score);
    return ranked[0]?.entry;
  }

  async recordUse(id: string): Promise<void> {
    const entries = await this.list();
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown capability '${id}'.`);
    entry.uses += 1;
    await this.write(entries);
  }

  private async write(entries: LibraryEntry[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, "utf8");
  }
}

function isApplicable(entry: LibraryEntry, beliefs: BeliefState): boolean {
  const preconditions = entry.capability.preconditions ?? inferLegacyPreconditions(entry.capability);
  return (!preconditions.requiresKey || (beliefs.keys?.length ?? 0) > 0)
    && (!preconditions.requiresDoor || (beliefs.doors?.length ?? 0) > 0)
    && (!preconditions.requiresBattery || (beliefs.batteries?.length ?? 0) > 0)
    && beliefs.parcels.size >= preconditions.minimumParcels;
}

function inferLegacyPreconditions(capability: Pick<CapabilityProposal | CodeCapability, "goal" | "applicability">) {
  const text = `${capability.goal} ${capability.applicability}`.toLowerCase();
  return {
    requiresKey: text.includes("key"),
    requiresDoor: text.includes("door"),
    requiresBattery: text.includes("battery"),
    minimumParcels: text.includes("parcel") ? 1 : 0,
  };
}

function pickValidation(validation: CapabilityValidation): LibraryEntry["validation"] {
  const { fitness, rewardDelta, successfulActions, failedActions } = validation;
  return { fitness, rewardDelta, successfulActions, failedActions };
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []);
}

function overlap(left: Set<string>, right: Set<string>): number {
  return [...left].filter((word) => right.has(word)).length;
}
