import { ExpiringMap } from '../../utils/expiringMap';
import { Store } from './store';

export class InMemoryStore<T> extends Store<T> {
  private store = new ExpiringMap<string, T>();

  async get(sessionId: string): Promise<T | undefined> {
    return this.store.get(sessionId);
  }

  async set(sessionId: string, data: T, expirationTimeMs: number): Promise<this> {
    this.store.set(sessionId, data, expirationTimeMs);
    return this;
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.store.delete(sessionId);
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.store.has(sessionId);
  }

  async connect(): Promise<void> {
    return;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
