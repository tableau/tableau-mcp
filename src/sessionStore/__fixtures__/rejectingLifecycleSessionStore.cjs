// Test fixture: a custom provider whose init()/close() reject, so tests can assert the rejection
// propagates out of connectSessionStore/disconnectSessionStore (fail-closed at boot/shutdown).
class RejectingLifecycleSessionStore {
  constructor() {
    this.map = new Map();
  }

  init() {
    return Promise.reject(new Error('init failed: backend unreachable'));
  }

  close() {
    return Promise.reject(new Error('close failed: backend unreachable'));
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

module.exports = { default: RejectingLifecycleSessionStore };
