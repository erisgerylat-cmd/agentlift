import type { ExcludedPair, ImpactSummary, RunResult } from "../types.js";

function failureReasons(runs: RunResult[]): ExcludedPair["reasons"] {
  const reasons: ExcludedPair["reasons"] = [];
  for (const run of runs) {
    if (run.runtime.failure) {
      reasons.push({
        runId: run.runId,
        condition: run.condition,
        stage: "runtime",
        failure: run.runtime.failure,
      });
    }
    for (const [validatorIndex, validator] of run.validators.entries()) {
      if (!validator.failure) continue;
      reasons.push({
        runId: run.runId,
        condition: run.condition,
        stage: "validator",
        validatorIndex,
        failure: validator.failure,
      });
    }
  }
  return reasons;
}

export function summarizeImpact(runs: RunResult[]): ImpactSummary {
  const pairs = new Map<string, RunResult[]>();
  for (const run of runs) {
    const key = JSON.stringify([run.caseId, run.repeat]);
    const pair = pairs.get(key) ?? [];
    pair.push(run);
    pairs.set(key, pair);
  }

  const excludedPairs: ExcludedPair[] = [];
  let validPairs = 0;
  let baselineSuccesses = 0;
  let candidateSuccesses = 0;
  for (const pair of pairs.values()) {
    const baseline = pair.find(run => run.condition === "baseline");
    const candidate = pair.find(run => run.condition === "candidate");
    // Scheduler guarantees exactly one run per condition; never invent a pair.
    if (pair.length !== 2 || !baseline || !candidate) {
      throw new Error("Impact summary requires complete, unique baseline/candidate pairs");
    }
    const reasons = failureReasons(pair);
    if (reasons.length > 0) {
      excludedPairs.push({ caseId: baseline.caseId, repeat: baseline.repeat, reasons });
      continue;
    }
    validPairs += 1;
    baselineSuccesses += Number(baseline.success);
    candidateSuccesses += Number(candidate.success);
  }

  return {
    totalPairs: pairs.size,
    validPairs,
    excludedPairs,
    baselineSuccesses,
    candidateSuccesses,
    infrastructureFailures: runs.filter(run => run.outcome === "infrastructure_failure").length,
    successRateDeltaPp: validPairs === 0
      ? null
      : Number(((candidateSuccesses - baselineSuccesses) / validPairs * 100).toFixed(2)),
    decision: "INCONCLUSIVE",
  };
}
