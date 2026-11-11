// An operator-supplied module implementing only the four public KV operations.
class KeyValueStore {
  constructor(config) {
    this.map = new Map();
    globalThis.__keyValueProviderConfig = config;
    if (config.omitConsume) this.consume = undefined;
  }

  get(key) {
    return Promise.resolve(this.map.get(key));
  }

  set(key, value) {
    this.map.set(key, value);
    return Promise.resolve();
  }

  delete(key) {
    this.map.delete(key);
    return Promise.resolve();
  }

  consume(key) {
    const value = this.map.get(key);
    this.map.delete(key);
    return Promise.resolve(value);
  }
}

module.exports = { KeyValueStore };
