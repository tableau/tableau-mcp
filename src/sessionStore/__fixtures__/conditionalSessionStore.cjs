// String-only fixture for providers that opt into conditional consumption.
class ConditionalSessionStore {
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

  compareAndDelete(key, expectedValue) {
    // No await between the comparison and delete: concurrent calls cannot both win.
    if (!this.map.has(key) || this.map.get(key) !== expectedValue) {
      return Promise.resolve(false);
    }
    this.map.delete(key);
    return Promise.resolve(true);
  }
}

module.exports = { default: ConditionalSessionStore };
