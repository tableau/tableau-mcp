import { InMemorySessionStore } from './inMemorySessionStore.js';

describe('InMemorySessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('set then get returns the value', async () => {
    const store = new InMemorySessionStore<string>({ ttlMs: 10000 });
    await store.set('key', 'value');
    await expect(store.get('key')).resolves.toBe('value');
  });

  it('delete then get returns undefined', async () => {
    const store = new InMemorySessionStore<string>({ ttlMs: 10000 });
    await store.set('key', 'value');
    await store.delete('key');
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('delete on a missing key does not throw', async () => {
    const store = new InMemorySessionStore<string>({ ttlMs: 10000 });
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });

  it('consume returns the value and removes it', async () => {
    const store = new InMemorySessionStore<string>({ ttlMs: 10000 });
    await store.set('key', 'value');

    await expect(store.consume('key')).resolves.toBe('value');
    await expect(store.get('key')).resolves.toBeUndefined();
    // A second consume sees nothing left.
    await expect(store.consume('key')).resolves.toBeUndefined();
  });

  it('rotate removes oldKey and makes newKey readable with no window where both are valid', async () => {
    const store = new InMemorySessionStore<string>({ ttlMs: 10000 });
    await store.set('old', 'value');

    await store.rotate('old', 'new', 'value');

    await expect(store.get('old')).resolves.toBeUndefined();
    await expect(store.get('new')).resolves.toBe('value');
  });

  it('expires values after the ttl', async () => {
    const store = new InMemorySessionStore<string>({ ttlMs: 1000 });
    await store.set('key', 'value');
    await expect(store.get('key')).resolves.toBe('value');

    vi.advanceTimersByTime(1000);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('applies the store-configured ttl to rotate as well as set', async () => {
    const store = new InMemorySessionStore<string>({ ttlMs: 1000 });
    await store.set('old', 'value');
    await store.rotate('old', 'new', 'value');

    vi.advanceTimersByTime(1000);
    await expect(store.get('new')).resolves.toBeUndefined();
  });

  it('evicts the oldest key when constructed with maxSize', async () => {
    const store = new InMemorySessionStore<number>({ ttlMs: 10000, maxSize: 2 });
    await store.set('a', 1);
    await store.set('b', 2);
    await store.set('c', 3);

    await expect(store.get('a')).resolves.toBeUndefined();
    await expect(store.get('b')).resolves.toBe(2);
    await expect(store.get('c')).resolves.toBe(3);
  });

  it('survives a ttl beyond the 32-bit setTimeout cap by re-arming in chunks', async () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000; // exceeds 2**31 - 1 (~24.86 days)
    const store = new InMemorySessionStore<string>({ ttlMs: thirtyDaysMs });
    await store.set('key', 'value');

    // Past the first chunk boundary but still well short of the full ttl: must not have expired.
    await vi.advanceTimersByTimeAsync(25 * 24 * 60 * 60 * 1000);
    await expect(store.get('key')).resolves.toBe('value');

    // Past the full logical ttl: must now be gone.
    await vi.advanceTimersByTimeAsync(6 * 24 * 60 * 60 * 1000);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('does not resurrect a key deleted before its chunk boundary re-arm fires', async () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const store = new InMemorySessionStore<string>({ ttlMs: thirtyDaysMs });
    await store.set('key', 'value');
    await store.delete('key');

    // Advance past where the pending chunk re-arm would have fired had it not been cancelled.
    await vi.advanceTimersByTimeAsync(26 * 24 * 60 * 60 * 1000);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('does not resurrect a key consumed before its chunk boundary re-arm fires', async () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const store = new InMemorySessionStore<string>({ ttlMs: thirtyDaysMs });
    await store.set('key', 'value');
    await expect(store.consume('key')).resolves.toBe('value');

    await vi.advanceTimersByTimeAsync(26 * 24 * 60 * 60 * 1000);
    await expect(store.get('key')).resolves.toBeUndefined();
  });
});
