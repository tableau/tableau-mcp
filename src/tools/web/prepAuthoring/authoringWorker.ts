import { parentPort, workerData } from 'node:worker_threads';

import { runAuthoringEngine } from './authoringEngine.js';
import { AuthoringError } from './projectIo.js';

try {
  const result = runAuthoringEngine(workerData as Record<string, unknown>);
  if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new AuthoringError();
  parentPort?.postMessage(result);
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    code: error instanceof AuthoringError ? error.code : 'UNSAFE_PROJECT',
  });
} finally {
  parentPort?.close();
}
