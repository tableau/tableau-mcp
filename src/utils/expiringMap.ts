export class ExpiringMap<K, V> extends Map<K, V> {
  private timeouts: Map<K, NodeJS.Timeout>;
  private expirationTimeMs: number | undefined;

  constructor({
    defaultExpirationTimeMs = undefined,
  }: Partial<{ defaultExpirationTimeMs: number }> = {}) {
    super();

    if (defaultExpirationTimeMs !== undefined) {
      if (defaultExpirationTimeMs <= 0) {
        throw new Error('Expiration time must be greater than 0');
      }

      if (defaultExpirationTimeMs > 2 ** 31 - 1) {
        // https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
        throw new Error(`Expiration time must be at most ${2 ** 31 - 1}`);
      }
    }

    this.timeouts = new Map();
    this.expirationTimeMs = defaultExpirationTimeMs;
  }

  get defaultExpirationTimeMs(): number | undefined {
    return this.expirationTimeMs;
  }

  set = (key: K, value: V, expirationTimeMs = this.expirationTimeMs): this => {
    if (expirationTimeMs === undefined) {
      return super.set(key, value);
    }

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

    // Set a timeout to delete the key
    // TODO: Use setLongTimeout instead
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
