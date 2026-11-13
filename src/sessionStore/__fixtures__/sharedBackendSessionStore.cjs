// Test fixture: a custom KeyValueStore whose Map lives on globalThis, so every provider instance (one
// per simulated replica, each loaded from a fresh module graph) reads and writes the same backend,
// like replicas sharing one Redis. It deliberately ignores TTL, like a provider that never expires.
class SharedBackendSessionStore {
  constructor() {
    globalThis.__sharedSessionBackend ??= new Map();
    this.map = globalThis.__sharedSessionBackend;
  }

  async get(key) {
    this.throwIfDown();
    return this.map.get(key);
  }

  async set(key, value) {
    this.throwIfDown();
    // Opt-in: store values as text, like a provider over plain Redis SET/GET.
    this.map.set(key, globalThis.__sharedSessionStoresText ? String(value) : value);
  }

  async delete(key) {
    this.throwIfDown();
    this.map.delete(key);
  }

  async consume(key) {
    this.throwIfDown();
    const value = this.map.get(key);
    this.map.delete(key);
    return value;
  }

  throwIfDown() {
    if (globalThis.__sharedSessionStoreDown) {
      throw new Error('store down: redis://test-user:test-password@backend.invalid');
    }
  }
}

module.exports = { default: SharedBackendSessionStore };
