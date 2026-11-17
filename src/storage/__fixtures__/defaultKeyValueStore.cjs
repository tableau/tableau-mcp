// New KV contract: expiration is supplied with every write; no init/namespace hooks.
class KeyValueStore {
  constructor(config) {
    if (config.throwInConstructor) {
      throw new Error(JSON.stringify(config), { cause: new Error(config.credential) });
    }
    this.map = new Map();
    globalThis.__keyValueProviderConfig = config;
    globalThis.__keyValueProviderInstance = this;
    if (config.omitConsume) this.consume = undefined;
    if (config.throwOnInit)
      this.init = () => {
        throw new Error('KV must not call init');
      };
  }

  read(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  get(key) {
    return Promise.resolve(this.read(key));
  }

  set(key, value, options) {
    if (!Number.isFinite(options?.ttlMs)) return Promise.reject(new Error('Missing TTL'));
    this.map.set(key, { value, expiresAt: Date.now() + options.ttlMs });
    return Promise.resolve();
  }

  delete(key) {
    this.map.delete(key);
    return Promise.resolve();
  }

  consume(key) {
    const value = this.read(key);
    this.map.delete(key);
    return Promise.resolve(value);
  }
}

module.exports = { default: KeyValueStore };
