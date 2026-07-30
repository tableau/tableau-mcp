import { Worker } from 'node:worker_threads';

import { ArgsValidationError, DataAppRegexTimeoutError } from '../../../errors/mcpToolError.js';

/**
 * Runs the per-line regex scan for `search-data-app-file` inside a worker thread so it can be
 * force-terminated on a timeout.
 *
 * Node's RegExp engine runs synchronously on the single event loop with no interrupt: a pattern that
 * backtracks catastrophically (ReDoS) would otherwise hang the whole process, stalling every other
 * user of a shared multi-tenant HTTP deployment. The static {@link hasCatastrophicBacktracking}
 * screen is a cheap first line of defense but cannot catch every super-linear pattern (e.g. overlapping
 * alternations like `(a|aa)+$`), so this worker is the hard backstop: if the match does not finish
 * within `timeoutMs`, the worker is terminated and a {@link DataAppRegexTimeoutError} is raised.
 *
 * Only the raw matcher runs here — line splitting and context assembly stay on the caller's thread, so
 * the worker receives the already-split `lines` and returns just 1-based match line numbers. The
 * regex is recompiled from `source`/`flags` inside the worker; the caller is expected to have already
 * validated the syntax on the main thread, but a compile error is still reported cleanly.
 */
export async function runRegexSearch(params: {
  lines: string[];
  source: string;
  flags: string;
  maxMatches: number;
  timeoutMs: number;
}): Promise<{ totalMatches: number; matchLines: number[] }> {
  const { lines, source, flags, maxMatches, timeoutMs } = params;

  return await new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { lines, source, flags, maxMatches },
    });
    // A stuck worker (terminated on timeout) must never keep the process alive on its own.
    worker.unref();

    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new DataAppRegexTimeoutError(
            `Regular-expression search exceeded its ${timeoutMs}ms time budget and was aborted. ` +
              'The pattern likely backtracks catastrophically on this file. Simplify it (avoid ' +
              'nested or overlapping quantifiers) or search with a literal substring instead.',
          ),
        ),
      );
    }, timeoutMs);
    // Don't let the pending timer hold the event loop open.
    timer.unref?.();

    worker.on('message', (msg: WorkerResult) => {
      finish(() => {
        if ('error' in msg) {
          reject(new ArgsValidationError(`Invalid regular expression: ${msg.error}`));
        } else {
          resolve({ totalMatches: msg.totalMatches, matchLines: msg.matchLines });
        }
      });
    });

    worker.on('error', (error) => {
      finish(() => reject(error));
    });

    // A non-zero exit with no prior message means the worker died before reporting — surface it
    // rather than hanging the promise forever.
    worker.on('exit', (code) => {
      finish(() =>
        reject(
          new DataAppRegexTimeoutError(`Regex search worker exited unexpectedly (code ${code}).`),
        ),
      );
    });
  });
}

type WorkerResult = { totalMatches: number; matchLines: number[] } | { error: string };

// Inline worker body, run via `new Worker(source, { eval: true })`. It is kept as a string (not a
// separate file) on purpose: the production build bundles the whole server into a single file
// (esbuild `packages: 'bundle'`), so there is no sibling worker file to point at at runtime. The
// body is fully self-contained — it references only `workerData`, `parentPort`, and JS built-ins —
// so it survives bundling/minification unchanged. It compiles the regex and tests each line,
// collecting up to `maxMatches` 1-based line numbers plus the true total.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { lines, source, flags, maxMatches } = workerData;
let regex;
try {
  regex = new RegExp(source, flags);
} catch (error) {
  parentPort.postMessage({ error: error && error.message ? error.message : String(error) });
}
if (regex) {
  const matchLines = [];
  let totalMatches = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!regex.test(lines[i])) {
      continue;
    }
    totalMatches++;
    if (matchLines.length < maxMatches) {
      matchLines.push(i + 1);
    }
  }
  parentPort.postMessage({ totalMatches, matchLines });
}
`;
