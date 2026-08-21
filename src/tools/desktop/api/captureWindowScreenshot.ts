import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../../desktop/externalApi/executorTypes.js';
import {
  buildInlineImageCapFileMessage,
  inlineImageFootprintBytes,
  isOverInlineImageCap,
  logInlineImageCapHit,
} from '../../../desktop/limits/inlineImageCap.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { ErrorRedScan, isSuspiciousErrorRed, scanPngForErrorRed } from './errorRedScan.js';

// TakeAllScreenshots is a monolith UI-project debug command
// (codegen/ui/command-wrappers/debugging-ui-cmd.data). It captures every VISIBLE
// top-level widget — the whole Desktop window, INCLUDING the Columns/Rows shelves where
// an invalid field renders as a red "error pill" — writing one `ScreenShot_<n>.png` per
// widget into a freshly generated temp directory. This is the only capture that shows
// chrome (a viz-only render via /v0/.../image never does), so it is the one an agent
// uses to see whether a change left a visible warning.
//
// It reaches Desktop through the same POST /v0/app:invokeCommand path every other
// command uses. The External Client API namespaces commands as `tabui` / `tabdoc`;
// the debug commands live in the UI project and are dispatched under `tabui`.
const NAMESPACE = 'tabui';
// The wire name is the codegen-serialized (kebab-case) command id, not the C++
// `TakeAllScreenshotsCommand` class name. Verified against a live 2026.x build:
// `TakeAllScreenshots` serializes to `take-all-screenshots` under `tabui`.
const COMMAND = 'take-all-screenshots';

// RESULT SHAPE (verified against a live 2026.x build). The invokeCommand response
// `result` is a flat record of the command's out-params. TakeAllScreenshots's relevant
// out-param is `TempFilePath` — its impl calls `SetTempFilePath(outputPath)` where
// `outputPath` is the generated temp DIRECTORY, not a file. So the value is a single
// directory path (e.g. `/var/folders/.../T/tableau-temp/<id>`) containing the per-widget
// `ScreenShot_<n>.png` files; `chooseMainWindowImage` expands that directory and picks
// the main window. Key resolution stays tolerant of casing (and of a bare-file value,
// should a future build return one) and is isolated in `extractScreenshotPaths`.
const RESULT_PATH_KEYS = ['TempFilePath', 'tempFilePath', 'temp_file_path'] as const;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};
const title = 'Capture Tableau Window Screenshot';

export type CapturedImage = {
  /** Absolute path to the chosen PNG on disk. */
  path: string;
  /** The decoded PNG bytes. */
  bytes: Buffer;
};

/**
 * Pull the screenshot path(s) out of the command result record, tolerant of the two
 * plausible serializations (single string, or array of strings) and of key casing.
 * Returns [] when nothing path-shaped is present so the caller can report a clean error
 * rather than throwing on an unexpected shape.
 */
export function extractScreenshotPaths(result: Record<string, unknown> | undefined): string[] {
  if (!result) {
    return [];
  }
  for (const key of RESULT_PATH_KEYS) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) {
      return [value];
    }
    if (Array.isArray(value)) {
      const paths = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
      if (paths.length > 0) {
        return paths;
      }
    }
  }
  return [];
}

/**
 * Resolve the raw `TempFilePath` value(s) to the actual PNG files on disk. In practice
 * TakeAllScreenshots returns a single temp DIRECTORY holding one `ScreenShot_<n>.png` per
 * captured widget, so a directory entry is expanded to the `.png` files inside it; an
 * entry that is already a file is passed through (tolerating a future build that returns
 * file paths directly). Unreadable or vanished entries are skipped rather than fatal.
 */
export function resolveImageFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(path);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (name.toLowerCase().endsWith('.png')) {
          files.push(join(path, name));
        }
      }
    } else {
      files.push(path);
    }
  }
  return files;
}

/**
 * Choose the main-window capture from the set of per-widget PNGs. TakeAllScreenshots
 * writes one file per visible top-level widget (main window plus any floating dialogs);
 * the main window is reliably the largest file on disk, so pick by byte size. The input
 * paths may be directories (the common case — see `resolveImageFiles`) or files. A path
 * that cannot be stat'd is skipped rather than fatal. Returns null when none is readable.
 */
export function chooseMainWindowImage(paths: string[]): CapturedImage | null {
  let best: CapturedImage | null = null;
  let bestSize = -1;
  for (const path of resolveImageFiles(paths)) {
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (size > bestSize) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(path);
      } catch {
        continue;
      }
      best = { path, bytes };
      bestSize = size;
    }
  }
  return best;
}

/**
 * Run TakeAllScreenshots and return the main-window PNG, given an executor + signal already
 * in hand. Factored out of the tool callback so the post-apply visual check (runVisualErrorCheck)
 * can capture the window mid-apply without going through the read harness. Errors (Desktop
 * unavailable, no readable PNG) come back as an Err so a caller can degrade to "no capture"
 * rather than throwing.
 */
export async function captureMainWindowImage({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<CapturedImage, ExecuteCommandError>> {
  const commandResult = await executor.executeCommand({
    namespace: NAMESPACE,
    command: COMMAND,
    args: { HideMouse: true },
    signal,
  });
  if (commandResult.isErr()) {
    return Err(commandResult.error);
  }
  const paths = extractScreenshotPaths(commandResult.value.result);
  const image = chooseMainWindowImage(paths);
  if (!image) {
    return commandReturnedNoImage(paths.length);
  }
  return Ok(image);
}

export const captureWindowScreenshotTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const captureWindowScreenshot = new DesktopTool({
    server,
    name: 'capture-window-screenshot',
    title,
    description:
      'Capture a screenshot of the whole Tableau Desktop window, including the shelves ' +
      'and any warning or error indicators, and return it as an image. Use it after a ' +
      'change to verify the workbook is not visibly broken (e.g. a red error pill on a shelf).',
    paramsSchema,
    annotations: {
      // Capturing the window does not change the workbook. It does write temp PNG
      // files to Desktop's own temp dir, but that is not a user-facing destructive act.
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await captureWindowScreenshot.logAndExecute<CapturedImage>({
        extra,
        args: { session },
        callback: async () => {
          return await runExternalApiReadTool<CapturedImage>({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              return await read('window screenshot', async (executor, signal) =>
                captureMainWindowImage({ executor, signal }),
              );
            },
          });
        },
        getSuccessResult: (image) =>
          buildWindowScreenshotToolResult({ image, config: extra.config }),
      });
    },
  });

  return captureWindowScreenshot;
};

/**
 * The command reported success but produced no readable PNG. Surface it as a
 * command-execution error so the agent treats verification as unavailable rather than
 * concluding the window is clean. Reuses DesktopCommandExecutionError for a consistent
 * shape with every other desktop command failure.
 */
function commandReturnedNoImage(pathCount: number): Result<never, ExecuteCommandError> {
  return Err({
    type: 'command-failed',
    error: {
      code: 'no-screenshot-output',
      message:
        pathCount === 0
          ? `${NAMESPACE}:${COMMAND} returned no screenshot path.`
          : `${NAMESPACE}:${COMMAND} returned ${pathCount} path(s) but none was a readable PNG.`,
      recoverable: false,
    },
  });
}

/**
 * Cheap server-side triage line describing whether the capture contains a red field-pill
 * shape — a likely broken/invalid field reference. It is a nudge to look, never a verdict:
 * red is overloaded in Tableau, so a hit escalates to the model actually inspecting the
 * pixels (which ride in the same result), and a miss does NOT license "Done" on a risky
 * change. Null scan (undecodable capture) says so rather than implying the window is clean.
 */
export function buildRedTriageText(scan: ErrorRedScan | null): string {
  if (!scan) {
    return 'Automatic red indicator scan unavailable for this capture; inspect the window yourself for a red pill or broken element.';
  }
  if (isSuspiciousErrorRed(scan)) {
    return 'Possible error indicator: a red field pill shape was detected in the window, which usually means a broken or invalid field reference. Inspect the shelves, schema viewer, and Data pane; if a red pill is confirmed, do NOT report Done.';
  }
  return 'No red field pill shape detected. If the change was risky, still confirm the result visually.';
}

/**
 * Translate the chosen PNG into an MCP tool result. Mirrors buildSheetImageToolResult's
 * inline-cap policy: under the cap the bytes ride inline as an image block so the model
 * sees the pixels in its normal turn; over the cap they are written to a cache file and
 * the path is returned, keeping a multi-megabyte window capture out of the conversation.
 * Either way a triage line (see buildRedTriageText) leads the result so an obvious red
 * indicator is called out even before the model looks.
 */
export function buildWindowScreenshotToolResult({
  image,
  config,
}: {
  image: CapturedImage;
  config: { inlineImageMaxBytes: number };
}): CallToolResult {
  const mimeType = 'image/png';
  const capBytes = config.inlineImageMaxBytes;
  const inlineBytes = inlineImageFootprintBytes(image.bytes.length, mimeType);
  const triageText = buildRedTriageText(scanPngForErrorRed(image.bytes));

  if (isOverInlineImageCap(inlineBytes, capBytes)) {
    const cacheFile = new DesktopCache().getCacheFilePath({
      prefix: 'window-screenshot',
      extension: 'png',
    });
    writeFileSync(cacheFile, image.bytes);
    logInlineImageCapHit({
      tool: 'capture-window-screenshot',
      bytes: inlineBytes,
      capBytes,
      file: cacheFile,
    });
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: `${buildInlineImageCapFileMessage({
            label: 'Window screenshot',
            bytes: inlineBytes,
            capBytes,
            file: cacheFile,
          })}\n\n${triageText}`,
        },
      ],
    };
  }

  return {
    isError: false,
    content: [
      { type: 'text', text: triageText },
      { type: 'image', data: image.bytes.toString('base64'), mimeType },
    ],
  };
}
