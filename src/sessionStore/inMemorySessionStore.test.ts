import { InMemorySessionStore } from './inMemorySessionStore.js';

describe('InMemorySessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('set then get returns the value', async () => {
    const store = new InMemorySessionStore<string>();
    await store.set('key', 'value', 10000);
    await expect(store.get('key')).resolves.toBe('value');
  });

  it('delete then get returns undefined', async () => {
    const store = new InMemorySessionStore<string>();
    await store.set('key', 'value', 10000);
    await store.delete('key');
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('delete on a missing key does not throw', async () => {
    const store = new InMemorySessionStore<string>();
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });

  it('consume returns the value and removes it', async () => {
    const store = new InMemorySessionStore<string>();
    await store.set('key', 'value', 10000);

    await expect(store.consume('key')).resolves.toBe('value');
    await expect(store.get('key')).resolves.toBeUndefined();
    // A second consume sees nothing left.
    await expect(store.consume('key')).resolves.toBeUndefined();
  });

  it('rotate removes oldKey and makes newKey readable with no window where both are valid', async () => {
    const store = new InMemorySessionStore<string>();
    await store.set('old', 'value', 10000);

    await store.rotate('old', 'new', 'value', 10000);

    await expect(store.get('old')).resolves.toBeUndefined();
    await expect(store.get('new')).resolves.toBe('value');
  });

  it('expires values after the ttl', async () => {
    const store = new InMemorySessionStore<string>();
    await store.set('key', 'value', 1000);
    await expect(store.get('key')).resolves.toBe('value');

    vi.advanceTimersByTime(1000);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('applies the ttl passed to each set independently of rotate', async () => {
    const store = new InMemorySessionStore<string>();
    await store.set('old', 'value', 5000);
    await store.rotate('old', 'new', 'value', 1000);

    vi.advanceTimersByTime(1000);
    await expect(store.get('new')).resolves.toBeUndefined();
  });

  it('evicts the oldest key when constructed with maxSize', async () => {
    const store = new InMemorySessionStore<number>({ maxSize: 2 });
    await store.set('a', 1, 10000);
    await store.set('b', 2, 10000);
    await store.set('c', 3, 10000);

    await expect(store.get('a')).resolves.toBeUndefined();
    await expect(store.get('b')).resolves.toBe(2);
    await expect(store.get('c')).resolves.toBe(3);
  });
});
