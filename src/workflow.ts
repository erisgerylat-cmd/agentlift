import { writeFile } from "node:fs/promises";
import path from "node:path";
import { doctor } from "./doctor.js";
import { runImpact } from "./impact.js";
import { loadReport } from "./evidence/bundle.js";
import { analyzeReport } from "./analysis/report.js";
import { compareReports, evaluateGate, type GatePolicy } from "./analysis/commands.js";

export async function runWorkflow(config: string, options: {
  before?: string; policy?: GatePolicy; signal?: AbortSignal;
} = {}) {
  const diagnostics = await doctor(config);
  if (!diagnostics.ok) return { diagnostics, status: "PREFLIGHT_FAILED", exitCode: 2,
    evidenceDir: undefined, analysis: undefined, comparison: null };
  // Validate historical evidence before any billed calls.
  const before = options.before ? await loadReport(options.before) : null;
  const report = await runImpact(config, { signal: options.signal });
  const rebuilt = await loadReport(report.evidenceDir!);
  const gate = evaluateGate(rebuilt, options.policy ?? { minSuccessDeltaPp: 0 });
  let comparison = null;
  let comparisonError: string | null = null;
  if (before) {
    try { comparison = compareReports(before, rebuilt); }
    catch (error) { comparisonError = error instanceof Error ? error.message : "Comparison failed"; }
  }
  const result = { diagnostics, experimentId: report.experimentId, evidenceDir: report.evidenceDir,
    analysis: analyzeReport(rebuilt), gate, comparison, comparisonError,
    status: comparisonError ? "COMPARISON_UNAVAILABLE" : gate.status,
    exitCode: comparisonError ? 2 : gate.exitCode };
  // Supplemental workflow file does not alter the checksummed experiment evidence.
  await writeFile(path.join(report.evidenceDir!, "workflow.json"), JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600, flag: "wx" });
  return result;
}
