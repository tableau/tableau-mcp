// Test fixture: a custom provider missing rotate(). init.ts requires rotate for custom
// providers, so loading this must fail validation and fall back to the memory provider.
class NoRotateSessionStore {
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
}

module.exports = { default: NoRotateSessionStore };
