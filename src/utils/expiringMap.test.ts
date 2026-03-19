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
});
