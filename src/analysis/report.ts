import { summarizeImpact } from "./summary.js";
import type { ImpactReport, RunEvent, RunResult } from "../types.js";

const round = (value: number) => Number(value.toFixed(4));
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle]! + sorted[Math.ceil(sorted.length / 2) - 1]!) / 2;
}

export function wilson(successes: number, n: number): [number, number] | null {
  if (!n) return null;
  const z2 = 1.96 ** 2, p = successes / n;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margin = 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return [Math.max(0, center - margin), Math.min(1, center + margin)].map(x => round(x * 100)) as [number, number];
}

// Resample whole cases, keeping repeated observations together.
function bootstrap(cases: { sum: number; count: number }[], seed: number): [number, number] | null {
  if (!cases.length) return null;
  let state = seed >>> 0;
  const samples: number[] = [];
  for (let sample = 0; sample < 2000; sample += 1) {
    let sum = 0, count = 0;
    for (let i = 0; i < cases.length; i += 1) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      const item = cases[Math.floor(state / 4294967296 * cases.length)]!;
      sum += item.sum; count += item.count;
    }
    samples.push(sum / count * 100);
  }
  samples.sort((a, b) => a - b);
  return [round(samples[49]!), round(samples[1949]!)];
}

// Two-sided sign test across independent case-level effects, not repeated runs.
function signTest(positive: number, negative: number): number {
  const n = positive + negative, k = Math.min(positive, negative);
  if (!n) return 1;
  let logTerm = -n * Math.LN2, sum = Math.exp(logTerm);
  for (let i = 1; i <= k; i += 1) {
    logTerm += Math.log(n - i + 1) - Math.log(i);
    sum += Math.exp(logTerm);
  }
  return Math.min(1, 2 * sum);
}

function tokenCount(run: RunResult, field: string): number | null {
  const events = run.events.filter(e => e.type === "model.usage");
  if (!events.length || events.some(e => typeof e[field] !== "number" ||
      !Number.isFinite(e[field]) || (e[field] as number) < 0)) return null;
  return events.reduce((sum, event) => sum + (event[field] as number), 0);
}

function eventKey(event: RunEvent) {
  return JSON.stringify([event.type, event.server, event.name, event.arguments, event.result, event.status]);
}

function traceDiff(baseline: RunResult, candidate: RunResult) {
  const events = (run: RunResult) => run.events.filter(e => ["tool.call", "tool.result"].includes(e.type));
  const a = events(baseline), b = events(candidate);
  let first = 0;
  while (first < Math.max(a.length, b.length) && a[first] && b[first] &&
         eventKey(a[first]!) === eventKey(b[first]!)) first += 1;
  return {
    baselineSequence: a.filter(e => e.type === "tool.call").map(e => e.name),
    candidateSequence: b.filter(e => e.type === "tool.call").map(e => e.name),
    firstObservableDivergence: first === Math.max(a.length, b.length) ? null : {
      index: first, baseline: a[first] ?? null, candidate: b[first] ?? null,
    },
  };
}

export function analyzeReport(report: ImpactReport) {
  const summary = summarizeImpact(report.runs);
  const invalid = new Set(summary.excludedPairs.map(p => JSON.stringify([p.caseId, p.repeat])));
  const valid = report.runs.filter(r => !invalid.has(JSON.stringify([r.caseId, r.repeat])));
  const pairs = valid.filter(r => r.condition === "baseline").map(baseline => ({
    baseline,
    candidate: valid.find(r => r.caseId === baseline.caseId && r.repeat === baseline.repeat &&
      r.condition === "candidate")!,
  }));
  const caseStats = new Map<string, { sum: number; count: number }>();
  for (const { baseline, candidate } of pairs) {
    const item = caseStats.get(baseline.caseId) ?? { sum: 0, count: 0 };
    item.sum += Number(candidate.success) - Number(baseline.success);
    item.count += 1; caseStats.set(baseline.caseId, item);
  }
  const interval = bootstrap([...caseStats.values()], report.environment?.seed ?? 42);
  const pValue = signTest(
    [...caseStats.values()].filter(c => c.sum > 0).length,
    [...caseStats.values()].filter(c => c.sum < 0).length,
  );
  const baselineRate = summary.validPairs ? summary.baselineSuccesses / summary.validPairs : null;
  const candidateRate = summary.validPairs ? summary.candidateSuccesses / summary.validPairs : null;
  const model = report.environment?.model;
  const cost = (run: RunResult) => {
    const input = tokenCount(run, "inputTokens"), output = tokenCount(run, "outputTokens");
    if (input === null || output === null || model?.inputPricePerMillion === undefined ||
        model.outputPricePerMillion === undefined) return null;
    return (input * model.inputPricePerMillion + output * model.outputPricePerMillion) / 1e6;
  };
  const metric = (get: (run: RunResult) => number | null) => {
    const values = pairs.map(p => [get(p.baseline), get(p.candidate)] as const);
    if (!values.length || values.some(v => v[0] === null || v[1] === null)) {
      return { baseline: null, candidate: null, delta: null, relativePct: null };
    }
    const baseline = median(values.map(v => v[0]!))!;
    const candidate = median(values.map(v => v[1]!))!;
    return { baseline, candidate, delta: median(values.map(v => v[1]! - v[0]!)),
      relativePct: baseline === 0 ? null : round((candidate - baseline) / baseline * 100) };
  };
  const costs = metric(cost);
  let decision: "ENABLE" | "DO_NOT_ENABLE" | "INCONCLUSIVE" = "INCONCLUSIVE";
  const reasons: string[] = [];
  const enough = caseStats.size >= 10 && summary.validPairs >= 20;
  if (!enough) reasons.push("At least 10 distinct cases and 20 valid pairs are required for a recommendation.");
  if (summary.infrastructureFailures) reasons.push("Infrastructure failures excluded; inspect excluded pairs.");
  if (report.environment?.observations.modelDrift === "detected") reasons.push("Multiple resolved model identities observed.");
  if (!interval || interval[0] <= 0 && interval[1] >= 0) reasons.push("The effect interval includes zero.");
  if (costs.relativePct === null) reasons.push("Comparable cost estimates unavailable; configure per-million token prices.");
  if (enough && !summary.infrastructureFailures && report.environment?.observations.modelDrift !== "detected" && interval) {
    if (interval[1] < 0 && pValue < 0.05) {
      decision = "DO_NOT_ENABLE"; reasons.push("Quality decreased across cases.");
    } else if (interval[0] > (report.policy?.minimumQualityLiftPp ?? 0) && pValue < 0.05 &&
               costs.relativePct !== null &&
               costs.relativePct <= (report.policy?.maximumCostIncreasePct ?? 20)) {
      decision = "ENABLE"; reasons.push("Quality improvement and declared cost budget are supported for this suite.");
    }
  }
  const candidateRuns = report.runs.filter(r => r.condition === "candidate");
  const calls = candidateRuns.flatMap(r => r.events).filter(e => e.type === "tool.call");
  const ok = candidateRuns.flatMap(r => r.events).filter(e => e.type === "tool.result" && e.status === "ok").length;
  summary.decision = decision;
  return {
    summary,
    decision, reasons, distinctCases: caseStats.size,
    statistics: {
      baselineRatePct: baselineRate === null ? null : round(baselineRate * 100),
      candidateRatePct: candidateRate === null ? null : round(candidateRate * 100),
      relativeSuccessChangePct: !baselineRate || candidateRate === null ? null : round((candidateRate / baselineRate - 1) * 100),
      baselineWilson95: wilson(summary.baselineSuccesses, summary.validPairs),
      candidateWilson95: wilson(summary.candidateSuccesses, summary.validPairs),
      lift95Pp: interval, caseSignTestP: pValue,
      method: "2000 case-cluster bootstrap samples; Wilson rates are descriptive with repeated cases",
    },
    metrics: {
      latencyMs: metric(run => run.durationMs),
      tokens: metric(run => tokenCount(run, "totalTokens")),
      costUSD: costs,
      candidateToolErrorRate: calls.length ? Math.max(0, calls.length - ok) / calls.length : null,
    },
    pairs: pairs.map(({ baseline, candidate }) => ({
      caseId: baseline.caseId, repeat: baseline.repeat,
      classification: baseline.success
        ? candidate.success ? "unchanged-success" : "regressed"
        : candidate.success ? "improved" : "unchanged-failure",
      ...traceDiff(baseline, candidate),
    })),
  };
}

const show = (value: number | null) => value === null ? "unavailable" : String(round(value));
export function renderReport(report: ImpactReport, markdown = false): string {
  const analysis = analyzeReport(report), { summary, statistics, metrics } = analysis;
  const lines = [
    markdown ? "# AgentLift impact report" : "AgentLift impact report",
    `Experiment: ${report.experimentId}`,
    `Decision: ${analysis.decision}`,
    `Pairs: ${summary.totalPairs}; valid: ${summary.validPairs}; excluded: ${summary.excludedPairs.length}`,
    `Baseline: ${summary.baselineSuccesses}/${summary.validPairs} successful`,
    `Candidate: ${summary.candidateSuccesses}/${summary.validPairs} successful`,
    `Observed delta: ${show(summary.successRateDeltaPp)}pp`,
    `95% lift interval: ${statistics.lift95Pp ? statistics.lift95Pp.join(" to ") + "pp" : "unavailable"}`,
    `Relative success change: ${show(statistics.relativeSuccessChangePct)}%`,
    `Distinct cases: ${analysis.distinctCases}; case sign-test p: ${show(statistics.caseSignTestP)}`,
    `Median latency: ${show(metrics.latencyMs.baseline)} → ${show(metrics.latencyMs.candidate)} ms`,
    `Median tokens: ${show(metrics.tokens.baseline)} → ${show(metrics.tokens.candidate)}`,
    `Estimated cost change: ${show(metrics.costUSD.relativePct)}%`,
    `Candidate tool error rate: ${show(metrics.candidateToolErrorRate)}`,
    `Infrastructure failures: ${summary.infrastructureFailures}`,
    ...analysis.reasons.map(reason => `- ${reason}`),
    "",
    "Case outcomes",
    ...analysis.pairs.map(p => `- ${p.caseId} #${p.repeat}: ${p.classification}; first tool divergence: ${
      p.firstObservableDivergence?.index ?? "none"}`),
    ...summary.excludedPairs.map(p => `- ${p.caseId} #${p.repeat}: excluded (${p.reasons.map(r => r.failure.code).join(", ")})`),
    "",
    "Scope: this task suite and recorded environment only. Small-sample intervals are descriptive.",
  ];
  return lines.join(markdown ? "\n\n" : "\n") + "\n";
}
