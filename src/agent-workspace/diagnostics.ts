import type { BenchmarkEpisode, Bottleneck } from "./contracts.js";

/** Deterministic evidence-to-requirement bridge; no model judgement is hidden here. */
export function diagnose(episode: BenchmarkEpisode): Bottleneck[] {
  const findings: Bottleneck[] = [];
  const reason = episode.blockedReasons.join(" ").toLowerCase();
  const partialObservation = episode.name.startsWith("partial-observation-");
  if (reason.includes("key is required")) findings.push({
    id: "access-prerequisite", severity: "critical",
    evidence: `A locked transition blocked ${episode.blockedActions} action(s) in '${episode.name}'.`,
  });
  else if (reason.includes("no remaining energy")) findings.push({
    id: "resource-budget", severity: "critical",
    evidence: `Energy exhaustion blocked ${episode.blockedActions} action(s) in '${episode.name}'.`,
  });
  else if (partialObservation && !episode.achieved && (episode.blockedActions > 0 || episode.waits > 0)) findings.push({
    id: "unseen-state", severity: "critical",
    evidence: `Local-view exploration failed in '${episode.name}' after ${episode.steps} action(s), with ${episode.blockedActions} blocked action(s) and ${episode.waits} wait(s).`,
  });
  else if (episode.blockedActions > 0 && !episode.achieved) findings.push({
    id: "transition-model", severity: "warning",
    evidence: `${episode.blockedActions} action(s) were rejected in '${episode.name}'.`,
  });
  if (episode.waits >= 2 && !episode.achieved) findings.push({
    id: "unseen-state", severity: "critical",
    evidence: `${episode.waits} waits ended '${episode.name}' without a positive score.`,
  });
  if (!episode.achieved && episode.blockedActions === 0 && episode.waits < 2) findings.push({
    id: "task-model", severity: "warning",
    evidence: `The episode ended without reward after ${episode.steps} actions.`,
  });
  return findings;
}
