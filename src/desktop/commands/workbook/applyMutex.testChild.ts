import { setTimeout } from 'node:timers/promises';

import { withApplyLock } from './applyMutex.js';

const [key, lockRoot, holdMsText, startMode] = process.argv.slice(2);
const signal = new AbortController().signal;

async function main(): Promise<void> {
  process.send?.({ event: 'ready', at: Date.now() });
  if (startMode === 'barrier') {
    await new Promise<void>((resolve) => {
      process.once('message', (message: unknown) => {
        if ((message as { event?: string }).event === 'start') resolve();
      });
    });
  }
  await withApplyLock(
    async () => {
      process.send?.({ event: 'acquired', at: Date.now() });
      await setTimeout(Number(holdMsText));
      process.send?.({ event: 'released', at: Date.now() });
    },
    { key, lockRoot, signal, timeoutMs: 5_000 },
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
