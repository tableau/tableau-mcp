// Test fixture: a custom SessionStore whose Map lives on globalThis, so every provider instance (one
// per simulated replica, each loaded from a fresh module graph) reads and writes the same backend,
// like replicas sharing one Redis. It deliberately ignores TTL, like a provider that never expires.
class SharedBackendSessionStore {
  constructor() {
    globalThis.__sharedSessionBackend ??= new Map();
    this.map = globalThis.__sharedSessionBackend;
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

module.exports = { default: SharedBackendSessionStore };
