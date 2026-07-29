import { ExpiringMap } from './expiringMap.js';

describe('ExpiringMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should set and get values', () => {
    const map = new ExpiringMap<string, string>({ defaultExpirationTimeMs: 10000 });
    map.set('key', 'value');
    expect(map.get('key')).toBe('value');
  });

  it('should delete values', () => {
    const map = new ExpiringMap<string, string>({ defaultExpirationTimeMs: 10000 });
    map.set('key', 'value');
    map.delete('key');
    expect(map.get('key')).toBeUndefined();
  });

  it('should clear values', () => {
    const map = new ExpiringMap<string, string>({ defaultExpirationTimeMs: 10000 });
    map.set('key', 'value');
    map.clear();
    expect(map.get('key')).toBeUndefined();
  });

  it('should expire values', () => {
    const map = new ExpiringMap<string, string>({ defaultExpirationTimeMs: 1000 });
    map.set('key', 'value');
    expect(map.get('key')).toBe('value');

    vi.advanceTimersByTime(1000);
    expect(map.get('key')).toBeUndefined();
  });

  it('should expire values when the default expiration time is overridden', () => {
    const map = new ExpiringMap<string, string>({ defaultExpirationTimeMs: 1000 });
    map.set('key', 'value', 2000);
    expect(map.get('key')).toBe('value');

    vi.advanceTimersByTime(1000);
    expect(map.get('key')).toBe('value');

    vi.advanceTimersByTime(1000);
    expect(map.get('key')).toBeUndefined();
  });

  it('should throw error when expiration time is less than or equal to 0', () => {
    expect(() => new ExpiringMap<string, string>({ defaultExpirationTimeMs: 0 })).toThrow(
      'Expiration time must be greater than 0',
    );

    expect(() => new ExpiringMap<string, string>({ defaultExpirationTimeMs: -1 })).toThrow(
      'Expiration time must be greater than 0',
    );
  });

  it('should throw error when expiration time is greater than 2**31 - 1', () => {
    expect(() => new ExpiringMap<string, string>({ defaultExpirationTimeMs: 2 ** 31 })).toThrow(
      'Expiration time must be at most 2147483647',
    );
  });

  describe('maxSize', () => {
    it('is unbounded when maxSize is unset', () => {
      const map = new ExpiringMap<string, number>({ defaultExpirationTimeMs: 10000 });
      for (let i = 0; i < 1000; i++) {
        map.set(`key-${i}`, i);
      }
      expect(map.size).toBe(1000);
      expect(map.get('key-0')).toBe(0);
      expect(map.get('key-999')).toBe(999);
    });

    it('evicts the oldest inserted key when maxSize is exceeded', () => {
      const map = new ExpiringMap<string, number>({ defaultExpirationTimeMs: 10000, maxSize: 3 });
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      expect(map.size).toBe(3);

      // Inserting a 4th distinct key evicts the oldest inserted ('a').
      map.set('d', 4);
      expect(map.size).toBe(3);
      expect(map.get('a')).toBeUndefined();
      expect(map.get('b')).toBe(2);
      expect(map.get('c')).toBe(3);
      expect(map.get('d')).toBe(4);
    });

    it('clears the evicted key timeout so it does not fire later', () => {
      const map = new ExpiringMap<string, number>({ defaultExpirationTimeMs: 10000, maxSize: 1 });
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      map.set('a', 1);
      map.set('b', 2); // evicts 'a', which must clear 'a's timeout

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(map.get('a')).toBeUndefined();

      // Advancing past the original TTL must not throw or resurrect/re-delete stale state.
      vi.advanceTimersByTime(10000);
      expect(map.get('b')).toBeUndefined(); // b's own TTL expired, a is long gone
      clearTimeoutSpy.mockRestore();
    });

    it('overwriting an existing key does not trigger eviction', () => {
      const map = new ExpiringMap<string, number>({ defaultExpirationTimeMs: 10000, maxSize: 2 });
      map.set('a', 1);
      map.set('b', 2);
      // Overwrite 'a' — still 2 entries, no eviction.
      map.set('a', 11);
      expect(map.size).toBe(2);
      expect(map.get('a')).toBe(11);
      expect(map.get('b')).toBe(2);
    });

    it('throws when maxSize is less than or equal to 0', () => {
      expect(
        () => new ExpiringMap<string, string>({ defaultExpirationTimeMs: 10000, maxSize: 0 }),
      ).toThrow('Max size must be greater than 0');
      expect(
        () => new ExpiringMap<string, string>({ defaultExpirationTimeMs: 10000, maxSize: -1 }),
      ).toThrow('Max size must be greater than 0');
    });
  });
});
