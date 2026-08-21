import { WithExecutorAndAbortSignal } from '../../../desktop/externalApi/executorTypes.js';
import {
  formatVerificationWarnings,
  VerificationFinding,
} from '../../../desktop/validation/readback-verify.js';
import { log } from '../../../logging/logger.js';
import { captureMainWindowImage } from './captureWindowScreenshot.js';
import { isSuspiciousErrorRed, scanPngForErrorRed } from './errorRedScan.js';

// The in-profile tool the model uses to look at the window when a visual finding fires. Named
// here so the finding message can tell the model exactly how to inspect the rendered pixels.
const CAPTURE_TOOL = 'capture-window-screenshot';

// One logger name for every branch so an operator who turns AUTO_VISUAL_CHECK on can confirm the
// check fired (and see what it measured) with a single `logger:"visualCheck"` filter. The check is
// otherwise silent — a clean scan appends nothing — so absence of a finding is not evidence it ran.
const VISUAL_CHECK_LOGGER = 'visualCheck';

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
  try {
    const captured = await captureMainWindowImage({ executor, signal });
    if (captured.isErr()) {
      // Expected/transient (Desktop busy, no readable PNG): debug, not warning — this is a
      // best-effort scan, not a failure of the apply it rides on.
      log({
        level: 'debug',
        message: 'Visual error check skipped — window capture unavailable',
        logger: VISUAL_CHECK_LOGGER,
        data: { error: captured.error },
      });
      return null;
    }

    const scan = scanPngForErrorRed(captured.value.bytes);
    if (!scan) {
      log({
        level: 'debug',
        message: 'Visual error check skipped — capture not decodable as PNG',
        logger: VISUAL_CHECK_LOGGER,
      });
      return null;
    }

    const suspicious = isSuspiciousErrorRed(scan);
    const pct = Math.round(scan.maxCellRedFraction * 100);
    // Positive confirmation the scan ran, with the numbers behind the verdict. Info so it is
    // visible at default verbosity once the flag is on; a suspicious hit is escalated below.
    log({
      level: suspicious ? 'warning' : 'info',
      message: suspicious
        ? 'Visual error check flagged a dense error red cluster'
        : 'Visual error check ran — no suspicious error red cluster',
      logger: VISUAL_CHECK_LOGGER,
      data: {
        suspicious,
        maxCellRedFraction: scan.maxCellRedFraction,
        redFraction: scan.redFraction,
        redPixels: scan.redPixels,
        width: scan.width,
        height: scan.height,
      },
    });
    if (!suspicious) {
      return null;
    }

    return {
      severity: 'warning',
      source: 'visual',
      message:
        `the densest region of the applied window is ${pct}% saturated red, which usually ` +
        `means a red error pill or broken element — capture the window with ${CAPTURE_TOOL} ` +
        'and inspect the shelves before reporting Done',
    };
  } catch (error) {
    // Best-effort by contract: an unexpected capture/scan failure yields no finding rather than
    // failing the apply this rides on. The caller treats null as "nothing to report".
    log({
      level: 'warning',
      message: 'Visual error check errored — treated as no finding',
      logger: VISUAL_CHECK_LOGGER,
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

/**
 * The text-channel form of the visual check, for apply paths that carry no structured
 * VerificationReport to fold into (dashboard, workbook). Runs the check only when `enabled`
 * (the AUTO_VISUAL_CHECK gate) and renders a hit as the SAME agent-facing warning text the
 * worksheet text-mode apply uses via formatVerificationWarnings. Returns '' when the flag is
 * off or nothing was found, so a caller can unconditionally append it to its message.
 */
export async function runVisualErrorCheckText({
  executor,
  signal,
  enabled,
}: WithExecutorAndAbortSignal & { enabled: boolean }): Promise<string> {
  if (!enabled) {
    return '';
  }
  const finding = await runVisualErrorCheck({ executor, signal });
  return finding ? formatVerificationWarnings([finding]) : '';
}
