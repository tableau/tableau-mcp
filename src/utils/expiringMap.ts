export class ExpiringMap<K, V> extends Map<K, V> {
  private timeouts: Map<K, NodeJS.Timeout>;
  private expirationTimeMs: number;

  constructor({ expirationTimeMs }: { expirationTimeMs: number }) {
    super();

    if (expirationTimeMs <= 0) {
      throw new Error('Expiration time must be greater than 0');
    }

    if (expirationTimeMs > 2 ** 31 - 1) {
      throw new Error(`Expiration time must be less than ${2 ** 31 - 1}ms`);
    }

    this.timeouts = new Map();
    this.expirationTimeMs = expirationTimeMs;
  }

  set = (key: K, value: V): this => {
    // Clear any existing timeout for this key
    const currentTimeout = this.timeouts.get(key);
    if (currentTimeout) {
      clearTimeout(currentTimeout);
    }

    super.set(key, value);

    // Set a timeout to delete the key
    const timeout = setTimeout(() => {
      this.delete(key);
    }, this.expirationTimeMs);

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
