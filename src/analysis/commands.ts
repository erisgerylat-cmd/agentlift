import type { ImpactReport } from "../types.js";
import { analyzeReport } from "./report.js";

export interface GatePolicy {
  minSuccessDeltaPp?: number;
  maxCostIncreasePct?: number;
  maxToolErrorRate?: number;
  maxRegressions?: number;
  minActivationRate?: number;
  maxFalseActivationRate?: number;
}

export function evaluateGate(report: ImpactReport, policy: GatePolicy) {
  const analysis = analyzeReport(report);
  const failures: string[] = [], unavailable: string[] = [];
  if (!analysis.summary.validPairs) unavailable.push("No valid pairs");
  if (analysis.summary.infrastructureFailures) failures.push("Infrastructure failures present");
  if (report.environment?.observations.modelDrift === "detected") failures.push("Model drift detected");
  const checks: [string, number | null, number | undefined, "min" | "max"][] = [
    ["success_delta_pp", analysis.summary.successRateDeltaPp, policy.minSuccessDeltaPp, "min"],
    ["cost_increase_pct", analysis.metrics.costUSD.relativePct, policy.maxCostIncreasePct, "max"],
    ["tool_error_rate", analysis.metrics.candidateToolErrorRate, policy.maxToolErrorRate, "max"],
    ["regressions", analysis.pairs.filter(p => p.classification === "regressed").length, policy.maxRegressions, "max"],
    ["activation_rate", analysis.extension.activationRate, policy.minActivationRate, "min"],
    ["false_activation_rate", analysis.extension.falseActivationRate, policy.maxFalseActivationRate, "max"],
  ];
  for (const [name, value, threshold, direction] of checks) {
    if (threshold === undefined) continue;
    if (value === null) unavailable.push(`${name}: unavailable`);
    else if (direction === "min" ? value < threshold : value > threshold) {
      failures.push(`${name}: ${value} violates ${direction} ${threshold}`);
    }
  }
  return {
    status: unavailable.length ? "UNAVAILABLE" : failures.length ? "FAIL" : "PASS",
    exitCode: unavailable.length ? 2 : failures.length ? 1 : 0,
    failures, unavailable, policy,
    note: "CI thresholds test observed metrics, not statistical enablement confidence.",
  };
}

export function compareReports(before: ImpactReport, after: ImpactReport) {
  if (!before.environment?.comparisonKey || !after.environment?.comparisonKey) {
    throw new Error("Comparison requires environment locks from both experiments");
  }
  if (before.environment.comparisonKey !== after.environment.comparisonKey) {
    throw new Error("Experiments are incomparable: task suite, fixture, Agent, model or platform differ");
  }
  const a = analyzeReport(before), b = analyzeReport(after);
  const subtract = (x: number | null, y: number | null) => x === null || y === null ? null : Number((y - x).toFixed(4));
  const oldCases = new Map(a.pairs.map(p => [JSON.stringify([p.caseId, p.repeat]), p]));
  return {
    before: before.experimentId, after: after.experimentId,
    candidateSuccessChangePp: subtract(a.statistics.candidateRatePct, b.statistics.candidateRatePct),
    liftChangePp: subtract(a.summary.successRateDeltaPp, b.summary.successRateDeltaPp),
    latencyMedianChangeMs: subtract(a.metrics.latencyMs.candidate, b.metrics.latencyMs.candidate),
    beforeDecision: a.decision, afterDecision: b.decision,
    cases: b.pairs.map(p => ({ caseId: p.caseId, repeat: p.repeat,
      before: oldCases.get(JSON.stringify([p.caseId, p.repeat]))?.classification ?? "unavailable",
      after: p.classification })),
    warnings: [
      ...(a.summary.excludedPairs.length || b.summary.excludedPairs.length ? ["Exclusions differ; inspect missing cases."] : []),
      ...(before.environment.repeats !== after.environment.repeats ? ["Repeat counts differ."] : []),
      "Historical comparisons are descriptive; external cache and provider state may differ.",
    ],
  };
}
