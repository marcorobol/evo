import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GenericCapability, GenericValidation } from "./generic-capability.js";

export interface GenericLibraryEntry {
  id: string;
  createdAt: string;
  uses: number;
  capability: GenericCapability;
  validation: Pick<GenericValidation, "scoreDelta" | "successfulActions" | "failedActions">;
}

export class GenericCapabilityLibrary {
  constructor(private readonly path = "capabilities/generic-library.json") {}
  async list(): Promise<GenericLibraryEntry[]> {
    try { return (JSON.parse(await readFile(this.path, "utf8")) as { entries?: GenericLibraryEntry[] }).entries ?? []; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async add(capability: GenericCapability, validation: GenericValidation): Promise<GenericLibraryEntry> {
    if (!validation.accepted) throw new Error("Only successful generic capabilities can be stored.");
    const entries = await this.list();
    const existing = entries.find((entry) => entry.capability.name === capability.name);
    if (existing) return existing;
    const entry: GenericLibraryEntry = { id: `generic-${capability.name}-${Date.now()}`, createdAt: new Date().toISOString(), uses: 0, capability, validation: { scoreDelta: validation.scoreDelta, successfulActions: validation.successfulActions, failedActions: validation.failedActions } };
    entries.push(entry);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
    return entry;
  }
  async bestFor(goal: string): Promise<GenericLibraryEntry | undefined> {
    const goalWords = words(goal);
    return (await this.list())
      .filter((entry) => entry.validation.scoreDelta > 0)
      .sort((left, right) => score(right, goalWords) - score(left, goalWords))[0];
  }
  async recordUse(id: string): Promise<void> {
    const entries = await this.list();
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown generic capability '${id}'.`);
    entry.uses += 1;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  }
}

function words(value: string): Set<string> { return new Set(value.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []); }
function score(entry: GenericLibraryEntry, goal: Set<string>): number {
  return [...goal].filter((word) => words(`${entry.capability.goal} ${entry.capability.applicability}`).has(word)).length + entry.validation.scoreDelta / 1_000;
}
