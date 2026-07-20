export class ExpiringMap<K, V> extends Map<K, V> {
  private timeouts: Map<K, NodeJS.Timeout>;
  private expirationTimeMs: number;
  private maxSize: number | null;

  constructor({
    defaultExpirationTimeMs,
    maxSize,
  }: {
    defaultExpirationTimeMs: number;
    // Optional cap on the number of entries. Unbounded by default so existing callers (adminGate,
    // project-name cache) are unaffected. When set and exceeded on set(), the oldest inserted key
    // (Map insertion order) is evicted, clearing its timeout.
    maxSize?: number;
  }) {
    super();

    if (defaultExpirationTimeMs <= 0) {
      throw new Error('Expiration time must be greater than 0');
    }

    if (defaultExpirationTimeMs > 2 ** 31 - 1) {
      // https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
      throw new Error(`Expiration time must be at most ${2 ** 31 - 1}`);
    }

    if (maxSize !== undefined && maxSize <= 0) {
      throw new Error('Max size must be greater than 0');
    }

    this.timeouts = new Map();
    this.expirationTimeMs = defaultExpirationTimeMs;
    this.maxSize = maxSize ?? null;
  }

  get defaultExpirationTimeMs(): number {
    return this.expirationTimeMs;
  }

  set = (key: K, value: V, expirationTimeMs = this.expirationTimeMs): this => {
    if (expirationTimeMs <= 0) {
      throw new Error('Expiration time must be greater than 0');
    }

    if (expirationTimeMs > 2 ** 31 - 1) {
      // https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
      throw new Error(`Expiration time must be at most ${2 ** 31 - 1}`);
    }

    // Clear any existing timeout for this key
    const currentTimeout = this.timeouts.get(key);
    if (currentTimeout) {
      clearTimeout(currentTimeout);
    }

    super.set(key, value);

    // Enforce the optional size cap. A key already present was overwritten above (not a net add), so
    // only evict when inserting a genuinely new key pushes us over the cap. Map preserves insertion
    // order, so the first key is the oldest inserted; delete() clears its timeout too.
    if (this.maxSize !== null && this.size > this.maxSize) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) {
        this.delete(oldestKey);
      }
    }

    // Set a timeout to delete the key
    const timeout = setTimeout(() => {
      this.delete(key);
    }, expirationTimeMs);

    this.timeouts.set(key, timeout);

    return this;
  };

  delete = (key: K): boolean => {
    // Clear any existing timeout for this key
    const currentTimeout = this.timeouts.get(key);
    if (currentTimeout) {
      clearTimeout(currentTimeout);
      this.timeouts.delete(key);
    }

    return super.delete(key);
  };

  clear = (): void => {
    this.timeouts.forEach((timeout) => clearTimeout(timeout));
    this.timeouts.clear();
    super.clear();
  };

  [Symbol.dispose](): void {
    // Clean up timeouts when the map is garbage collected
    this.clear();
  }
}
