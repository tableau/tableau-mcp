// Test fixture: a custom SessionStore provider that implements the optional configureNamespace
// hook, recording each (namespace, options) call onto a globalThis array the test can inspect to
// assert per-namespace TTL/bound are threaded through without conflation. Uses globalThis because
// this provider is instantiated inside init.ts's loader, out of the test's direct reach.
class ConfigureNamespaceSessionStore {
  constructor() {
    this.map = new Map();
  }

  configureNamespace(namespace, options) {
    (globalThis.__configureNamespaceCalls ??= []).push({ namespace, options });
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

module.exports = { default: ConfigureNamespaceSessionStore };
