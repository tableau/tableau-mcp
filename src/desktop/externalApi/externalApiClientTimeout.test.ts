import { ExternalApiClient } from './externalApiClient.js';
import { ExternalApiInstance } from './types.js';

const instance: ExternalApiInstance = {
  baseUrl: 'http://127.0.0.1:65535',
  token: 'valid-token',
  pid: 4321,
  instanceId: 'inst-test',
  apiVersion: '1.0',
};

// Real timers: AbortSignal.timeout runs on a native timer that vi.useFakeTimers cannot advance,
// so these use a small budget instead. The budget's size is not what is under test — whether the
// clock applies at all is.
const BUDGET_MS = 60;

/** A Desktop that accepted the socket and then went quiet — settles only when aborted. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
}

describe('ExternalApiClient request deadline', () => {
  it('applies its own clock even when the caller supplies a signal', async () => {
    // The `??` this replaces meant a caller signal removed the timeout entirely, and every
    // desktop tool supplies extra.signal — so the 60s default was unreachable in shipped code.
    const client = new ExternalApiClient(instance, {
      fetchFn: hangingFetch(),
      timeoutMs: BUDGET_MS,
    });
    const neverAborts = new AbortController().signal;

    const result = await client.health(neverAborts);

    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error.type).toBe('network');
    expect((error as { error: unknown }).error).toMatchObject({ name: 'TimeoutError' });
  });

  it('still applies the clock when the caller supplies no signal', async () => {
    const client = new ExternalApiClient(instance, {
      fetchFn: hangingFetch(),
      timeoutMs: BUDGET_MS,
    });

    const result = await client.health();

    expect(result.isErr()).toBe(true);
    expect((result.unwrapErr() as { error: unknown }).error).toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('lets the caller cancel before the clock runs out', async () => {
    const client = new ExternalApiClient(instance, {
      fetchFn: hangingFetch(),
      timeoutMs: 60_000,
    });
    const controller = new AbortController();

    const pending = client.health(controller.signal);
    controller.abort(new Error('client cancelled'));
    const result = await pending;

    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error.type).toBe('network');
    expect((error as { error: unknown }).error).toMatchObject({ message: 'client cancelled' });
  });

  it('does not cut a request that finishes inside the budget', async () => {
    const fetchFn = ((): Promise<Response> =>
      new Promise((resolve) => {
        setTimeout(() => resolve(new Response('{}', { status: 200 })), 5);
      })) as unknown as typeof fetch;
    const client = new ExternalApiClient(instance, { fetchFn, timeoutMs: 5_000 });

    const result = await client.health(new AbortController().signal);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().healthy).toBe(true);
  });
});
