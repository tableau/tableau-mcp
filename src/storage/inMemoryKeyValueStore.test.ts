import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';

describe('InMemoryKeyValueStore per-write expiration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('uses independent lifetimes for keys in the same store', async () => {
    const store = new InMemoryKeyValueStore<string>();
    await store.set('short', 'a', { ttlMs: 100 });
    await store.set('long', 'b', { ttlMs: 1000 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(store.get('short')).resolves.toBeUndefined();
    await expect(store.get('long')).resolves.toBe('b');
    await vi.advanceTimersByTimeAsync(900);
    await expect(store.get('long')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces the previous expiration on overwrite without extending it on reads', async () => {
    const store = new InMemoryKeyValueStore<string>();
    await store.set('key', 'first', { ttlMs: 100 });
    await vi.advanceTimersByTimeAsync(50);
    await store.set('key', 'second', { ttlMs: 200 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(store.get('key')).resolves.toBe('second');
    await vi.advanceTimersByTimeAsync(100);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('atomically consumes values once and clears their timers', async () => {
    const store = new InMemoryKeyValueStore<string>();
    await store.set('key', 'value', { ttlMs: 1000 });
    const values = await Promise.all([store.consume('key'), store.consume('key')]);
    expect(values).toEqual(['value', undefined]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supports missing reads, deletes, and consumes', async () => {
    const store = new InMemoryKeyValueStore();
    await expect(store.get('missing')).resolves.toBeUndefined();
    await expect(store.consume('missing')).resolves.toBeUndefined();
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });

  it.each([
    undefined,
    {},
    { ttlMs: undefined },
    { ttlMs: NaN },
    { ttlMs: Infinity },
    { ttlMs: '100' },
  ])(
    'rejects invalid or missing expiration without replacing existing data: %j',
    async (options) => {
      const store = new InMemoryKeyValueStore<string>();
      await store.set('key', 'original', { ttlMs: 100 });
      await expect(Reflect.apply(store.set, store, ['key', 'invalid', options])).rejects.toThrow(
        'ttlMs must be a finite number.',
      );
      await expect(store.get('key')).resolves.toBe('original');
      await vi.advanceTimersByTimeAsync(100);
      await expect(store.get('key')).resolves.toBeUndefined();
    },
  );

  it.each([0, -100])('clamps TTL %i to one millisecond', async (ttlMs) => {
    const store = new InMemoryKeyValueStore<string>();
    await store.set('key', 'value', { ttlMs });
    await expect(store.get('key')).resolves.toBe('value');
    await vi.advanceTimersByTimeAsync(1);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('handles long lifetimes without expiring other records late', async () => {
    const store = new InMemoryKeyValueStore<string>();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    await store.set('long', 'value', { ttlMs: thirtyDays });
    await store.set('short', 'value', { ttlMs: 100 });
    await vi.advanceTimersByTimeAsync(25 * 24 * 60 * 60 * 1000);
    await expect(store.get('short')).resolves.toBeUndefined();
    await expect(store.get('long')).resolves.toBe('value');
    await vi.advanceTimersByTimeAsync(5 * 24 * 60 * 60 * 1000);
    await expect(store.get('long')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels long-TTL rearming when a shorter write replaces the value', async () => {
    const store = new InMemoryKeyValueStore<string>();
    await store.set('key', 'old', { ttlMs: 30 * 24 * 60 * 60 * 1000 });
    expect(vi.getTimerCount()).toBe(2);
    await store.set('key', 'new', { ttlMs: 100 });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(26 * 24 * 60 * 60 * 1000);
    await expect(store.get('key')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
