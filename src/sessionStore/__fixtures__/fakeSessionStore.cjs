// Test fixture: a minimal custom SessionStore provider loadable via require() by init.ts's
// loadCustomProvider. Backs a single shared plain Map so tests can assert key-prefix isolation.
class FakeSessionStore {
  constructor() {
    this.map = new Map();
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

// Mirror the ESM `export default class` convention the loader expects (module.default).
module.exports = { default: FakeSessionStore };
