import type { ImpactReport, RunResult } from "../types.js";

export function analyzeExtension(report: ImpactReport, runs: RunResult[]) {
  const skill = report.environment?.skill?.name;
  const used = (run: RunResult) => run.events.some(event =>
    skill ? event.type === "skill.activation" && event.name === skill :
      event.type === "tool.call" && typeof event.name === "string" && (
        event.name.startsWith("mcp__") || typeof event.server === "string"));
  const candidate = runs.filter(run => run.condition === "candidate");
  const expected = candidate.filter(run => run.extensionExpected === true);
  const controls = candidate.filter(run => run.extensionExpected === false);
  const activated = expected.filter(used).length;
  const unexpected = controls.filter(used).length;
  return {
    candidateRuns: candidate.length,
    observedRuns: candidate.filter(used).length,
    expectedRuns: expected.length,
    activatedExpectedRuns: activated,
    activationRate: expected.length ? activated / expected.length : null,
    controlRuns: controls.length,
    unexpectedControlRuns: unexpected,
    falseActivationRate: controls.length ? unexpected / controls.length : null,
    perCase: candidate.map(run => ({
      caseId: run.caseId, repeat: run.repeat, expected: run.extensionExpected ?? null,
      observed: used(run),
    })),
    scope: "Observed extension tool use in valid pairs; invocation does not prove instruction compliance.",
  };
}
