import { WithExecutorAndAbortSignal } from '../../../desktop/externalApi/executorTypes.js';
import { VerificationFinding } from '../../../desktop/validation/readback-verify.js';
import { captureMainWindowImage } from './captureWindowScreenshot.js';
import { isSuspiciousErrorRed, scanPngForErrorRed } from './errorRedScan.js';

// The in-profile tool the model uses to look at the window when a visual finding fires. Named
// here so the finding message can tell the model exactly how to inspect the rendered pixels.
const CAPTURE_TOOL = 'capture-window-screenshot';

/**
 * Post-apply VISUAL verifier — the pluggable counterpart to readback. It captures the Desktop
 * window and scans for a dense error-red cluster (a likely error pill or broken render), which
 * XML readback cannot see. On a hit it returns a source-agnostic VerificationFinding that points
 * the model at capture-window-screenshot to look closer; because an error pill persists until the
 * underlying problem is fixed, a live re-capture shows the same state, so the finding carries no
 * pinned evidence handle yet (the VerificationFinding.evidence field is left for a future
 * refinement that pins the exact apply-time pixels).
 *
 * It is deliberately non-fatal and best-effort: a capture that is unavailable (Desktop busy,
 * no readable PNG) or undecodable yields NO finding rather than failing the apply, and a hit is
 * a `warning` (red is overloaded in Tableau, so density triage nudges rather than verdicts).
 * Returns null when there is nothing to report.
 */
export async function runVisualErrorCheck({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<VerificationFinding | null> {
  const captured = await captureMainWindowImage({ executor, signal });
  if (captured.isErr()) {
    return null;
  }

  const scan = scanPngForErrorRed(captured.value.bytes);
  if (!scan || !isSuspiciousErrorRed(scan)) {
    return null;
  }

  const pct = Math.round(scan.maxCellRedFraction * 100);
  return {
    severity: 'warning',
    source: 'visual',
    message:
      `the densest region of the applied window is ${pct}% saturated red, which usually ` +
      `means a red error pill or broken element — capture the window with ${CAPTURE_TOOL} ` +
      'and inspect the shelves before reporting Done',
  };
}
