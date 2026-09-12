// Test fixture: a custom provider implementing the optional init()/close() lifecycle hooks,
// recording each call on globalThis (the provider is instantiated inside init.ts's loader, out of
// the test's direct reach) so tests can assert connectSessionStore/disconnectSessionStore invoke them.
class LifecycleSessionStore {
  constructor() {
    this.map = new Map();
  }

  init() {
    globalThis.__initCalls = (globalThis.__initCalls ?? 0) + 1;
    return Promise.resolve();
  }

  close() {
    globalThis.__closeCalls = (globalThis.__closeCalls ?? 0) + 1;
    return Promise.resolve();
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

  rotate(oldKey, newKey, value) {
    this.map.delete(oldKey);
    this.map.set(newKey, value);
    return Promise.resolve();
  }
}

module.exports = { default: LifecycleSessionStore };
