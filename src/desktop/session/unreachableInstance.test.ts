import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import {
  CACHED_XML_WARNING,
  noInstanceFoundMessage,
  staleSessionRecoveryMessage,
  unknownInstanceUnreachableMessage,
  unreachableInstanceMessage,
} from './unreachableInstance.js';

describe('unreachable-instance messages', () => {
  it('names the pid, says the session is stale, and points at list-instances', () => {
    const message = noInstanceFoundMessage(31875);

    expect(message).toContain('No Desktop instance found with PID 31875');
    expect(message).toContain('Session 31875 is stale');
    expect(message).toContain('Call list-instances and retry with the current session');
    expect(message).toContain(CACHED_XML_WARNING);
  });

  it('keeps the same shape for a pid that stopped answering', () => {
    expect(unreachableInstanceMessage(31875, 'fetch failed')).toContain(
      'Tableau Desktop instance PID 31875 is not responding',
    );
    expect(unreachableInstanceMessage(31875, 'fetch failed')).toContain(
      staleSessionRecoveryMessage(31875),
    );
    expect(unreachableInstanceMessage(31875, 'fetch failed')).toContain('Cause: fetch failed');
  });

  it('still tells the agent what to do when nothing is pinned', () => {
    expect(unknownInstanceUnreachableMessage()).toContain('Call list-instances');
  });
});

describe('ExternalApiToolExecutor unreachable-instance reporting', () => {
  const instance = {
    baseUrl: 'http://127.0.0.1:65535',
    token: 'valid-token',
    pid: 31875,
    instanceId: 'inst-test',
    apiVersion: '1.0',
  };

  function makeExecutor(fetchFn: typeof fetch): ExternalApiToolExecutor {
    return new ExternalApiToolExecutor({
      pid: 31875,
      discover: () => [instance] as never,
      clientOptions: { fetchFn },
    } as never);
  }

  it('names the unreachable pid instead of leaking a raw fetch failure', async () => {
    // A Desktop that died after the executor cached its client: the old path returned the raw
    // TypeError, which the agent could not act on.
    const fetchFn = (() =>
      Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const executor = makeExecutor(fetchFn);
    await executor.start();

    const result = await executor.getWorkbookDocument(new AbortController().signal);

    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error.type).toBe('unknown');
    expect(String(error.error)).toContain('PID 31875');
    expect(String(error.error)).toContain('Call list-instances');
    expect(String(error.error)).toContain('Cause: fetch failed');
  });

  it('reports a timed-out request as a timeout, not as an unreachable instance', async () => {
    // Real timers with a small budget: AbortSignal.timeout is native and vi cannot advance it.
    const fetchFn = ((_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })) as unknown as typeof fetch;
    const executor = new ExternalApiToolExecutor({
      pid: 31875,
      discover: () => [instance] as never,
      clientOptions: { fetchFn, timeoutMs: 60 },
    } as never);
    await executor.start();

    const result = await executor.getWorkbookDocument(new AbortController().signal);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().type).toBe('command-timed-out');
  });
});
